-- Админ-панель: события клиентов, список админов и функции метрик.
-- Панель не читает таблицы напрямую: только эти функции, и каждая сначала проверяет,
-- что вызывающий — админ. Считается всё на сервере, наружу уходят числа.

-- ── 1. Журнал событий: кто (тренер/клиент), сеанс, устройство ──
alter table public.app_events add column if not exists actor text not null default 'trainer';
alter table public.app_events add constraint app_events_actor_chk check (actor in ('trainer', 'client'));
alter table public.app_events add column if not exists client_id uuid references public.clients(id) on delete cascade;
alter table public.app_events add column if not exists session_id text;
alter table public.app_events add column if not exists device text;
create index if not exists app_events_created_idx on public.app_events (created_at);
create index if not exists app_events_client_idx on public.app_events (client_id, created_at) where client_id is not null;

-- Тренер пишет только свои события; клиент — свои, с тренером из своей карточки
alter policy app_events_insert_own on public.app_events with check (trainer_id = (select auth.uid()) and actor = 'trainer');
create policy app_events_client_insert on public.app_events for insert to authenticated
  with check (actor = 'client' and exists (
    select 1 from public.clients c where c.id = app_events.client_id and c.auth_user_id = (select auth.uid()) and c.trainer_id = app_events.trainer_id));

-- ── 2. Админы ──
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security; -- политик нет: читать и писать только через функции

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.admin_assert() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then raise exception 'not admin' using errcode = '42501'; end if;
end $$;

-- ── 3. Аналитика: внутренняя схема, наружу (в API) не выставлена ──
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

-- Вся активность одной лентой: кто, чей тренер, когда, что
create or replace view analytics.activity as
select e.actor,
       case when e.actor = 'client' then e.client_id else e.trainer_id end as actor_id,
       e.trainer_id, e.created_at as ts, 'event'::text as source,
       e.event || coalesce(':' || e.target, '') as kind, e.session_id, e.device
from public.app_events e
union all
select case when s.from_client then 'client' else 'trainer' end,
       case when s.from_client then p.client_id else p.trainer_id end,
       p.trainer_id, s.created_at, 'workout',
       case when cl.is_self then 'workout:self' when s.from_client then 'workout:client' else 'workout:trainer' end, null, null
from public.plan_sessions s
join public.plans p on p.id = s.plan_id
join public.clients cl on cl.id = p.client_id
where s.deleted_at is null
union all
select case when c.is_self then 'trainer' else 'client' end,
       case when c.is_self then c.trainer_id else c.id end,
       c.trainer_id, f.created_at, 'food', case when c.is_self then 'food:self' else 'food:client' end, null, null
from public.food_entries f join public.clients c on c.id = f.client_id
union all
select m.sender, case when m.sender = 'client' then m.client_id else m.trainer_id end,
       m.trainer_id, m.created_at, 'message', 'message:' || m.sender, null, null
from public.messages m
union all
select 'trainer', c.trainer_id, c.trainer_id, (pm.date + time '12:00')::timestamptz, 'payment', 'payment', null, null
from public.client_payments pm join public.clients c on c.id = pm.client_id;

-- Исключаемые тренеры: админы (их собственная активность искажает картину)
create or replace function analytics.excluded(p_ex boolean) returns setof uuid
language sql stable set search_path = '' as $$
  select user_id from public.admins where p_ex;
$$;

-- Проведённые записи календаря по датам (у повторяющихся — отметки в exceptions)
create or replace view analytics.booking_occ as
select b.trainer_id, b.date as d, b.status from public.bookings b where not b.recurring
union all
select b.trainer_id, x.key::date, x.value->>'status'
from public.bookings b, jsonb_each(coalesce(b.exceptions, '{}'::jsonb)) x
where b.recurring and x.value ? 'status';

