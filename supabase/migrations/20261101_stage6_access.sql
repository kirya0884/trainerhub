-- Этап 6: доступ клиента по ссылке, доказательство согласий, второй фактор в админке.
-- («Один вход — несколько тренеров» отложено до своей почты: register-client чужой вход не привязывает.)
-- Пары к миграции: register-client (ссылка вместо пароля), delete-account (с вводом пароля) и фронт (запись согласий через RPC, MFA в админке).
--
-- Порядок выкатки: эта миграция → функции register-client и delete-account → фронт и админка.
-- Пока фронт старый, ломается ровно одно: прямая запись в user_consents (право отнято в п.3) —
-- новые согласия со старой PWA не запишутся, экран согласия покажет ошибку до обновления.
-- И админка без второго фактора перестаёт открываться (п.4) — сначала подключи TOTP в админке.


-- ─────────────────────────────────────────────────────────────────────────────
-- П.1. У одного тренера — не больше одной карточки на вход (иначе кабинет не поймёт,
-- какую показывать, а register-client привязал бы второй раз). Карточки одного входа
-- у разных тренеров индекс не запрещает — это задел на отложенное «несколько тренеров».
-- Перед применением проверить, что дублей нет (ожидание: 0 строк):
--   select trainer_id, auth_user_id, count(*) from public.clients
--   where auth_user_id is not null group by 1, 2 having count(*) > 1;
-- Если строки есть — индекс не создастся и миграция упадёт целиком; лишнюю привязку
-- снять вручную (update public.clients set auth_user_id = null where id = '…' — от postgres).
-- Поиск по одному auth_user_id (политики client_reads_*) по-прежнему идёт по
-- clients_auth_user_id_idx (20261015_perf_indexes_rls.sql) — этот индекс его не заменяет.
-- ─────────────────────────────────────────────────────────────────────────────
create unique index if not exists clients_trainer_auth_user_key
  on public.clients (trainer_id, auth_user_id)
  where auth_user_id is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- П.2. Поиск входа по почте — для register-client. admin.listUsers не фильтрует по email
-- надёжно (постранично, без точного совпадения), поэтому служебная функция.
-- Только service_role: иначе любой вошедший перебирал бы, какие почты зарегистрированы.
-- Почта в auth.users уникальна для обычных (не SSO) входов; limit 1 — на всякий случай.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.created_at
  limit 1;
$$;
comment on function public.auth_user_id_by_email(text) is
  'Служебная: id входа по почте (без учёта регистра). Только service_role (register-client).';

revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- П.3. Согласия (152-ФЗ: оператор должен доказать, кто, когда и что принял).
-- Было: фронт сам писал строку в user_consents — время, user-agent и любые поля meta
-- приходили от клиента; при удалении аккаунта журнал удалялся каскадом, и доказательство
-- согласия пропадало вместе с ним.
-- Стало:
--  • запись только через record_consents(): время — now() на сервере, ip (cf-connecting-ip,
--    иначе первый из x-forwarded-for) и user-agent — из заголовков запроса (PostgREST кладёт
--    их в request.headers), amr и session_id — из JWT;
--    из p_meta берутся только известные ключи (age, source);
--  • прямой INSERT у authenticated отнят, политика insert удалена (без права она мертва,
--    а если право когда-нибудь вернут по ошибке — без политики RLS всё равно не пустит);
--  • user_id → on delete set null, плюс снимок почты user_email: после удаления аккаунта
--    строка остаётся (кто — по почте), но читать её через API некому — политика select
--    смотрит на user_id = auth.uid(), с null строка не видна никому, кроме postgres.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.user_consents add column if not exists user_email text;

-- Снимок почты для уже записанных согласий
update public.user_consents uc
set user_email = u.email
from auth.users u
where u.id = uc.user_id and uc.user_email is null;

alter table public.user_consents alter column user_id drop not null;

-- FK на auth.users пересоздаём с on delete set null. Имя ограничения ищем, а не угадываем.
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.user_consents'::regclass and c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.user_consents drop constraint %I', v_name);
  end loop;
end $$;
alter table public.user_consents
  add constraint user_consents_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

comment on table public.user_consents is
  'Журнал согласий. Пишется только через record_consents(). Строки не правятся и не удаляются; '
  'при удалении аккаунта user_id становится null, остаётся снимок user_email.';
comment on column public.user_consents.user_email is 'Почта входа на момент согласия (снимок, живёт после удаления аккаунта).';

drop policy if exists user_consents_insert_own on public.user_consents;
revoke insert on public.user_consents from authenticated, anon;

