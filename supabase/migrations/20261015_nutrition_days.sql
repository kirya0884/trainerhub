-- Дни питания: комментарий тренера к дню и стаканы воды клиента.
-- Одна строка на подопечного и дату. Читают оба; пишут оба, но триггер не даёт
-- клиенту изменить комментарий тренера, а тренеру — воду клиента.
create table public.nutrition_days (
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null,
  water_cups integer not null default 0,
  trainer_comment text,
  comment_at timestamptz,
  primary key (client_id, date)
);

alter table public.nutrition_days enable row level security;

create policy days_rw on public.nutrition_days for all
  using (exists (select 1 from public.clients c where c.id = nutrition_days.client_id and (c.auth_user_id = (select auth.uid()) or c.trainer_id = (select auth.uid()))))
  with check (exists (select 1 from public.clients c where c.id = nutrition_days.client_id and (c.auth_user_id = (select auth.uid()) or c.trainer_id = (select auth.uid()))));

create or replace function public.nutrition_days_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_trainer boolean;
begin
  select c.trainer_id = auth.uid() into is_trainer from public.clients c where c.id = new.client_id;
  if coalesce(is_trainer, false) then
    -- тренер: вода остаётся как была
    new.water_cups := case when tg_op = 'UPDATE' then old.water_cups else 0 end;
    if tg_op = 'INSERT' or new.trainer_comment is distinct from old.trainer_comment then new.comment_at := now(); end if;
  else
    -- клиент: комментарий тренера не трогает
    new.trainer_comment := case when tg_op = 'UPDATE' then old.trainer_comment else null end;
    new.comment_at := case when tg_op = 'UPDATE' then old.comment_at else null end;
  end if;
  return new;
end;
$$;

create trigger nutrition_days_guard before insert or update on public.nutrition_days
  for each row execute function public.nutrition_days_guard();
