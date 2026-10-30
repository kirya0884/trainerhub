-- Аудит 2026-10-30, этап 2, пункты 17 и 18: оплаты и абонемент одной транзакцией.
--
-- Было (фронт, lib/payments.ts):
--   * «Оплачено» — два-три запроса подряд (платёж, абонемент, партнёр). Обрыв между ними
--     или повтор после «не удалось» давал второй платёж и второе начисление пакета.
--   * «Разбить платёж» — сначала DELETE, потом N INSERT. Обрыв посередине терял сумму.
--   * «Удалить платёж» — ошибка чтения sessions_delta молча давала 0, платёж удалялся,
--     остаток не возвращался.
--   * Абонемент (clients.membership, jsonb) записывался ЦЕЛИКОМ из состояния экрана:
--     списание, сделанное клиентом (finish_client_session) или календарём, пока карточка
--     была открыта, откатывалось.
--
-- Стало — функции ниже. Каждая работает в одной транзакции и держит строку клиента
-- (select ... for update) — те же блокировки берёт finish_client_session, поэтому
-- списание и оплата больше не перетирают друг друга.
--
--   record_payment       — платёж + пополнение абонемента (+ половина партнёру по сплиту).
--                          Ключ от повторов: id платежа создаёт фронт; повтор с тем же id
--                          ничего не пишет и возвращает текущий абонемент (duplicate = true).
--   split_payment        — разбить платёж: исходная строка становится частью 1 (её id и
--                          sessions_delta сохраняются), части 2..N вставляются с id от фронта.
--                          Повтор с теми же id — ничего не делает.
--   delete_payment       — удалить платёж и вернуть остаток; повтор (платежа уже нет) — no-op.
--   patch_membership     — правка НАСТРОЕК абонемента: на сервере membership || patch,
--                          только переданные ключи. Счётчики (remaining, remainingPrice,
--                          remainingTotal, extra*, paymentDate) через неё менять нельзя —
--                          их меняют только функции оплаты/списания.
--   link_split_partner / unlink_split_partner — привязка/отвязка сплит-пары без записи
--                          абонемента целиком.
--
-- Почему частичное слияние, а не проверка версии (п. 18): тренер правит настройки
-- (тип, пакет, цена, дата, заметка), а списание меняет счётчики — это разные ключи,
-- конфликта по смыслу нет. Проверка версии отклоняла бы ввод тренера каждый раз, когда
-- клиент закончил тренировку, — пришлось бы перечитывать и вводить заново. Кроме того,
-- версии в таблице нет, и старый фронт на телефонах её не прислал бы.
--
-- Безопасность:
--   * SECURITY INVOKER: действуют те же RLS-правила (trainer_owns на clients и
--     client_payments). Дополнительно каждая функция явно проверяет trainer_id = auth.uid()
--     и падает с 42501, если карточка чужая (клиент из кабинета вызвать не может).
--   * search_path = '' и полные имена.
--   * EXECUTE только у authenticated (не PUBLIC, не anon).
--
-- Совместимость: таблицы, колонки, RLS-правила и существующие функции НЕ меняются.
-- Старый фронт (PWA на телефонах живёт днями) продолжает писать напрямую, как раньше —
-- ничего не ломается, но и защиты у него нет, пока не обновится.
-- session_price и finish_client_session не трогаем.

-- 0. Число из строкового поля абонемента — как Number(x) || 0 во фронте.
--    Мусор и пустая строка -> 0 (а не ошибка приведения, как у num_or_null на "1.2.3").
create or replace function public.membership_num(t text)
returns double precision
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when t ~ '^\s*-?[0-9]+([.,][0-9]+)?\s*$' then replace(btrim(t), ',', '.')::double precision
    else 0
  end
$$;