-- KPI за период
create or replace function analytics.kpis(p_from date, p_to date, p_tz text, p_ex boolean) returns jsonb
language sql stable set search_path = '' as $$
  with ex as (select * from analytics.excluded(p_ex)),
  act as (
    select a.actor, a.actor_id, (a.ts at time zone p_tz)::date as d
    from analytics.activity a
    where (a.ts at time zone p_tz)::date between p_from and p_to and a.trainer_id not in (select * from ex)),
  days as (select d, actor, count(distinct actor_id) n from act group by 1, 2),
  ws as (
    select s.from_client, cl.is_self from public.plan_sessions s
    join public.plans p on p.id = s.plan_id join public.clients cl on cl.id = p.client_id
    where s.deleted_at is null and s.date between p_from and p_to and p.trainer_id not in (select * from ex)),
  pay as (
    select pm.amount, pm.pay_status, pm.client_id from public.client_payments pm join public.clients c on c.id = pm.client_id
    where pm.date between p_from and p_to and c.trainer_id not in (select * from ex)),
  cl as (select * from public.clients where not is_self and trainer_id not in (select * from ex)),
  tr as (select * from public.trainers where id not in (select * from ex)),
  occ as (select * from analytics.booking_occ where d between p_from and p_to and trainer_id not in (select * from ex)),
  ndays as (select greatest(1, p_to - p_from + 1) as n)
  select jsonb_build_object(
    'trainers_total', (select count(*) from tr where (created_at at time zone p_tz)::date <= p_to),
    'new_trainers', (select count(*) from tr where (created_at at time zone p_tz)::date between p_from and p_to),
    'active_trainers', (select count(distinct actor_id) from act where actor = 'trainer'),
    'active_clients', (select count(distinct actor_id) from act where actor = 'client'),
    'dau_trainers', round((select coalesce(sum(n), 0) from days where actor = 'trainer')::numeric / (select n from ndays), 2),
    'dau_clients', round((select coalesce(sum(n), 0) from days where actor = 'client')::numeric / (select n from ndays), 2),
    'clients_total', (select count(*) from cl where deleted_at is null and (created_at at time zone p_tz)::date <= p_to),
    'new_clients', (select count(*) from cl where (created_at at time zone p_tz)::date between p_from and p_to),
    'portal_clients', (select count(*) from cl where deleted_at is null and auth_user_id is not null),
    'workouts', (select count(*) from ws where not is_self),
    'workouts_client', (select count(*) from ws where from_client and not is_self),
    'workouts_self', (select count(*) from ws where is_self),
    'bookings_done', (select count(*) from occ where status = 'done'),
    'no_shows', (select count(*) from occ where status = 'no-show'),
    'payments', (select count(*) from pay),
    'gmv', (select coalesce(sum(amount), 0) from pay where pay_status = 'paid' or pay_status is null),
    'gmv_pending', (select coalesce(sum(amount), 0) from pay where pay_status in ('deferred', 'installment')),
    'paying_clients', (select count(distinct client_id) from pay),
    'food_entries', (select count(*) from public.food_entries f join cl on cl.id = f.client_id where (f.created_at at time zone p_tz)::date between p_from and p_to),
    'messages', (select count(*) from public.messages m where (m.created_at at time zone p_tz)::date between p_from and p_to and m.trainer_id not in (select * from ex))
  );
$$;