create or replace function public.record_consents(p_kinds text[], p_version text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_headers json;
  v_ip      text;
  v_meta    jsonb;
  v_kind    text;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;

  if p_kinds is null or cardinality(p_kinds) = 0 then
    raise exception 'Не указано, с чем согласие' using errcode = '22023';
  end if;
  foreach v_kind in array p_kinds loop
    if v_kind is null or v_kind not in ('terms', 'consent', 'consent_client', 'health', 'guardian') then
      raise exception 'Неизвестный вид согласия: %', coalesce(v_kind, 'null') using errcode = '22023';
    end if;
  end loop;
  if p_version is null or trim(p_version) = '' or length(p_version) > 50 then
    raise exception 'Не указана редакция документов' using errcode = '22023';
  end if;

  -- Заголовки запроса от PostgREST; вне API (SQL Editor) их нет — тогда ip/ua пустые
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  -- IP: cf-connecting-ip (его выставляет Cloudflare перед API, присланный клиентом перезаписывается),
  -- иначе первый адрес из x-forwarded-for
  v_ip := coalesce(
    nullif(trim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''));

  select u.email into v_email from auth.users u where u.id = v_uid;

  -- От клиента — только известные ключи и допустимые значения, остальное отбрасывается
  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'age',        case when p_meta ->> 'age' in ('adult', 'teen', 'child') then p_meta ->> 'age' end,
    'source',     case when p_meta ->> 'source' in ('signup') then p_meta ->> 'source' end,
    'ip',         left(v_ip, 64),
    'ua',         left(v_headers ->> 'user-agent', 300),
    'amr',        auth.jwt() -> 'amr',
    'session_id', auth.jwt() ->> 'session_id'
  ));

  insert into public.user_consents (user_id, user_email, kind, version, accepted_at, meta)
  select v_uid, v_email, k, trim(p_version), now(), v_meta
  from (select distinct unnest(p_kinds) as k) x;
end;
$$;
comment on function public.record_consents(text[], text, jsonb) is
  'Записать согласия текущего пользователя: время, ip, user-agent, amr и session_id ставит сервер.';

revoke all on function public.record_consents(text[], text, jsonb) from public, anon;
grant execute on function public.record_consents(text[], text, jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- П.4. Админка — только со вторым фактором (TOTP): в JWT aal = 'aal2'.
-- is_admin() и admin_assert() теперь требуют aal2; все admin_* зовут admin_assert() —
-- их сигнатуры и права не меняются (create or replace сохраняет права).
-- is_admin_member() — только членство, без aal: админка по ней понимает
-- «ты админ, пройди второй фактор». Отвечает только про самого вызывающего.
-- Проверено по коду: is_admin зовёт только admin/src/lib/api.ts; в политиках и других
-- функциях (миграции) не используется — проверка в живой базе ниже (запрос 6).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function public.admin_assert() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then raise exception 'not admin' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'aal2 required' using errcode = '42501'; end if;
end $$;

create or replace function public.is_admin_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin_member() from public, anon;
grant execute on function public.is_admin_member() to authenticated;

-- PostgREST: новые RPC — перечитать схему
notify pgrst, 'reload schema';


-- ── Проверки после применения (только чтение) ──
-- 1) Индекс на месте и уникальный:
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and indexname = 'clients_trainer_auth_user_key';
-- 2) Права на функции: auth_user_id_by_email — только service_role (и postgres);
--    record_consents и is_admin_member — authenticated, без anon и без PUBLIC (=X/):
--   select p.proname, p.prosecdef, p.proconfig, p.proacl from pg_proc p
--   where p.pronamespace = 'public'::regnamespace
--     and p.proname in ('auth_user_id_by_email', 'record_consents', 'is_admin', 'is_admin_member', 'admin_assert');
--   -- ожидание: prosecdef = true, proconfig = {search_path=""}
-- 3) user_consents: прямой insert закрыт, select остался, политики insert нет:
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'user_consents' and grantee in ('anon', 'authenticated');
--   -- ожидание: только authenticated SELECT
--   select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'user_consents';
--   -- ожидание: только user_consents_select_own (SELECT)
-- 4) FK согласий — set null, user_id допускает null, снимок почты заполнен:
--   select conname, confdeltype from pg_constraint
--   where conrelid = 'public.user_consents'::regclass and contype = 'f';   -- ожидание: confdeltype = 'n'
--   select count(*) from public.user_consents where user_email is null and user_id is not null;  -- ожидание: 0
-- 5) Админы: членство без второго фактора видно, доступ — нет (из SQL Editor JWT нет,
--    поэтому проверять из админки: is_admin_member() = true, is_admin() = false до TOTP).
--   select user_id from public.admins;
-- 6) is_admin() нигде больше не используется (ожидание: 0 строк в обоих запросах,
--    кроме самих is_admin / admin_assert / is_admin_member):
--   select schemaname, tablename, policyname from pg_policies
--   where qual ilike '%is_admin%' or with_check ilike '%is_admin%';
--   select p.oid::regprocedure from pg_proc p
--   where p.prosrc ilike '%is_admin(%' and p.proname not in ('is_admin', 'is_admin_member');
