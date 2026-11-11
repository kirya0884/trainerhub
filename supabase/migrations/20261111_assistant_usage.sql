-- Помощник: дневной лимит разборов на тренера (защита от неожиданного счёта Яндекса).
-- Таблица только добавляется, существующие таблицы и данные не меняются.
--
-- Доступ: таблицу и функции использует только edge-функция assistant с ключом service_role.
-- У anon и authenticated прав нет: RLS включён без правил, а EXECUTE отозван.

create table if not exists public.assistant_usage (
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (trainer_id, day)
);

alter table public.assistant_usage enable row level security;
revoke all on table public.assistant_usage from anon, authenticated;

-- Взять один разбор: +1, если лимит не исчерпан. Возвращает новое значение или null, если лимит исчерпан.
create or replace function public.assistant_take(p_trainer uuid, p_day date, p_limit integer)
returns integer
language sql
security invoker
set search_path = ''
as $$
  insert into public.assistant_usage as u (trainer_id, day, count)
  values (p_trainer, p_day, 1)
  on conflict (trainer_id, day) do update set count = u.count + 1
    where u.count < p_limit
  returning u.count;
$$;

-- Вернуть разбор, если он не удался (ошибка Яндекса или в тексте нечего разбирать).
create or replace function public.assistant_refund(p_trainer uuid, p_day date)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.assistant_usage set count = count - 1
  where trainer_id = p_trainer and day = p_day and count > 0;
$$;

revoke all on function public.assistant_take(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.assistant_refund(uuid, date) from public, anon, authenticated;
grant execute on function public.assistant_take(uuid, date, integer) to service_role;
grant execute on function public.assistant_refund(uuid, date) to service_role;
grant select, insert, update on table public.assistant_usage to service_role;

-- Проверка после применения (ожидается: rls=t, у anon/authenticated нет прав):
-- select relrowsecurity as rls from pg_class where oid = 'public.assistant_usage'::regclass;
-- select grantee, privilege_type from information_schema.role_table_grants where table_name = 'assistant_usage';
-- select proname, proacl from pg_proc where proname in ('assistant_take', 'assistant_refund');
