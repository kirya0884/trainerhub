-- Этап 13: ID тренера и подписки, выданные вручную из админки (бартер за рекламу, подарок,
-- бессрочная разработчику). Оплата картой позже будет писать сюда же (source = 'paid').
-- Лимиты тарифов эта миграция НЕ вводит — только хранит, у кого какой тариф.

-- 1. Короткий ID тренера: «R-» и 6 знаков без похожих (нет 0/O, 1/I/L)
create or replace function public.gen_public_id() returns text
language plpgsql volatile set search_path = '' as $$
declare
  abc constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  s text;
begin
  loop
    s := 'R-';
    for i in 1..6 loop s := s || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.trainers t where t.public_id = s);
  end loop;
  return s;
end $$;
revoke all on function public.gen_public_id() from public, anon, authenticated;

alter table public.trainers add column if not exists public_id text;
update public.trainers set public_id = public.gen_public_id() where public_id is null;
alter table public.trainers alter column public_id set not null;
create unique index if not exists trainers_public_id_key on public.trainers (public_id);

-- ID выдаёт база: при создании — всегда свой, менять нельзя (тренер может править свою строку)
create or replace function public.trainers_public_id() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.public_id := public.gen_public_id();
  elsif new.public_id is distinct from old.public_id then
    raise exception 'public_id is read-only' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trainers_public_id on public.trainers;
create trigger trainers_public_id before insert or update of public_id on public.trainers
  for each row execute function public.trainers_public_id();

-- «r7k4m2p», «R 7K4M2P», «r-7k4m2p» → «R-7K4M2P»
create or replace function public.norm_public_id(p text) returns text
language sql immutable set search_path = '' as $$
  select 'R-' || regexp_replace(regexp_replace(upper(coalesce(p, '')), '[^0-9A-Z]', '', 'g'), '^R(?=.{6}$)', '')
$$;

-- 2. Подписки: каждая выдача — строка; история не удаляется, отзыв — revoked_at
create table if not exists public.trainer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainers (id) on delete cascade,
  tier text not null check (tier in ('basic', 'pro', 'studio')),
  source text not null check (source in ('paid', 'barter', 'gift', 'developer', 'trial')),
  starts_at date not null default current_date,
  ends_at date,                              -- последний день включительно; null — бессрочно
  note text not null default '' check (length(note) <= 500),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists trainer_subscriptions_trainer_idx on public.trainer_subscriptions (trainer_id);
alter table public.trainer_subscriptions enable row level security;
revoke all on public.trainer_subscriptions from anon, authenticated;
grant select on public.trainer_subscriptions to authenticated;
drop policy if exists trainer_subscriptions_own on public.trainer_subscriptions;
create policy trainer_subscriptions_own on public.trainer_subscriptions for select to authenticated
  using (trainer_id = (select auth.uid()));

-- Действующая подписка: старший тариф, при равных — дольше действует. Нет — «Старт».
-- День считаем по Москве, как и админка.
create or replace function public.subscription_of(p_trainer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('tier', s.tier, 'source', s.source, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
       from public.trainer_subscriptions s
      where s.trainer_id = p_trainer and s.revoked_at is null
        and s.starts_at <= (now() at time zone 'Europe/Moscow')::date
        and (s.ends_at is null or s.ends_at >= (now() at time zone 'Europe/Moscow')::date)
      order by array_position(array['studio', 'pro', 'basic'], s.tier), s.ends_at desc nulls first
      limit 1),
    jsonb_build_object('tier', 'start'))
$$;
revoke all on function public.subscription_of(uuid) from public, anon, authenticated;

-- Для приложения: свой ID и тариф
create or replace function public.my_subscription() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.subscription_of(t.id) || jsonb_build_object('public_id', t.public_id)
    from public.trainers t where t.id = auth.uid()
$$;
revoke all on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;

-- 3. Админка (все — через admin_assert: админ и вход с кодом)
create or replace function public.admin_find_trainer(p_query text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_query, '')); r jsonb;
begin
  perform public.admin_assert();
  select jsonb_build_object('id', t.id, 'public_id', t.public_id, 'email', u.email,
           'name', coalesce(nullif(t.profile->>'name', ''), t.brand, ''), 'created_at', t.created_at,
           'sub', public.subscription_of(t.id))
    into r
    from public.trainers t left join auth.users u on u.id = t.id
   where t.public_id = public.norm_public_id(q) or (q like '%@%' and lower(u.email) = lower(q))
   limit 1;
  return r;
end $$;

create or replace function public.admin_trainer_subscriptions(p_trainer uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_assert();
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc)
    from public.trainer_subscriptions s where s.trainer_id = p_trainer), '[]');
end $$;

-- Все действующие и будущие выдачи — список «у кого подписка и до когда»
create or replace function public.admin_active_subscriptions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_assert();
  return coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('public_id', t.public_id, 'email', u.email,
           'name', coalesce(nullif(t.profile->>'name', ''), t.brand, ''))
           order by s.ends_at nulls last, s.created_at)
    from public.trainer_subscriptions s
    join public.trainers t on t.id = s.trainer_id left join auth.users u on u.id = t.id
   where s.revoked_at is null and (s.ends_at is null or s.ends_at >= (now() at time zone 'Europe/Moscow')::date)), '[]');
end $$;

create or replace function public.admin_grant_subscription(p_trainer uuid, p_tier text, p_source text,
  p_starts date, p_ends date, p_note text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v uuid;
begin
  perform public.admin_assert();
  insert into public.trainer_subscriptions (trainer_id, tier, source, starts_at, ends_at, note, granted_by)
  values (p_trainer, p_tier, p_source, coalesce(p_starts, (now() at time zone 'Europe/Moscow')::date), p_ends,
          left(btrim(coalesce(p_note, '')), 500), auth.uid())
  returning id into v;
  return v;
end $$;

create or replace function public.admin_revoke_subscription(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.admin_assert();
  update public.trainer_subscriptions set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

revoke all on function public.admin_find_trainer(text), public.admin_trainer_subscriptions(uuid),
  public.admin_active_subscriptions(), public.admin_grant_subscription(uuid, text, text, date, date, text),
  public.admin_revoke_subscription(uuid) from public, anon;
grant execute on function public.admin_find_trainer(text), public.admin_trainer_subscriptions(uuid),
  public.admin_active_subscriptions(), public.admin_grant_subscription(uuid, text, text, date, date, text),
  public.admin_revoke_subscription(uuid) to authenticated;

-- 4. Список тренеров в админке: + ID и действующая подписка (tier — как было, «по числу клиентов»)
drop function if exists public.admin_trainers(date, date, text, boolean);
create function public.admin_trainers(p_from date, p_to date, p_tz text DEFAULT 'Europe/Moscow'::text, p_ex boolean DEFAULT true)
 RETURNS TABLE(id uuid, name text, email text, signed_up timestamp with time zone, last_active timestamp with time zone, active_days integer, events integer, clients integer, portal_clients integer, active_clients integer, workouts integer, client_workouts integer, gmv numeric, tier text, public_id text, sub jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       from (select count(*) n from public.clients c where c.trainer_id = t.id and not c.is_self and c.deleted_at is null and coalesce(c.status, '') <> 'left') z),
    t.public_id,
    public.subscription_of(t.id)
  from public.trainers t left join auth.users u on u.id = t.id
  where t.id not in (select * from ex);
end $function$;
revoke all on function public.admin_trainers(date, date, text, boolean) from public, anon;
grant execute on function public.admin_trainers(date, date, text, boolean) to authenticated;

-- PostgREST: подхватить новые функции и таблицу без перезапуска
notify pgrst, 'reload schema';