create or replace function public.admin_kpis(p_from date, p_to date, p_tz text default 'Europe/Moscow', p_ex boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare n int := p_to - p_from + 1;
begin
  perform public.admin_assert();
  return jsonb_build_object('cur', analytics.kpis(p_from, p_to, p_tz, p_ex), 'prev', analytics.kpis(p_from - n, p_from - 1, p_tz, p_ex));
end $$;

-- Ряды по дням/неделям/месяцам
create or replace function public.admin_series(p_from date, p_to date, p_grain text default 'day', p_tz text default 'Europe/Moscow', p_ex boolean default true)
returns table (bucket date, active_trainers int, active_clients int, new_trainers int, new_clients int,
               workouts_trainer int, workouts_client int, workouts_self int, food int, payments int, gmv numeric,
               bookings_done int, no_shows int, events int, messages int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_assert();
  if p_grain not in ('day', 'week', 'month') then raise exception 'bad grain'; end if;
  return query
  with ex as (select * from analytics.excluded(p_ex)),
  b as (select generate_series(date_trunc(p_grain, p_from::timestamp), p_to::timestamp, ('1 ' || p_grain)::interval)::date as bucket),
  act as (
    select a.actor, a.actor_id, a.kind, a.source, date_trunc(p_grain, (a.ts at time zone p_tz))::date as bk
    from analytics.activity a
    where (a.ts at time zone p_tz)::date between p_from and p_to and a.trainer_id not in (select * from ex)),
  pay as (
    select date_trunc(p_grain, pm.date::timestamp)::date bk, pm.amount, pm.pay_status from public.client_payments pm
    join public.clients c on c.id = pm.client_id where pm.date between p_from and p_to and c.trainer_id not in (select * from ex)),
  occ as (select date_trunc(p_grain, d::timestamp)::date bk, status from analytics.booking_occ where d between p_from and p_to and trainer_id not in (select * from ex)),
  ntr as (select date_trunc(p_grain, (created_at at time zone p_tz))::date bk from public.trainers where (created_at at time zone p_tz)::date between p_from and p_to and id not in (select * from ex)),
  ncl as (select date_trunc(p_grain, (created_at at time zone p_tz))::date bk from public.clients where not is_self and (created_at at time zone p_tz)::date between p_from and p_to and trainer_id not in (select * from ex))
  select b.bucket,
    (select count(distinct actor_id) from act where bk = b.bucket and actor = 'trainer')::int,
    (select count(distinct actor_id) from act where bk = b.bucket and actor = 'client')::int,
    (select count(*) from ntr where bk = b.bucket)::int,
    (select count(*) from ncl where bk = b.bucket)::int,
    (select count(*) from act where bk = b.bucket and kind = 'workout:trainer')::int,
    (select count(*) from act where bk = b.bucket and kind = 'workout:client')::int,
    (select count(*) from act where bk = b.bucket and kind = 'workout:self')::int,
    (select count(*) from act where bk = b.bucket and kind = 'food:client')::int,
    (select count(*) from pay where bk = b.bucket)::int,
    (select coalesce(sum(amount), 0) from pay where bk = b.bucket and (pay_status = 'paid' or pay_status is null)),
    (select count(*) from occ where bk = b.bucket and status = 'done')::int,
    (select count(*) from occ where bk = b.bucket and status = 'no-show')::int,
    (select count(*) from act where bk = b.bucket and source = 'event')::int,
    (select count(*) from act where bk = b.bucket and source = 'message')::int
  from b order by b.bucket;
end $$;

-- DAU / WAU / MAU по дням (скользящие окна 7 и 30 дней)
create or replace function public.admin_active(p_from date, p_to date, p_tz text default 'Europe/Moscow', p_ex boolean default true)
returns table (d date, actor text, dau int, wau int, mau int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_assert();
  return query
  with ex as (select * from analytics.excluded(p_ex)),
  ad as (
    select distinct a.actor, a.actor_id, (a.ts at time zone p_tz)::date as day
    from analytics.activity a
    where (a.ts at time zone p_tz)::date between p_from - 29 and p_to and a.trainer_id not in (select * from ex)),
  dd as (select generate_series(p_from::timestamp, p_to::timestamp, interval '1 day')::date as d),
  ac as (select unnest(array['trainer', 'client']) as actor)
  select dd.d, ac.actor,
    (select count(distinct actor_id) from ad where ad.actor = ac.actor and ad.day = dd.d)::int,
    (select count(distinct actor_id) from ad where ad.actor = ac.actor and ad.day between dd.d - 6 and dd.d)::int,
    (select count(distinct actor_id) from ad where ad.actor = ac.actor and ad.day between dd.d - 29 and dd.d)::int
  from dd cross join ac order by 1, 2;
end $$;

-- Удержание по когортам: тренеры — от регистрации, клиенты — от первой активности
create or replace function public.admin_retention(p_actor text default 'trainer', p_grain text default 'week', p_periods int default 8,
  p_tz text default 'Europe/Moscow', p_ex boolean default true)
returns table (cohort date, size int, k int, active int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_assert();
  if p_grain not in ('week', 'month') then raise exception 'bad grain'; end if;
  return query
  with ex as (select * from analytics.excluded(p_ex)),
  ad as (
    select distinct a.actor_id, date_trunc(p_grain, (a.ts at time zone p_tz))::date as per
    from analytics.activity a where a.actor = p_actor and a.trainer_id not in (select * from ex)),
  start as (
    select t.id as actor_id, date_trunc(p_grain, (t.created_at at time zone p_tz))::date as coh
    from public.trainers t where p_actor = 'trainer' and t.id not in (select * from ex)
    union all
    select actor_id, min(per) from ad where p_actor = 'client' group by actor_id),
  cohorts as (select coh, count(*)::int as size from start
              where coh >= (date_trunc(p_grain, (now() at time zone p_tz)) - (p_periods || ' ' || p_grain)::interval)::date
              group by coh),
  per_k as (
    select s.coh,
      (case when p_grain = 'week' then (ad.per - s.coh) / 7
            else (extract(year from age(ad.per, s.coh)) * 12 + extract(month from age(ad.per, s.coh)))::int end) as k,
      count(distinct s.actor_id)::int as active
    from start s join ad on ad.actor_id = s.actor_id and ad.per >= s.coh
    group by 1, 2)
  select c.coh, c.size, pk.k, pk.active
  from cohorts c join per_k pk on pk.coh = c.coh
  where pk.k between 0 and p_periods
  order by 1, 3;
end $$;

-- Воронка активации тренеров, зарегистрированных в периоде
create or replace function public.admin_funnel(p_from date, p_to date, p_tz text default 'Europe/Moscow', p_ex boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.admin_assert();
  with ex as (select * from analytics.excluded(p_ex)),
  t as (select id from public.trainers where (created_at at time zone p_tz)::date between p_from and p_to and id not in (select * from ex)),
  cl as (select c.* from public.clients c where not c.is_self and c.trainer_id in (select id from t))
  select jsonb_build_array(
    jsonb_build_object('step', 'signup', 'n', (select count(*) from t)),
    jsonb_build_object('step', 'client', 'n', (select count(distinct trainer_id) from cl)),
    jsonb_build_object('step', 'plan', 'n', (select count(distinct p.trainer_id) from public.plans p join cl on cl.id = p.client_id)),
    jsonb_build_object('step', 'workout', 'n', (select count(distinct p.trainer_id) from public.plan_sessions s join public.plans p on p.id = s.plan_id join cl on cl.id = p.client_id where s.deleted_at is null)),
    jsonb_build_object('step', 'booking', 'n', (select count(distinct b.trainer_id) from public.bookings b where b.trainer_id in (select id from t))),
    jsonb_build_object('step', 'payment', 'n', (select count(distinct cl.trainer_id) from public.client_payments pm join cl on cl.id = pm.client_id)),
    jsonb_build_object('step', 'portal', 'n', (select count(distinct trainer_id) from cl where auth_user_id is not null)),
    jsonb_build_object('step', 'client_active', 'n', (select count(distinct a.trainer_id) from analytics.activity a where a.actor = 'client' and a.trainer_id in (select id from t)))
  ) into r;
  return r;
end $$;

-- Какими функциями пользуются активные тренеры
create or replace function public.admin_features(p_from date, p_to date, p_tz text default 'Europe/Moscow', p_ex boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.admin_assert();
  with ex as (select * from analytics.excluded(p_ex)),
  act as (select a.* from analytics.activity a where (a.ts at time zone p_tz)::date between p_from and p_to and a.trainer_id not in (select * from ex)),
  at as (select distinct trainer_id from act where actor = 'trainer'),
  f(feature, trainer_id) as (
    select 'workouts', trainer_id from act where kind in ('workout:trainer')
    union select 'client_workouts', trainer_id from act where kind = 'workout:client'
    union select 'calendar', trainer_id from analytics.booking_occ where d between p_from and p_to
    union select 'calendar', trainer_id from act where kind in ('view:calendar', 'create:booking')
    union select 'payments', trainer_id from act where kind = 'payment'
    union select 'nutrition', trainer_id from act where kind = 'food:client'
    union select 'portal', trainer_id from act where actor = 'client'
    union select 'chat', trainer_id from act where kind like 'message:%'
    union select 'me', trainer_id from act where kind in ('workout:self', 'food:self', 'view:me')
    union select 'plans', trainer_id from act where kind in ('view:plan', 'create:plan')
    union select 'reminders', trainer_id from act where kind like 'action:remind%'
    union select 'renewals', trainer_id from act where kind like 'action:renew%'
    union select 'no_show', trainer_id from act where kind like 'action:no_show%'
    union select 'offline', trainer_id from act where kind like 'action:offline%')
  select coalesce(jsonb_agg(jsonb_build_object('feature', feature, 'trainers', n, 'share', round(n::numeric / greatest(1, (select count(*) from at)), 3)) order by n desc), '[]'::jsonb)
  from (select feature, count(distinct trainer_id) n from f where trainer_id in (select trainer_id from at) group by feature) x
  into r;
  return jsonb_build_object('active', (select count(*) from (select distinct trainer_id from analytics.activity a where (a.ts at time zone p_tz)::date between p_from and p_to and a.actor = 'trainer' and a.trainer_id not in (select * from analytics.excluded(p_ex))) z), 'features', r);
end $$;

-- События и экраны: что открывают, кто, с каких устройств
create or replace function public.admin_events(p_from date, p_to date, p_tz text default 'Europe/Moscow', p_ex boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.admin_assert();
  with ex as (select * from analytics.excluded(p_ex)),
  e as (select * from public.app_events where (created_at at time zone p_tz)::date between p_from and p_to and trainer_id not in (select * from ex))
  select jsonb_build_object(
    'events', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
      select actor, event, target, count(*) n, count(distinct case when actor = 'client' then client_id else trainer_id end) users from e group by 1, 2, 3) x),
    'devices', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
      select coalesce(device, 'неизвестно') device, actor, count(distinct coalesce(session_id, id::text)) n from e group by 1, 2) x),
    'heatmap', (select coalesce(jsonb_agg(x), '[]') from (
      select extract(isodow from (created_at at time zone p_tz))::int dow, extract(hour from (created_at at time zone p_tz))::int h, count(*) n from e group by 1, 2) x)
  ) into r;
  return r;
end $$;

-- Сеансы: события одного человека с перерывом меньше 30 минут — один сеанс
create or replace function public.admin_sessions(p_from date, p_to date, p_tz text default 'Europe/Moscow', p_ex boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.admin_assert();
  with ex as (select * from analytics.excluded(p_ex)),
  e as (
    select actor, case when actor = 'client' then client_id else trainer_id end uid, created_at ts
    from public.app_events where (created_at at time zone p_tz)::date between p_from and p_to and trainer_id not in (select * from ex)),
  g as (select *, case when ts - lag(ts) over w > interval '30 minutes' or lag(ts) over w is null then 1 else 0 end as brk
        from e window w as (partition by actor, uid order by ts)),
  s as (select *, sum(brk) over (partition by actor, uid order by ts) sid from g),
  ss as (select actor, uid, sid, count(*) ev, extract(epoch from max(ts) - min(ts)) / 60 mins from s group by 1, 2, 3)
  select coalesce(jsonb_agg(jsonb_build_object('actor', actor, 'sessions', sessions, 'users', users,
    'avg_min', avg_min, 'median_min', median_min, 'events_per_session', eps)), '[]') from (
    select actor, count(*) sessions, count(distinct uid) users, round(avg(mins)::numeric, 1) avg_min,
      round((percentile_cont(0.5) within group (order by mins))::numeric, 1) median_min, round(avg(ev)::numeric, 1) eps
    from ss group by actor) x into r;
  return r;
end $$;

-- Бизнес: тарифная раскладка по числу клиентов, потенциальная выручка, оплаты
create or replace function public.admin_business(p_from date, p_to date, p_tz text default 'Europe/Moscow', p_ex boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.admin_assert();
  with ex as (select * from analytics.excluded(p_ex)),
  t as (select id from public.trainers where id not in (select * from ex)),
  cnt as (select t.id, (select count(*) from public.clients c where c.trainer_id = t.id and not c.is_self and c.deleted_at is null and coalesce(c.status, '') <> 'left') n from t),
  tier as (select id, n, case when n <= 3 then 'start' when n <= 15 then 'basic' when n <= 40 then 'pro' else 'studio' end tier,
                  case when n <= 3 then 0 when n <= 15 then 990 when n <= 40 then 1690 else 2590 end price from cnt),
  pay as (select pm.*, c.trainer_id from public.client_payments pm join public.clients c on c.id = pm.client_id
          where pm.date between p_from and p_to and c.trainer_id not in (select * from ex))
  select jsonb_build_object(
    'tiers', (select coalesce(jsonb_agg(x order by x.price), '[]') from (select tier, price, count(*) trainers, sum(price) mrr from tier group by 1, 2) x),
    'potential_mrr', (select coalesce(sum(price), 0) from tier),
    'clients_per_trainer', (select round(avg(n)::numeric, 1) from cnt),
    'by_type', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(type, '—') type, count(*) n, sum(amount) amount from pay group by 1) x),
    'by_status', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(pay_status, 'paid') status, count(*) n, sum(amount) amount from pay group by 1) x),
    'avg_check', (select round(avg(amount)) from pay),
    'top_trainers', (select coalesce(jsonb_agg(x order by x.gmv desc), '[]') from (
      select pay.trainer_id id, coalesce(tr.profile->>'name', '') as name, sum(amount) gmv, count(*) n
      from pay join public.trainers tr on tr.id = pay.trainer_id group by 1, 2 order by 3 desc limit 10) x)
  ) into r;
  return r;
end $$;

-- Тренеры: таблица со всеми показателями за период
create or replace function public.admin_trainers(p_from date, p_to date, p_tz text default 'Europe/Moscow', p_ex boolean default true)
returns table (id uuid, name text, email text, signed_up timestamptz, last_active timestamptz, active_days int, events int,
               clients int, portal_clients int, active_clients int, workouts int, client_workouts int, gmv numeric, tier text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform public.admin_assert();
  return query
  with ex as (select * from analytics.excluded(p_ex)),
  act as (select a.* from analytics.activity a where (a.ts at time zone p_tz)::date between p_from and p_to)
  select t.id, coalesce(nullif(t.profile->>'name', ''), t.brand, '')::text, u.email::text, t.created_at,
    (select max(a.ts) from analytics.activity a where a.trainer_id = t.id and a.actor = 'trainer'),
    (select count(distinct (a.ts at time zone p_tz)::date) from act a where a.trainer_id = t.id and a.actor = 'trainer')::int,
    (select count(*) from act a where a.trainer_id = t.id and a.source = 'event' and a.actor = 'trainer')::int,
    (select count(*) from public.clients c where c.trainer_id = t.id and not c.is_self and c.deleted_at is null)::int,
    (select count(*) from public.clients c where c.trainer_id = t.id and not c.is_self and c.deleted_at is null and c.auth_user_id is not null)::int,
    (select count(distinct a.actor_id) from act a where a.trainer_id = t.id and a.actor = 'client')::int,
    (select count(*) from act a where a.trainer_id = t.id and a.kind = 'workout:trainer')::int,
    (select count(*) from act a where a.trainer_id = t.id and a.kind = 'workout:client')::int,
    (select coalesce(sum(pm.amount), 0) from public.client_payments pm join public.clients c on c.id = pm.client_id
       where c.trainer_id = t.id and pm.date between p_from and p_to and (pm.pay_status = 'paid' or pm.pay_status is null)),
    (select case when n <= 3 then 'start' when n <= 15 then 'basic' when n <= 40 then 'pro' else 'studio' end
       from (select count(*) n from public.clients c where c.trainer_id = t.id and not c.is_self and c.deleted_at is null and coalesce(c.status, '') <> 'left') z)
  from public.trainers t left join auth.users u on u.id = t.id
  where t.id not in (select * from ex);
end $$;

-- Один тренер подробно: ряд активности и последние события
create or replace function public.admin_trainer(p_id uuid, p_from date, p_to date, p_tz text default 'Europe/Moscow') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.admin_assert();
  select jsonb_build_object(
    'daily', (select coalesce(jsonb_agg(x order by x.d), '[]') from (
      select (a.ts at time zone p_tz)::date d,
        count(*) filter (where a.actor = 'trainer' and a.source = 'event') trainer_events,
        count(*) filter (where a.actor = 'client') client_actions,
        count(*) filter (where a.kind like 'workout:%') workouts
      from analytics.activity a where a.trainer_id = p_id and (a.ts at time zone p_tz)::date between p_from and p_to group by 1) x),
    'recent', (select coalesce(jsonb_agg(x order by x.ts desc), '[]') from (
      select a.ts, a.actor, a.kind, a.device from analytics.activity a where a.trainer_id = p_id order by a.ts desc limit 60) x),
    'kinds', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
      select a.kind, count(*) n from analytics.activity a where a.trainer_id = p_id and (a.ts at time zone p_tz)::date between p_from and p_to group by 1) x)
  ) into r;
  return r;
end $$;

-- Доступ: только вошедшим (внутри — проверка на админа); анониму — ничего
do $$
declare f text;
begin
  foreach f in array array['admin_kpis(date,date,text,boolean)', 'admin_series(date,date,text,text,boolean)', 'admin_active(date,date,text,boolean)',
    'admin_retention(text,text,int,text,boolean)', 'admin_funnel(date,date,text,boolean)', 'admin_features(date,date,text,boolean)',
    'admin_events(date,date,text,boolean)', 'admin_sessions(date,date,text,boolean)', 'admin_business(date,date,text,boolean)',
    'admin_trainers(date,date,text,boolean)', 'admin_trainer(uuid,date,date,text)', 'admin_assert()', 'is_admin()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Первый админ — владелец
insert into public.admins (user_id) select id from auth.users where lower(email) = 'kirilka.tupikov@yandex.ru' on conflict do nothing;
