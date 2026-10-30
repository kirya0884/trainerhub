-- Аудит 2026-10-30, этап 2: отметки занятий и списания тренером — пункты 13, 14, 20, 23, 24.
--
-- Что добавляется:
--   • session_charges.booking_id / occ_date — ключ «занятие + дата вхождения серии + клиент»;
--     уникальный индекс по нему: одно занятие у одного клиента списывается один раз (п.13, п.14);
--   • mark_occurrence(...) — статус занятия (или вхождения серии) + списание абонементов +
--     строки session_charges в ОДНОЙ транзакции (п.13, п.14, п.20);
--   • credit_session(...) — возврат/добавление тренировки (+ строка refund, + платёж за
--     разовую) одной транзакцией вместо записи абонемента целиком (п.18, п.20);
--   • charge_session(...) — списание одной тренировки (завершение тренировки тренером) с
--     абонементом и строкой заработка в одной транзакции (п.20: строка больше не теряется);
--   • move_occurrence(...) — перенос занятия слиянием одного ключа exceptions (не стирает статус);
--   • lock_clients(...) — единый порядок блокировок: подопечные по id, потом запись;
--   • apply_session_charge(...) — общее тело списания для двух функций выше, наружу не выдаётся;
--   • finish_client_session — дата строки заработка «client» по дню тренировки клиента,
--     а не по UTC (п.20). Сигнатура и остальная логика — как в этапе 1.
--
-- Совместимость: миграция только добавляет. Старый фронт (без этих RPC) работает как раньше:
-- его вставки в session_charges идут без booking_id и под уникальный индекс не попадают.
-- Порядок выкладки: сначала эта миграция, потом фронт.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ключ от повторов в session_charges.
-- occ_date: у серии — дата вхождения (ключ exceptions), у разовой записи — null.
-- NULLS NOT DISTINCT (PG15+, в проекте 17): у разовой записи (booking, null, client) тоже уникален.
-- Ключ ставят списания из mark_occurrence и finish_client_session (строка 'client', если клиент
-- завершил тренировку по занятию); возвраты (refund) и строки без занятия — вне ключа.
-- Запись удалили — строка заработка остаётся (история денег), ссылка обнуляется и выпадает из индекса.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.session_charges
  add column if not exists booking_id uuid references public.bookings(id) on delete set null,
  add column if not exists occ_date date;

create unique index if not exists session_charges_occurrence_key
  on public.session_charges (booking_id, occ_date, client_id) nulls not distinct
  where booking_id is not null and kind in ('workout', 'no_show', 'client');

