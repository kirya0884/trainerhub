-- Аудит 2026-10-30, этап 1 (доступ к чужим данным): пункты 1, 2, 3, 4, 5, 6, 7, 11.
-- Применять одним куском и сразу после этого выкладывать фронтенд из того же коммита:
-- новый фронт зовёт RPC из этой миграции (PIN, finish_client_session с занятием), старый после неё
-- просто не увидит PIN (столбцы pin_hash обнулены) и не сможет его поставить.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- П.1. Привязка карточки по email при входе.
-- link_client_self() привязывала к вошедшему ВСЕ непривязанные карточки с его почтой
-- у всех тренеров. Привязку делает только register-client (service_role, своя карточка
-- тренера). Вызов из App.tsx убран в этом же коммите.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.link_client_self();


-- ─────────────────────────────────────────────────────────────────────────────
-- П.5, п.7. PIN — отдельная закрытая таблица вместо clients.pin_hash / trainers.pin_hash.
--
-- Почему не column-level revoke на pin_hash: фронт читает clients через select("*")
-- (backup.ts) и insert(...).select() (clients.ts), PostgREST разворачивает это в
-- SELECT всех столбцов — отнятое право на один столбец ломает эти запросы; любой
-- новый столбец пришлось бы потом выдавать вручную. Отдельная таблица без политик
-- закрыта целиком и заодно хранит счётчик попыток.
--
-- Ключ — auth-пользователь (тренер или клиент): у входа один PIN.
-- Хеш — bcrypt (pgcrypto). Старый формат (hex SHA-256 от строки PIN без соли, как
-- считал src/lib/pin.ts) принимается check_my_pin и при успехе перехешируется.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.user_pins (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  pin_hash        text not null,
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);
comment on table public.user_pins is
  'PIN экрана входа (bcrypt) и счётчик неудачных попыток. Доступ только через RPC set/clear/check/has_my_pin.';

-- RLS включён, политик нет и прав у ролей API нет: прочитать хеш нельзя никому, кроме функций ниже
alter table public.user_pins enable row level security;
revoke all on table public.user_pins from public, anon, authenticated;

-- Перенос существующих хешей (на 30.10 в живой базе их 0, перенос на случай, если появятся до применения).
-- Тренер приоритетнее: если вход и тренер, и клиент — берём PIN тренера, как и App.tsx.
insert into public.user_pins (user_id, pin_hash)
select t.id, t.pin_hash from public.trainers t
where coalesce(t.pin_hash, '') <> ''
on conflict (user_id) do nothing;

insert into public.user_pins (user_id, pin_hash)
select distinct on (c.auth_user_id) c.auth_user_id, c.pin_hash from public.clients c
where c.auth_user_id is not null and coalesce(c.pin_hash, '') <> ''
order by c.auth_user_id, c.created_at desc
on conflict (user_id) do nothing;

-- Старые столбцы обнуляем, а не удаляем: закэшированный старый фронт читает их
-- (select "id, pin_hash") и при удалённом столбце упал бы на проверке доступа.
-- Удалить столбцы — отдельной миграцией после обновления всех клиентов.
update public.trainers set pin_hash = null where pin_hash is not null;
update public.clients  set pin_hash = null where pin_hash is not null;
comment on column public.trainers.pin_hash is 'УСТАРЕЛО (2026-10-30): PIN в public.user_pins. Всегда null, удалить позже.';
comment on column public.clients.pin_hash  is 'УСТАРЕЛО (2026-10-30): PIN в public.user_pins. Всегда null, удалить позже.';

-- Поставить / сменить PIN текущего пользователя. PIN — 4–8 цифр.
create or replace function public.set_my_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN должен состоять из 4–8 цифр' using errcode = '22023';
  end if;
  insert into public.user_pins (user_id, pin_hash, failed_attempts, locked_until, updated_at)
  values (v_uid, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), 0, null, now())
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();
end;
$$;

-- Снять PIN текущего пользователя
create or replace function public.clear_my_pin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.user_pins where user_id = v_uid;
end;
$$;

-- Задан ли PIN у текущего пользователя
create or replace function public.has_my_pin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  return exists (select 1 from public.user_pins where user_id = v_uid);
end;
$$;