-- 1. Записать оплату.
--    p_package — настройки пакета, которые видит тренер на экране в момент оплаты
--    (выбранный шаблон мог ещё не успеть сохраниться): только type, total, packagePrice,
--    pricePerSession, split. Остаток считается от ТЕКУЩЕГО абонемента в базе.
--    Логика начисления — та же, что была в markPaid (lib/payments.ts).
create or replace function public.record_payment(
  p_payment_id uuid,
  p_client_id  uuid,
  p_date       date,
  p_amount     numeric,
  p_pay_status text  default 'paid',
  p_promo      text  default '',
  p_package    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m jsonb;
  v_fields jsonb;
  v_is_sub boolean;
  v_type text;
  v_new_total double precision;
  v_new_price double precision;
  v_old_rem double precision;
  v_old_price double precision;
  v_old_rem_total double precision;
  v_extra double precision;
  v_extra_price double precision;
  v_same_extra boolean;
  v_delta integer;
  v_partner uuid;
  v_half numeric;
begin
  if p_payment_id is null or p_client_id is null or p_date is null or p_amount is null or p_amount < 0 then
    raise exception 'record_payment: нужны id платежа, подопечный, дата и сумма >= 0' using errcode = '22023';
  end if;
  if p_pay_status is null or p_pay_status not in ('paid', 'deferred', 'installment') then
    raise exception 'record_payment: неизвестный статус оплаты %', p_pay_status using errcode = '22023';
  end if;
  p_package := coalesce(p_package, '{}'::jsonb);
  if jsonb_typeof(p_package) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_package) k
                where k not in ('type', 'total', 'packagePrice', 'pricePerSession', 'split')) then
    raise exception 'record_payment: в p_package допустимы только type, total, packagePrice, pricePerSession, split'
      using errcode = '22023';
  end if;

  -- Ревью этапа 2: подопечного и партнёра по сплиту блокируем в порядке id, как lock_clients
  -- в функциях списания, — иначе оплата A и завершение тренировки B взаимно блокируются
  perform 1 from public.clients c
  where c.trainer_id = v_uid and c.id in (
    select p_client_id
    union all
    select (c2.membership->>'partnerClientId')::uuid from public.clients c2
    where c2.id = p_client_id
      and c2.membership->>'partnerClientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  order by c.id
  for update;

  select c.membership into m
  from public.clients c
  where c.id = p_client_id and c.trainer_id = v_uid
  for update;
  if not found then
    raise exception 'record_payment: подопечный не найден' using errcode = '42501';
  end if;

  -- Повтор (ответ на первый вызов потерялся): платёж уже записан — ничего не делаем.
  if exists (select 1 from public.client_payments p where p.id = p_payment_id) then
    return jsonb_build_object('membership', m, 'duplicate', true);
  end if;

  m := coalesce(m, '{}'::jsonb) || p_package;
  v_is_sub := (m ->> 'type') = 'subscription';
  v_type := case when v_is_sub then 'subscription' else 'sessions' end;

  if v_is_sub then
    v_fields := jsonb_build_object('nextPaymentDate', to_char(p_date + interval '1 month', 'YYYY-MM-DD'));
    v_delta := null;
  else
    v_new_total := public.membership_num(m ->> 'total');
    v_new_price := case when v_new_total > 0
                        then public.membership_num(m ->> 'packagePrice') / v_new_total
                        else public.membership_num(m ->> 'pricePerSession') end;
    v_old_rem := public.membership_num(m ->> 'remaining');
    v_old_price := public.membership_num(m ->> 'remainingPrice');
    v_old_rem_total := coalesce(nullif(public.membership_num(m ->> 'remainingTotal'), 0), v_new_total);

    if v_old_rem <= 0 then
      v_fields := jsonb_build_object(
        'remaining', coalesce(m -> 'total', '""'::jsonb),
        'remainingPrice', v_new_price::text,
        'remainingTotal', coalesce(m -> 'total', '""'::jsonb));
    elsif v_old_price = 0 or round(v_old_price::numeric) = round(v_new_price::numeric) then
      v_fields := jsonb_build_object(
        'remaining', (v_old_rem + v_new_total)::text,
        'remainingPrice', v_new_price::text,
        'remainingTotal', (v_old_rem_total + v_new_total)::text);
    else
      -- Новый пакет по другой цене, старый остаток ещё есть — старый уходит в «доп. блок».
      v_extra := public.membership_num(m ->> 'extraRemaining');
      v_extra_price := public.membership_num(m ->> 'extraPricePerSession');
      v_same_extra := v_extra > 0 and round(v_extra_price::numeric) = round(v_old_price::numeric);
      v_fields := jsonb_build_object(
        'remaining', coalesce(m -> 'total', '""'::jsonb),
        'remainingPrice', v_new_price::text,
        'remainingTotal', coalesce(m -> 'total', '""'::jsonb),
        'extraRemaining', (case when v_same_extra then v_extra + v_old_rem else v_old_rem end)::text,
        'extraPricePerSession', v_old_price::text);
    end if;
    -- Во всех ветках пакет целиком лёг в remaining — откат при удалении вычтет ровно total.
    v_delta := round(v_new_total::numeric)::integer;
  end if;

  v_fields := v_fields || jsonb_build_object('paymentDate', to_char(p_date, 'YYYY-MM-DD'));
  m := m || v_fields;

  update public.clients set membership = m where id = p_client_id;

  if (m ->> 'split') = 'true'
     and (m ->> 'partnerClientId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_partner := (m ->> 'partnerClientId')::uuid;
  end if;

  if v_partner is not null and v_partner <> p_client_id then
    -- Партнёру — те же даты/остатки (общий пул), его split/partner* не трогаем.
    update public.clients
    set membership = coalesce(membership, '{}'::jsonb) || v_fields
    where id = v_partner and trainer_id = v_uid;
    if not found then
      raise exception 'record_payment: партнёр по сплиту не найден' using errcode = '42501';
    end if;
    v_half := round(p_amount / 2);
    insert into public.client_payments (id, client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status)
    values (p_payment_id, p_client_id, p_date, v_half, v_type, 'сплит 50/50', coalesce(p_promo, ''), v_delta, p_pay_status);
    -- Платёж партнёра — финансовая запись, счётчик тренировок принадлежит первичному клиенту.
    insert into public.client_payments (client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status)
    values (v_partner, p_date, p_amount - v_half, v_type, 'сплит 50/50 (партнёр)', coalesce(p_promo, ''), null, p_pay_status);
  else
    insert into public.client_payments (id, client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status)
    values (p_payment_id, p_client_id, p_date, p_amount, v_type, '', coalesce(p_promo, ''), v_delta, p_pay_status);
  end if;

  return jsonb_build_object('membership', m, 'duplicate', false);
end;
$$;

-- 2. Удалить платёж и вернуть остаток. Возвращает абонемент после удаления.
create or replace function public.delete_payment(p_payment_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m jsonb;
  v_delta integer;
  v_rem double precision;
  v_rem_total double precision;
  v_partner uuid;
begin
  if p_payment_id is null or p_client_id is null then
    raise exception 'delete_payment: нужны id платежа и подопечного' using errcode = '22023';
  end if;

  -- Ревью этапа 2: подопечного и партнёра по сплиту блокируем в порядке id, как lock_clients
  -- в функциях списания, — иначе оплата A и завершение тренировки B взаимно блокируются
  perform 1 from public.clients c
  where c.trainer_id = v_uid and c.id in (
    select p_client_id
    union all
    select (c2.membership->>'partnerClientId')::uuid from public.clients c2
    where c2.id = p_client_id
      and c2.membership->>'partnerClientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  order by c.id
  for update;

  select c.membership into m
  from public.clients c
  where c.id = p_client_id and c.trainer_id = v_uid
  for update;
  if not found then
    raise exception 'delete_payment: подопечный не найден' using errcode = '42501';
  end if;

  delete from public.client_payments p
  where p.id = p_payment_id and p.client_id = p_client_id
  returning p.sessions_delta into v_delta;
  if not found then
    return m; -- повтор: платёж уже удалён
  end if;

  if coalesce(v_delta, 0) = 0 or (m ->> 'type') = 'subscription' then
    return m;
  end if;

  v_rem := greatest(0, public.membership_num(m ->> 'remaining') - v_delta);
  v_rem_total := greatest(0, coalesce(nullif(public.membership_num(m ->> 'remainingTotal'), 0),
                                      public.membership_num(m ->> 'total')) - v_delta);
  m := m || jsonb_build_object('remaining', v_rem::text, 'remainingTotal', v_rem_total::text);
  -- Основной блок обнулился, а «доп. блок» есть — переносим его на место основного.
  if v_rem <= 0 and public.membership_num(m ->> 'extraRemaining') > 0 then
    m := m || jsonb_build_object(
      'remaining', m -> 'extraRemaining',
      'remainingPrice', coalesce(m -> 'extraPricePerSession', '""'::jsonb),
      'remainingTotal', m -> 'extraRemaining',
      'extraRemaining', '',
      'extraPricePerSession', '');
  end if;

  update public.clients set membership = m where id = p_client_id;

  if (m ->> 'split') = 'true'
     and (m ->> 'partnerClientId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_partner := (m ->> 'partnerClientId')::uuid;
    update public.clients
    set membership = coalesce(membership, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'remaining', m -> 'remaining',
      'remainingTotal', m -> 'remainingTotal',
      'remainingPrice', m -> 'remainingPrice',
      'extraRemaining', m -> 'extraRemaining',
      'extraPricePerSession', m -> 'extraPricePerSession'))
    where id = v_partner and id <> p_client_id and trainer_id = v_uid;
  end if;

  return m;
end;
$$;

-- 3. Разбить платёж на части. p_new_ids — id для частей 2..N (N = длина + 1), создаёт фронт.
--    Сумма: floor(amount / N) в каждую часть, остаток округления — в последнюю.
create or replace function public.split_payment(p_payment_id uuid, p_new_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_p public.client_payments%rowtype;
  v_parts integer;
  v_base numeric;
begin
  v_parts := coalesce(cardinality(p_new_ids), 0) + 1;
  if p_payment_id is null or v_parts < 2 or v_parts > 50
     or array_position(p_new_ids, null) is not null
     or p_payment_id = any (p_new_ids)
     or (select count(distinct x) from unnest(p_new_ids) x) <> v_parts - 1 then
    raise exception 'split_payment: нужен платёж и от 1 до 49 разных новых id' using errcode = '22023';
  end if;

  select p.* into v_p
  from public.client_payments p
  join public.clients c on c.id = p.client_id
  where p.id = p_payment_id and c.trainer_id = v_uid
  for update of p;
  if not found then
    raise exception 'split_payment: платёж не найден' using errcode = '42501';
  end if;

  -- Повтор: части уже созданы (проверка после блокировки — два одновременных повтора
  -- выстраиваются в очередь, второй видит результат первого).
  if exists (select 1 from public.client_payments p where p.id = any (p_new_ids)) then
    return;
  end if;

  v_base := floor(v_p.amount / v_parts);

  update public.client_payments
  set amount = v_base,
      note = btrim(format('%s (часть 1/%s)', coalesce(v_p.note, ''), v_parts))
  where id = p_payment_id;

  insert into public.client_payments (id, client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status)
  select p_new_ids[i - 1], v_p.client_id, v_p.date,
         case when i = v_parts then v_p.amount - v_base * (v_parts - 1) else v_base end,
         v_p.type,
         btrim(format('%s (часть %s/%s)', coalesce(v_p.note, ''), i, v_parts)),
         v_p.promo_applied, null, v_p.pay_status
  from generate_series(2, v_parts) as i;
end;
$$;

-- 4. Правка настроек абонемента — только переданные ключи. Возвращает абонемент.
create or replace function public.patch_membership(p_client_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m jsonb;
begin
  if p_client_id is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch_membership: нужен подопечный и объект правки' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(p_patch) e
    where e.key not in ('type', 'total', 'packagePrice', 'pricePerSession', 'nextPaymentDate', 'note', 'split')
       or (e.key = 'split' and jsonb_typeof(e.value) <> 'boolean')
       or (e.key <> 'split' and jsonb_typeof(e.value) <> 'string')
  ) then
    raise exception 'patch_membership: можно менять только настройки (type, total, packagePrice, pricePerSession, nextPaymentDate, note — строки; split — boolean)'
      using errcode = '22023';
  end if;

  update public.clients
  set membership = coalesce(membership, '{}'::jsonb) || p_patch
  where id = p_client_id and trainer_id = v_uid
  returning membership into m;
  if not found then
    raise exception 'patch_membership: подопечный не найден' using errcode = '42501';
  end if;
  return m;
end;
$$;

-- 5. Привязать сплит-партнёра: общий тип/пакет/остаток. Возвращает абонемент p_client_id.
create or replace function public.link_split_partner(p_client_id uuid, p_partner_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m jsonb;
  v_name text;
  v_pname text;
begin
  if p_client_id is null or p_partner_id is null or p_client_id = p_partner_id then
    raise exception 'link_split_partner: нужны два разных подопечных' using errcode = '22023';
  end if;
  -- Обе строки — в одном порядке, чтобы встречные привязки не взаимоблокировались.
  perform 1 from public.clients c
  where c.id in (p_client_id, p_partner_id) and c.trainer_id = v_uid
  order by c.id
  for update;

  select c.membership, c.name into m, v_name from public.clients c where c.id = p_client_id and c.trainer_id = v_uid;
  if not found then raise exception 'link_split_partner: подопечный не найден' using errcode = '42501'; end if;
  select c.name into v_pname from public.clients c where c.id = p_partner_id and c.trainer_id = v_uid;
  if not found then raise exception 'link_split_partner: партнёр не найден' using errcode = '42501'; end if;

  m := coalesce(m, '{}'::jsonb) || jsonb_build_object('split', true, 'partnerClientId', p_partner_id::text, 'partnerName', v_pname);
  update public.clients set membership = m where id = p_client_id;

  update public.clients
  set membership = coalesce(membership, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'type', m -> 'type', 'total', m -> 'total', 'packagePrice', m -> 'packagePrice',
         'pricePerSession', m -> 'pricePerSession', 'remaining', m -> 'remaining',
         'remainingPrice', m -> 'remainingPrice', 'remainingTotal', m -> 'remainingTotal',
         'extraRemaining', m -> 'extraRemaining', 'extraPricePerSession', m -> 'extraPricePerSession',
         'paymentDate', m -> 'paymentDate', 'nextPaymentDate', m -> 'nextPaymentDate'))
    || jsonb_build_object('split', true, 'partnerClientId', p_client_id::text, 'partnerName', v_name)
  where id = p_partner_id;

  return m;
end;
$$;

-- 6. Отвязать сплит-партнёра (у партнёра — только если он указывает на этого подопечного).
create or replace function public.unlink_split_partner(p_client_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m jsonb;
  v_partner uuid;
  v_unlink constant jsonb := '{"split": false, "partnerClientId": "", "partnerName": ""}'::jsonb;
begin
  -- Ревью этапа 2: подопечного и партнёра по сплиту блокируем в порядке id, как lock_clients
  -- в функциях списания, — иначе оплата A и завершение тренировки B взаимно блокируются
  perform 1 from public.clients c
  where c.trainer_id = v_uid and c.id in (
    select p_client_id
    union all
    select (c2.membership->>'partnerClientId')::uuid from public.clients c2
    where c2.id = p_client_id
      and c2.membership->>'partnerClientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  order by c.id
  for update;

  select c.membership into m
  from public.clients c
  where c.id = p_client_id and c.trainer_id = v_uid
  for update;
  if not found then
    raise exception 'unlink_split_partner: подопечный не найден' using errcode = '42501';
  end if;

  if (m ->> 'partnerClientId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_partner := (m ->> 'partnerClientId')::uuid;
  end if;

  m := coalesce(m, '{}'::jsonb) || v_unlink;
  update public.clients set membership = m where id = p_client_id;

  if v_partner is not null then
    update public.clients
    set membership = membership || v_unlink
    where id = v_partner and trainer_id = v_uid
      and membership ->> 'partnerClientId' = p_client_id::text;
  end if;

  return m;
end;
$$;

-- Права: только вошедший пользователь.
revoke execute on function public.membership_num(text) from public, anon;
revoke execute on function public.record_payment(uuid, uuid, date, numeric, text, text, jsonb) from public, anon;
revoke execute on function public.delete_payment(uuid, uuid) from public, anon;
revoke execute on function public.split_payment(uuid, uuid[]) from public, anon;
revoke execute on function public.patch_membership(uuid, jsonb) from public, anon;
revoke execute on function public.link_split_partner(uuid, uuid) from public, anon;
revoke execute on function public.unlink_split_partner(uuid) from public, anon;
grant execute on function public.membership_num(text) to authenticated;
grant execute on function public.record_payment(uuid, uuid, date, numeric, text, text, jsonb) to authenticated;
grant execute on function public.delete_payment(uuid, uuid) to authenticated;
grant execute on function public.split_payment(uuid, uuid[]) to authenticated;
grant execute on function public.patch_membership(uuid, jsonb) to authenticated;
grant execute on function public.link_split_partner(uuid, uuid) to authenticated;
grant execute on function public.unlink_split_partner(uuid) to authenticated;

-- Проверка после применения (только чтение):
--   select proname, prosecdef, proconfig,
--          has_function_privilege('anon', oid, 'execute') as anon_exec,
--          has_function_privilege('authenticated', oid, 'execute') as auth_exec
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('membership_num','record_payment','delete_payment','split_payment',
--                     'patch_membership','link_split_partner','unlink_split_partner');
--   -- ожидается: 7 строк, prosecdef = false, proconfig = {search_path=""}, anon_exec = false, auth_exec = true