-- Прямая вставка (старый фронт, бэкап) не должна ставить ключ на чужую запись:
-- иначе можно было бы заранее «занять» ключ чужого занятия.
drop policy if exists session_charges_insert_own on public.session_charges;
create policy session_charges_insert_own on public.session_charges for insert to authenticated
  with check (
    trainer_id = (select auth.uid())
    and exists (select 1 from public.clients c where c.id = client_id and c.trainer_id = (select auth.uid()))
    and (booking_id is null
         or exists (select 1 from public.bookings b where b.id = booking_id and b.trainer_id = (select auth.uid())))
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- Общее тело списания: строка клиента блокируется, остаток −1, доп. блок встаёт на место
-- основного, партнёр по сплиту получает тот же остаток, пишется строка заработка.
-- Правила те же, что у decrementMembershipRemaining на фронте:
--   подписка, пустой или нечисловой остаток, остаток ≤ 0 — ничего не списываем (null);
--   цена — текущего блока до списания (session_price), округление до копеек, как logCharge;
--   партнёру копируются только remaining/remainingPrice/extraRemaining/extraPricePerSession
--   (как syncMembershipToPartner), и только если он у того же тренера (п.3 этапа 1).
-- Права не проверяет — вызывается только из функций ниже, которые проверяют сами.
-- SECURITY INVOKER + revoke execute: напрямую через API не вызвать.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_session_charge(
  p_client_id uuid, p_kind text, p_date date, p_booking_id uuid default null, p_occ_date date default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare m jsonb; t_id uuid; left_n numeric; extra_n numeric; price numeric; v_partner text;
begin
  select c.membership, c.trainer_id into m, t_id from public.clients c where c.id = p_client_id for update;
  if not found then return null; end if;
  if (m->>'type') is not distinct from 'subscription' then return null; end if;
  -- Строгий разбор: «-1» (долг) не должен превратиться в 1, как в num_or_null
  if coalesce(m->>'remaining', '') !~ '^\s*-?\d+(\.\d+)?\s*$' then return null; end if;
  left_n := trim(m->>'remaining')::numeric;
  if left_n <= 0 then return null; end if;

  price := round(coalesce(public.session_price(m), 0), 2);
  m := jsonb_set(m, '{remaining}', to_jsonb((left_n - 1)::text));
  extra_n := coalesce(public.num_or_null(m->>'extraRemaining'), 0);
  if left_n - 1 <= 0 and extra_n > 0 then
    m := m || jsonb_build_object('remaining', m->'extraRemaining', 'remainingPrice', coalesce(m->'extraPricePerSession', '""'::jsonb),
                                 'remainingTotal', m->'extraRemaining', 'extraRemaining', '', 'extraPricePerSession', '');
  end if;
  update public.clients set membership = m where id = p_client_id;

  v_partner := m->>'partnerClientId';
  if (m->>'split') = 'true' and v_partner ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update public.clients set membership = membership || jsonb_strip_nulls(jsonb_build_object(
      'remaining', m->'remaining',
      'remainingPrice', m->'remainingPrice',
      'extraRemaining', m->'extraRemaining',
      'extraPricePerSession', m->'extraPricePerSession'))
    where id = v_partner::uuid and trainer_id = t_id;
  end if;

  insert into public.session_charges (trainer_id, client_id, date, amount, kind, booking_id, occ_date)
  values (t_id, p_client_id, p_date, price, p_kind, p_booking_id, p_occ_date);
  return m;
end; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Порядок блокировок (против взаимоблокировки). Все функции списания/возврата сначала
-- блокируют строки подопечных — переданных и их партнёров по сплиту — в порядке id, и только
-- потом запись календаря. Раньше mark_occurrence брал запись → клиента, а finish_client_session —
-- клиента → запись (и клиента → партнёра): пара A→B против B→A могла взаимно заблокироваться.
-- Партнёр берётся из membership без блокировки; если его успели поменять, лишняя блокировка
-- безвредна, а недостающую возьмёт apply_session_charge (редкий случай, как раньше).
-- SECURITY INVOKER + revoke execute: только изнутри функций ниже.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.lock_clients(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.clients c
  where c.id in (
    select x from unnest(coalesce(p_ids, '{}')) x where x is not null
    union
    select (c2.membership->>'partnerClientId')::uuid from public.clients c2
    where c2.id = any(p_ids) and (c2.membership->>'split') = 'true'
      and (c2.membership->>'partnerClientId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  order by c.id
  for update;
end; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Списание одной тренировки тренером без привязки к занятию (завершение тренировки —
-- lib/finishWorkout через decrementMembershipRemaining). Абонемент и строка заработка —
-- одна транзакция: строка больше не теряется молча (п.20).
-- p_date — дата тренировки с телефона тренера (его местный день), не UTC сервера.
-- Ответ: { charged: bool, membership: абонемент после списания }.
-- Ключа от повторов здесь нет: повтор завершения защищён шагами очереди в finishWorkout
-- (charge: { before } / "done") и гардами «уже проведена»; это поведение не меняется.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.charge_session(p_client_id uuid, p_kind text, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare m jsonb;
begin
  if p_kind is null or p_kind not in ('workout', 'no_show') then
    raise exception 'unknown charge kind %', p_kind using errcode = '22023';
  end if;
  perform 1 from public.clients c where c.id = p_client_id and c.trainer_id = (select auth.uid());
  if not found then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.lock_clients(array[p_client_id]);

  m := public.apply_session_charge(p_client_id, p_kind, coalesce(p_date, current_date));
  if m is not null then return jsonb_build_object('charged', true, 'membership', m); end if;
  return jsonb_build_object('charged', false,
    'membership', (select c.membership from public.clients c where c.id = p_client_id));
end; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- «Отметить и списать»: статус занятия + списания в одной транзакции (п.13, п.14).
--   p_booking_id — запись тренера;
--   p_occ_date   — у серии: дата вхождения (ключ exceptions, НЕ дата после переноса);
--                  у разовой записи не нужна (игнорируется);
--   p_status     — scheduled | done | no-show | cancelled;
--   p_charge_client_ids — кого списать (только для done / no-show; при других статусах
--                  игнорируется). Не участники записи пропускаются;
--   p_note       — новая заметка (для «Не пришёл: причина»); null — заметку не трогаем.
--
-- Правила списания (как было на фронте, но атомарно и с ключом):
--   • занятие уже было в этом статусе — не списываем (повтор, повторное сохранение формы);
--   • у клиента уже есть списание по этому занятию (ключ booking+occ_date+client, в т.ч. строка
--     'client' — клиент сам завершил тренировку по этому занятию) — не списываем;
--   • done: только абонемент type = 'sessions' (как CalendarView), и не списываем, если у клиента
--     за день занятия уже есть проведённая тренировка (plan_sessions, total > 0) — бывший
--     hasSessionOnDate (П12): её списал finishWorkout или finish_client_session;
--   • no-show: тип абонемента не проверяется (как markNoShow → decrementMembershipRemaining).
--   • сплит: каждый участник списывается по очереди от свежего (заблокированного) абонемента —
--     как последовательные вызовы на фронте. Смысл пары (одна тренировка на двоих?) не меняли.
-- Дата строки заработка — фактический день занятия: дата переноса, если вхождение перенесено.
-- Ответ: { status, charged: [client_id], skipped: [{ client_id, reason }] },
--   reason: same_status | already | session | no_membership | not_participant | nothing_to_charge.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mark_occurrence(
  p_booking_id uuid, p_occ_date date, p_status text,
  p_charge_client_ids uuid[] default '{}', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype; v_key text; v_prev text; v_date date; v_occ date; v_ex_date text;
  v_kind text; cid uuid; v_type text; charged uuid[] := '{}'; skipped jsonb := '[]'::jsonb;
begin
  if p_status is null or p_status not in ('scheduled', 'done', 'no-show', 'cancelled') then
    raise exception 'unknown status %', p_status using errcode = '22023';
  end if;
  -- Сначала подопечные (по id), потом запись — общий порядок блокировок (см. lock_clients)
  perform public.lock_clients(array(select c.id from public.clients c
    where c.id = any(coalesce(p_charge_client_ids, '{}')) and c.trainer_id = (select auth.uid())));
  select * into b from public.bookings where id = p_booking_id and trainer_id = (select auth.uid()) for update;
  if not found then raise exception 'booking not found' using errcode = '42501'; end if;

  if b.recurring then
    if p_occ_date is null or p_occ_date < b.date
       or (b.recur_until is not null and p_occ_date > b.recur_until)
       or (p_occ_date - b.date) % 7 <> 0 then
      raise exception 'date % is not an occurrence of this series', p_occ_date using errcode = '22023';
    end if;
    v_key     := to_char(p_occ_date, 'YYYY-MM-DD');
    v_prev    := coalesce(b.exceptions -> v_key ->> 'status', b.status, 'scheduled');
    v_ex_date := b.exceptions -> v_key ->> 'date';
    v_date    := case when v_ex_date ~ '^\d{4}-\d{2}-\d{2}$' then v_ex_date::date else p_occ_date end;
    v_occ     := p_occ_date;
    -- Правка только этой даты; остальные исключения не трогаем (слияние на сервере,
    -- без «прочитал весь exceptions — записал весь», которое затирало соседние правки)
    update public.bookings
    set exceptions = coalesce(exceptions, '{}'::jsonb) || jsonb_build_object(v_key,
          coalesce(exceptions -> v_key, '{}'::jsonb)
          || jsonb_build_object('status', p_status)
          || case when p_note is not null then jsonb_build_object('note', p_note) else '{}'::jsonb end)
    where id = b.id;
  else
    v_prev := coalesce(b.status, 'scheduled');
    v_date := b.date;
    v_occ  := null;
    update public.bookings set status = p_status, note = coalesce(p_note, note) where id = b.id;
  end if;

  v_kind := case p_status when 'done' then 'workout' when 'no-show' then 'no_show' end;
  if v_kind is not null then
    for cid in select distinct x from unnest(coalesce(p_charge_client_ids, '{}')) x where x is not null loop
      if v_prev = p_status then
        skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'same_status');
        continue;
      end if;
      if not exists (select 1 from public.booking_clients bc where bc.booking_id = b.id and bc.client_id = cid) then
        skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'not_participant');
        continue;
      end if;
      if exists (select 1 from public.session_charges s
                 where s.booking_id = b.id and s.occ_date is not distinct from v_occ
                   and s.client_id = cid and s.kind in ('workout', 'no_show', 'client')) then
        skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'already');
        continue;
      end if;
      if v_kind = 'workout' then
        select c.membership->>'type' into v_type from public.clients c where c.id = cid;
        if v_type is distinct from 'sessions' then
          skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'no_membership');
          continue;
        end if;
        if exists (select 1 from public.plan_sessions s join public.plans p on p.id = s.plan_id
                   where p.client_id = cid and p.deleted_at is null
                     and s.date = v_date and s.deleted_at is null and s.total > 0) then
          skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'session');
          continue;
        end if;
      end if;
      if public.apply_session_charge(cid, v_kind, v_date, b.id, v_occ) is not null then
        charged := charged || cid;
      else
        skipped := skipped || jsonb_build_object('client_id', cid, 'reason', 'nothing_to_charge');
      end if;
    end loop;
  end if;

  return jsonb_build_object('status', p_status, 'charged', to_jsonb(charged), 'skipped', skipped);
end; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Возврат / добавление одной тренировки в остаток (п.18, п.20; зеркало charge_session).
-- Было на фронте (incrementMembershipRemaining + addPayment): абонемент целиком из копии
-- экрана, партнёр по сплиту — целиком из его копии, строка возврата и платёж — отдельными
-- запросами (обрыв: +1 без платежа или платёж без +1, строка возврата терялась молча).
-- Стало — одна транзакция под блокировкой строки клиента. Правила прежние:
--   подписка — ничего не делаем (credited = false);
--   пустой остаток считается нулём (П5); нечисловой — ничего не делаем;
--   type → 'sessions'; remainingTotal поднимается, только если был пуст или 0;
--   партнёру по сплиту (только того же тренера) — только remaining;
--   p_refund_date — возврат по уважительной причине: строка refund на −цену текущего блока;
--   p_payment_id + p_payment_amount — разовая оплаченная тренировка: платёж 'single',
--     sessions_delta = 1 (delete_payment агента Б по нему вернёт остаток). Повтор с тем же
--     p_payment_id ничего не делает (duplicate = true).
-- Ответ: { credited, duplicate, membership }.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.credit_session(
  p_client_id uuid, p_refund_date date default null,
  p_payment_id uuid default null, p_payment_date date default null, p_payment_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare m jsonb; t_id uuid; v_raw text; base numeric; v_total numeric; v_partner text; price numeric;
begin
  perform 1 from public.clients c where c.id = p_client_id and c.trainer_id = (select auth.uid());
  if not found then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.lock_clients(array[p_client_id]);
  select c.membership, c.trainer_id into m, t_id from public.clients c
  where c.id = p_client_id and c.trainer_id = (select auth.uid()) for update;
  m := coalesce(m, '{}'::jsonb);
  if p_payment_id is not null and (p_payment_amount is null or p_payment_amount < 0) then
    raise exception 'credit_session: нужна сумма платежа >= 0' using errcode = '22023';
  end if;
  if p_payment_id is not null and exists (select 1 from public.client_payments p where p.id = p_payment_id) then
    return jsonb_build_object('credited', false, 'duplicate', true, 'membership', m);
  end if;
  if (m->>'type') is not distinct from 'subscription' then
    return jsonb_build_object('credited', false, 'duplicate', false, 'membership', m);
  end if;
  v_raw := coalesce(trim(m->>'remaining'), '');
  if v_raw = '' then base := 0;
  elsif v_raw ~ '^-?\d+(\.\d+)?$' then base := v_raw::numeric;
  else return jsonb_build_object('credited', false, 'duplicate', false, 'membership', m);
  end if;

  price := round(coalesce(public.session_price(m), 0), 2); -- цена блока ДО изменения, как blockPrice
  v_total := public.num_or_null(m->>'remainingTotal');
  m := m || jsonb_build_object('type', 'sessions', 'remaining', (base + 1)::text)
         || case when coalesce(v_total, 0) = 0 then jsonb_build_object('remainingTotal', (base + 1)::text) else '{}'::jsonb end;
  update public.clients set membership = m where id = p_client_id;

  v_partner := m->>'partnerClientId';
  if (m->>'split') = 'true' and v_partner ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update public.clients set membership = coalesce(membership, '{}'::jsonb) || jsonb_build_object('remaining', m->'remaining')
    where id = v_partner::uuid and trainer_id = t_id;
  end if;

  if p_refund_date is not null then
    insert into public.session_charges (trainer_id, client_id, date, amount, kind)
    values (t_id, p_client_id, p_refund_date, -price, 'refund');
  end if;
  if p_payment_id is not null then
    insert into public.client_payments (id, client_id, date, amount, type, note, promo_applied, sessions_delta, pay_status)
    values (p_payment_id, p_client_id, coalesce(p_payment_date, current_date), p_payment_amount, 'single', 'Разовая тренировка', '', 1, 'paid');
  end if;
  return jsonb_build_object('credited', true, 'duplicate', false, 'membership', m);
end; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Перенос занятия (перетаскивание в календаре). Раньше фронт писал весь exceptions из
-- копии на экране и мог стереть «Проведена», поставленную сервером (клиентом или другой
-- вкладкой). Теперь у серии сливается один ключ: exceptions[occ] || {date, time};
-- status и note этого ключа не трогаются. У разовой записи — date/time самой записи.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.move_occurrence(p_booking_id uuid, p_occ_date date, p_date date, p_time text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare b public.bookings%rowtype; v_key text;
begin
  if p_date is null then raise exception 'move_occurrence: нужна дата' using errcode = '22023'; end if;
  select * into b from public.bookings where id = p_booking_id and trainer_id = (select auth.uid()) for update;
  if not found then raise exception 'booking not found' using errcode = '42501'; end if;
  if b.recurring then
    if p_occ_date is null or p_occ_date < b.date
       or (b.recur_until is not null and p_occ_date > b.recur_until)
       or (p_occ_date - b.date) % 7 <> 0 then
      raise exception 'date % is not an occurrence of this series', p_occ_date using errcode = '22023';
    end if;
    v_key := to_char(p_occ_date, 'YYYY-MM-DD');
    update public.bookings
    set exceptions = coalesce(exceptions, '{}'::jsonb) || jsonb_build_object(v_key,
          coalesce(exceptions -> v_key, '{}'::jsonb)
          || jsonb_build_object('date', to_char(p_date, 'YYYY-MM-DD'))
          || case when p_time is not null then jsonb_build_object('time', p_time) else '{}'::jsonb end)
    where id = b.id;
  else
    update public.bookings set date = p_date, time = coalesce(p_time, time) where id = b.id;
  end if;
end; $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- П.20. finish_client_session: строка заработка «client» шла с date = current_date (UTC) —
-- утром во Владивостоке это вчерашний день, 1-го числа — прошлый месяц.
-- Дата берётся из тренировки, которую клиент только что записал (plan_sessions.date —
-- местный день телефона; runClientFinish пишет её ДО этого вызова, старый фронт тоже).
-- Нет такой записи — дата занятия из календаря (p_occ_date), иначе current_date, как раньше.
-- Окно −30..+1 день: тренировка из очереди без сети может дойти через несколько дней.
-- Почему не часовой пояс тренера: пояса нигде не хранится, а день тренировки уже есть
-- в данных и совпадает с тем, что клиент видел на экране; сигнатура не меняется —
-- старый фронт на телефонах получает исправление без обновления.
-- Ревью этапа 2: не списывает второй раз занятие, уже отмеченное тренером (ключ/статус), пишет
-- ключ занятия в строку 'client'; блокировки — клиент(ы) по id, потом запись.
-- Остальная логика — живое определение этапа 1 (сверено 30.10): списание, партнёр, отметка «проведена».
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.finish_client_session(p_client_id uuid, p_booking_id uuid default null, p_occ_date date default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare m jsonb; left_n numeric; extra_n numeric; partner_id uuid; t_id uuid; price numeric; v_active jsonb;
  b bookings%rowtype; v_key text; v_status text; v_date date; v_ex_date text; v_charge_date date;
  v_occ date; v_has_booking boolean := false; v_skip boolean := false;
begin
  select trainer_id into t_id from clients where id = p_client_id and auth_user_id = auth.uid();
  if not found then raise exception 'not authorized'; end if;
  -- Порядок блокировок: клиент и партнёр (по id), потом запись — как в mark_occurrence
  perform public.lock_clients(array[p_client_id]);
  select membership, active_session into m, v_active from clients
  where id = p_client_id and auth_user_id = auth.uid() for update;
  if not found then raise exception 'not authorized'; end if;
  if v_active is null then return; end if;

  -- Занятие, которое передал фронт (он ищет только «Запланированные»): ключ вхождения и статус
  if p_booking_id is not null then
    select * into b from bookings where id = p_booking_id and trainer_id = t_id for update;
    if found and exists (select 1 from booking_clients bc where bc.booking_id = b.id and bc.client_id = p_client_id) then
      if not b.recurring then
        v_status := coalesce(b.status, 'scheduled');
        v_date   := b.date;
        v_has_booking := true;
      elsif p_occ_date is not null and p_occ_date >= b.date
            and (b.recur_until is null or p_occ_date <= b.recur_until)
            and (p_occ_date - b.date) % 7 = 0 then
        v_key     := to_char(p_occ_date, 'YYYY-MM-DD');
        v_status  := coalesce(b.exceptions -> v_key ->> 'status', b.status, 'scheduled');
        v_ex_date := b.exceptions -> v_key ->> 'date';
        v_date    := case when v_ex_date ~ '^\d{4}-\d{2}-\d{2}$' then v_ex_date::date else p_occ_date end;
        v_occ     := p_occ_date;
        v_has_booking := true;
      end if;
    end if;
  end if;

  -- П.20: день строки заработка — день тренировки клиента (см. комментарий выше)
  select s.date into v_charge_date
  from plan_sessions s join plans p on p.id = s.plan_id
  where p.client_id = p_client_id and s.from_client and s.deleted_at is null
    and s.created_at > now() - interval '12 hours'
    and s.date between current_date - 30 and current_date + 1
  order by s.created_at desc limit 1;
  if v_charge_date is null and p_occ_date between current_date - 1 and current_date + 1 then
    v_charge_date := p_occ_date;
  end if;
  v_charge_date := coalesce(v_charge_date, current_date);

  -- Ревью этапа 2: тренер уже отметил это занятие («Проведена»/«Не пришёл» — списание по ключу
  -- занятия) — второй раз не списываем. Если занятие фронт не нашёл (оно уже не «Запланировано»),
  -- смотрим списание тренера по занятию за тот же день (правило П12: одно на день).
  -- Завершение тренировки при этом проходит как обычно.
  -- Статус 'done' без ключа — отметка markSessionDone, она списывает без ключа занятия.
  -- «Не пришёл» без списания (не тот тип абонемента) реальную тренировку не отменяет.
  if v_has_booking and (v_status = 'done'
       or exists (select 1 from session_charges s where s.booking_id = b.id and s.occ_date is not distinct from v_occ
                  and s.client_id = p_client_id and s.kind in ('workout', 'no_show', 'client'))) then
    v_skip := true;
  -- Только когда занятие не передано: второе занятие за день по своему ключу списывается
  elsif not v_has_booking and exists (select 1 from session_charges s where s.client_id = p_client_id and s.booking_id is not null
                  and s.kind = 'workout' and s.date = v_charge_date) then
    v_skip := true;
  end if;

  if not v_skip and (m->>'type') is distinct from 'subscription' and (m->>'remaining') is not null and (m->>'remaining') <> '' then
    left_n := (m->>'remaining')::numeric;
    if left_n > 0 then
      price := public.session_price(m);
      m := jsonb_set(m, '{remaining}', to_jsonb((left_n - 1)::text));
      extra_n := coalesce(nullif(m->>'extraRemaining', '')::numeric, 0);
      if left_n - 1 <= 0 and extra_n > 0 then
        m := m || jsonb_build_object('remaining', m->'extraRemaining', 'remainingPrice', coalesce(m->'extraPricePerSession', '""'::jsonb),
                                     'remainingTotal', m->'extraRemaining', 'extraRemaining', '', 'extraPricePerSession', '');
      end if;
      -- Ключ занятия в строке 'client': mark_occurrence потом увидит, что за занятие уже списано
      insert into session_charges (trainer_id, client_id, date, amount, kind, booking_id, occ_date)
      values (t_id, p_client_id, v_charge_date, coalesce(price, 0), 'client',
              case when v_has_booking then b.id end, case when v_has_booking then v_occ end);
    end if;
  end if;
  update clients set active_session = null, membership = m where id = p_client_id and auth_user_id = auth.uid();

  if (m->>'split') = 'true' and (m->>'partnerClientId') is not null and (m->>'partnerClientId') <> '' then
    partner_id := (m->>'partnerClientId')::uuid;
    update clients set membership = membership || jsonb_strip_nulls(jsonb_build_object(
      'remaining', m->'remaining',
      'remainingPrice', m->'remainingPrice',
      'extraRemaining', m->'extraRemaining',
      'extraPricePerSession', m->'extraPricePerSession'))
    where id = partner_id and trainer_id = t_id;
  end if;

  -- Отметка «проведена» (п.6 этапа 1): только запись на одного этого клиента, «Запланирована»,
  -- дата в окне вчера..завтра; все проверки молча
  if v_has_booking and v_status = 'scheduled' and v_date between current_date - 1 and current_date + 1
     and (select count(*) from booking_clients bc where bc.booking_id = b.id) = 1 then
    if b.recurring then
      update bookings
      set exceptions = coalesce(exceptions, '{}'::jsonb)
                       || jsonb_build_object(v_key, coalesce(exceptions -> v_key, '{}'::jsonb) || '{"status":"done"}'::jsonb)
      where id = b.id;
    else
      update bookings set status = 'done' where id = b.id;
    end if;
  end if;
end; $function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Права: EXECUTE по умолчанию выдан PUBLIC — забираем.
-- RPC — только вошедшим; общее тело списания — никому (вызывают только функции выше).
-- finish_client_session — create or replace сохраняет права этапа 1, повторяем для надёжности.
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function public.apply_session_charge(uuid, text, date, uuid, date) from public, anon, authenticated;
revoke execute on function public.lock_clients(uuid[]) from public, anon, authenticated;
revoke execute on function public.move_occurrence(uuid, date, date, text) from public, anon;
grant  execute on function public.move_occurrence(uuid, date, date, text) to authenticated;
revoke execute on function public.charge_session(uuid, text, date) from public, anon;
grant  execute on function public.charge_session(uuid, text, date) to authenticated;
revoke execute on function public.credit_session(uuid, date, uuid, date, numeric) from public, anon;
grant  execute on function public.credit_session(uuid, date, uuid, date, numeric) to authenticated;
revoke execute on function public.mark_occurrence(uuid, date, text, uuid[], text) from public, anon;
grant  execute on function public.mark_occurrence(uuid, date, text, uuid[], text) to authenticated;
revoke execute on function public.finish_client_session(uuid, uuid, date) from public, anon;
grant  execute on function public.finish_client_session(uuid, uuid, date) to authenticated;

notify pgrst, 'reload schema';

commit;