-- Проверить PIN. 5 неудач подряд → блок на 5 минут (ошибка 'pin_locked', в detail — до какого времени).
-- Неудачу не сообщаем исключением, а возвращаем false: исключение откатило бы счётчик попыток.
-- PIN не задан → true (защищать нечего; PIN могли снять на другом устройстве).
create or replace function public.check_my_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  r        public.user_pins%rowtype;
  v_legacy boolean;
  v_ok     boolean;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  -- for update: параллельные попытки не обходят счётчик
  select * into r from public.user_pins where user_id = v_uid for update;
  if not found then return true; end if;

  if r.locked_until is not null and r.locked_until > now() then
    raise exception 'pin_locked' using errcode = 'P0001', detail = r.locked_until::text;
  end if;

  v_legacy := r.pin_hash ~ '^[0-9a-f]{64}$';  -- старый формат pin.ts: hex(sha256(pin))
  if v_legacy then
    v_ok := r.pin_hash = encode(extensions.digest(coalesce(p_pin, ''), 'sha256'), 'hex');
  else
    v_ok := r.pin_hash = extensions.crypt(coalesce(p_pin, ''), r.pin_hash);
  end if;

  if v_ok then
    update public.user_pins set
      failed_attempts = 0,
      locked_until    = null,
      pin_hash        = case when v_legacy then extensions.crypt(p_pin, extensions.gen_salt('bf', 10)) else pin_hash end,
      updated_at      = case when v_legacy then now() else updated_at end
    where user_id = v_uid;
    return true;
  end if;

  update public.user_pins set
    failed_attempts = case when r.failed_attempts + 1 >= 5 then 0 else r.failed_attempts + 1 end,
    locked_until    = case when r.failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end
  where user_id = v_uid;
  return false;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- П.2. auth_user_id и pin_hash в clients меняет только сервер.
-- Роли API (authenticated/anon): при INSERT значения молча обнуляются (импорт старого
-- бэкапа с pin_hash не падает), при UPDATE смена — ошибка.
-- service_role (register-client, delete-account), postgres (SECURITY DEFINER-функции,
-- каскад ON DELETE SET NULL от auth.users) — проходят: у них current_user другой.
-- Функция SECURITY INVOKER — иначе current_user был бы её владельцем.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.clients_guard_login_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.auth_user_id := null;
    new.pin_hash := null;
  elsif new.auth_user_id is distinct from old.auth_user_id
     or new.pin_hash is distinct from old.pin_hash then
    raise exception 'auth_user_id и pin_hash меняет только сервер' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists clients_guard_login_fields on public.clients;
create trigger clients_guard_login_fields
  before insert or update of auth_user_id, pin_hash on public.clients
  for each row execute function public.clients_guard_login_fields();

-- То же для trainers.pin_hash: старая версия фронта (PWA обновляется по кнопке и живёт днями)
-- писала туда SHA-256 без соли. Фронт обновляет trainers только столбцами profile и brand/logo_url
-- (lib/trainer.ts, без upsert целой строки) — триггер на «update of pin_hash» их не задевает.
-- Строку тренера создаёт handle_new_trainer (postgres) — проходит.
create or replace function public.trainers_guard_pin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.pin_hash := null;
  elsif new.pin_hash is distinct from old.pin_hash then
    raise exception 'pin_hash меняет только сервер: PIN задаётся через set_my_pin' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trainers_guard_pin on public.trainers;
create trigger trainers_guard_pin
  before insert or update of pin_hash on public.trainers
  for each row execute function public.trainers_guard_pin();


-- ─────────────────────────────────────────────────────────────────────────────
-- П.3, п.6, п.7. finish_client_session. Тело — живое определение от 30.10, изменения:
--  • п.3: абонемент «партнёра» (split) меняется, только если партнёр того же тренера;
--  • списание только если тренировка действительно идёт (active_session не пуст), строка
--    клиента блокируется for update. Повторный вызов через API, вторая вкладка или повтор
--    из очереди после уже прошедшего завершения ничего не списывают и не падают (тихий выход —
--    фронт идёт дальше, как раньше). Пути фронта: онлайн-старт пишет active_session через
--    start_client_session; офлайн-старт сначала дошлёт start_client_session (outbox, offlineStart);
--    повтор из очереди сам проверяет active_session перед вызовом;
--  • п.6: отметка «проведена» в календаре тренера делается здесь же, вместе с реальным
--    завершением тренировки (отдельной RPC для клиента нет — ей можно было бы отметить любую
--    запись без тренировки). Фронт передаёт найденное занятие (p_booking_id, p_occ_date —
--    дата занятия серии). Отмечается, только если: запись этого тренера; в ней ровно один
--    участник — этот клиент (групповую отмечает тренер, иначе календарь не спишет у остальных:
--    CalendarView списывает только при переходе в «Проведена»); статус 'scheduled'; дата
--    занятия в окне вчера..завтра. Иначе отметка молча пропускается, завершение не срывается.
-- Сигнатура меняется (новые параметры с default) — старую удаляем, иначе PostgREST
-- не выберет между перегрузками. Старый фронт зовёт с одним p_client_id — подходит.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.finish_client_session(uuid);
create function public.finish_client_session(p_client_id uuid, p_booking_id uuid default null, p_occ_date date default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare m jsonb; left_n numeric; extra_n numeric; partner_id uuid; t_id uuid; price numeric; v_active jsonb;
  b bookings%rowtype; v_key text; v_status text; v_date date; v_ex_date text;
begin
  select membership, trainer_id, active_session into m, t_id, v_active from clients
  where id = p_client_id and auth_user_id = auth.uid() for update;
  if not found then raise exception 'not authorized'; end if;
  -- Тренировка не идёт — завершать и списывать нечего
  if v_active is null then return; end if;
  if (m->>'type') is distinct from 'subscription' and (m->>'remaining') is not null and (m->>'remaining') <> '' then
    left_n := (m->>'remaining')::numeric;
    if left_n > 0 then
      price := public.session_price(m);
      m := jsonb_set(m, '{remaining}', to_jsonb((left_n - 1)::text));
      extra_n := coalesce(nullif(m->>'extraRemaining', '')::numeric, 0);
      if left_n - 1 <= 0 and extra_n > 0 then
        m := m || jsonb_build_object('remaining', m->'extraRemaining', 'remainingPrice', coalesce(m->'extraPricePerSession', '""'::jsonb),
                                     'remainingTotal', m->'extraRemaining', 'extraRemaining', '', 'extraPricePerSession', '');
      end if;
      insert into session_charges (trainer_id, client_id, amount, kind) values (t_id, p_client_id, coalesce(price, 0), 'client');
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

  -- Отметка «проведена» (п.6) — все проверки молча, без исключений
  if p_booking_id is not null then
    select * into b from bookings where id = p_booking_id and trainer_id = t_id for update;
    if found
       and (select count(*) from booking_clients bc where bc.booking_id = b.id) = 1
       and exists (select 1 from booking_clients bc where bc.booking_id = b.id and bc.client_id = p_client_id) then
      if not b.recurring then
        v_status := coalesce(b.status, 'scheduled');
        v_date   := b.date;
      elsif p_occ_date is not null and p_occ_date >= b.date
            and (b.recur_until is null or p_occ_date <= b.recur_until)
            and (p_occ_date - b.date) % 7 = 0 then
        v_key     := to_char(p_occ_date, 'YYYY-MM-DD');
        v_status  := coalesce(b.exceptions -> v_key ->> 'status', b.status, 'scheduled');
        v_ex_date := b.exceptions -> v_key ->> 'date';
        v_date    := case when v_ex_date ~ '^\d{4}-\d{2}-\d{2}$' then v_ex_date::date else p_occ_date end;
      end if;
      -- current_date — по UTC, окно ±1 день покрывает часовой пояс клиента
      if v_status = 'scheduled' and v_date between current_date - 1 and current_date + 1 then
        if b.recurring then
          update bookings
          set exceptions = coalesce(exceptions, '{}'::jsonb)
                           || jsonb_build_object(v_key, coalesce(exceptions -> v_key, '{}'::jsonb) || '{"status":"done"}'::jsonb)
          where id = b.id;
        else
          update bookings set status = 'done' where id = b.id;
        end if;
      end if;
    end if;
  end if;
end; $function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- П.4. Тренер пишет строки только для СВОИХ подопечных.
-- Раньше политики trainer_owns проверяли только trainer_id — client_id мог быть чужим,
-- и строка появлялась в кабинете чужого клиента (client_reads_own смотрит на client_id).
-- Чтение (USING) прежнее; проверка клиента — в WITH CHECK (INSERT/UPDATE), по PK clients.
-- Проверено 30.10: нарушающих строк в plans/messages/booking_clients/app_events — 0.
-- Таблицы client_* / food_* / nutrition_* уже проверяют через clients.trainer_id,
-- session_charges — тоже; plan_* наследуют проверку от plans.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists trainer_owns on public.plans;
create policy trainer_owns on public.plans
  for all to authenticated
  using (trainer_id = (select auth.uid()))
  with check (
    trainer_id = (select auth.uid())
    and exists (select 1 from public.clients c where c.id = plans.client_id and c.trainer_id = (select auth.uid()))
  );

drop policy if exists trainer_owns on public.messages;
create policy trainer_owns on public.messages
  for all to authenticated
  using (trainer_id = (select auth.uid()))
  with check (
    trainer_id = (select auth.uid())
    and exists (select 1 from public.clients c where c.id = messages.client_id and c.trainer_id = (select auth.uid()))
  );

drop policy if exists trainer_owns on public.booking_clients;
create policy trainer_owns on public.booking_clients
  for all to authenticated
  using (public.is_trainer_of_booking(booking_id))
  with check (
    public.is_trainer_of_booking(booking_id)
    and exists (select 1 from public.clients c where c.id = booking_clients.client_id and c.trainer_id = (select auth.uid()))
  );

-- События аналитики от тренера: client_id сейчас всегда null (lib/events.ts), чужой не подставить
drop policy if exists app_events_insert_own on public.app_events;
create policy app_events_insert_own on public.app_events
  for insert to authenticated
  with check (
    trainer_id = (select auth.uid()) and actor = 'trainer'
    and (client_id is null
         or exists (select 1 from public.clients c where c.id = app_events.client_id and c.trainer_id = (select auth.uid())))
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- П.11. Push-триггер на clients отправлял в pg_net всю строку (здоровье, email,
-- телефон, абонемент, pin_hash) — она оседает в net._http_response / логах.
-- send-push читает только id, trainer_id, name и active_session.status.
-- Шлём только их (active_session — без progress). Контракт send-push тот же,
-- функцию передеплоивать не нужно. Тело — живое определение от 30.10, изменено только body.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_trainer_on_session_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_secret text;
begin
  if old.active_session is distinct from new.active_session then
    begin
      select decrypted_secret into v_secret
      from vault.decrypted_secrets
      where name = 'send_push_secret'
      limit 1;

      if v_secret is not null then
        perform net.http_post(
          url := 'https://epbrivrgtbkptqnhkxnr.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-webhook-secret', v_secret
          ),
          body := jsonb_build_object(
            'type', 'UPDATE',
            'table', 'clients',
            'schema', 'public',
            'record', jsonb_build_object(
              'id', new.id, 'trainer_id', new.trainer_id, 'name', new.name,
              'active_session', case when new.active_session is null then null else jsonb_strip_nulls(jsonb_build_object(
                'status', new.active_session -> 'status',
                'startedAt', new.active_session -> 'startedAt',
                'dayName', new.active_session -> 'dayName')) end),
            'old_record', jsonb_build_object(
              'id', old.id, 'trainer_id', old.trainer_id, 'name', old.name,
              'active_session', case when old.active_session is null then null else jsonb_strip_nulls(jsonb_build_object(
                'status', old.active_session -> 'status',
                'startedAt', old.active_session -> 'startedAt',
                'dayName', old.active_session -> 'dayName')) end)
          )
        );
      end if;
    exception when others then
      -- Текст ошибки без значения секрета; сохранение клиента не срываем
      raise warning 'notify_trainer_on_session_change: push не отправлен (%): %', sqlstate, sqlerrm;
    end;
  end if;
  return new;
end;
$function$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Права на новые функции: только вошедшие (EXECUTE по умолчанию выдан PUBLIC).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.set_my_pin(text)',
    'public.clear_my_pin()',
    'public.has_my_pin()',
    'public.check_my_pin(text)',
    -- пересоздана с новой сигнатурой — права заново
    'public.finish_client_session(uuid, uuid, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Триггерные функции вызывает только триггер
  execute 'revoke execute on function public.clients_guard_login_fields() from public, anon, authenticated';
  execute 'revoke execute on function public.trainers_guard_pin() from public, anon, authenticated';
  execute 'revoke execute on function public.notify_trainer_on_session_change() from public, anon, authenticated';
end $$;

-- PostgREST: новая сигнатура finish_client_session и новые RPC — перечитать схему
notify pgrst, 'reload schema';

commit;
