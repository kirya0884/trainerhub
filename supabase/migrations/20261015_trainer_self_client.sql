-- «Я»: тренер ведёт свои тренировки и питание как собственный подопечный.
-- Карточка «это я» (is_self) не привязана ко входу (auth_user_id пустой — иначе тренера
-- перебросило бы в кабинет клиента) и скрыта из списков, оплат и статистики в приложении.
alter table public.clients add column is_self boolean not null default false;
create unique index clients_one_self_per_trainer on public.clients (trainer_id) where is_self;

-- Дневник питания своей карточки тренер пишет сам (у чужих подопечных — только читает)
create policy trainer_self_all on public.food_products for all
  using (exists (select 1 from public.clients c where c.id = food_products.client_id and c.is_self and c.trainer_id = (select auth.uid())))
  with check (exists (select 1 from public.clients c where c.id = food_products.client_id and c.is_self and c.trainer_id = (select auth.uid())));
create policy trainer_self_all on public.food_recipes for all
  using (exists (select 1 from public.clients c where c.id = food_recipes.client_id and c.is_self and c.trainer_id = (select auth.uid())))
  with check (exists (select 1 from public.clients c where c.id = food_recipes.client_id and c.is_self and c.trainer_id = (select auth.uid())));
create policy trainer_self_all on public.food_recipe_items for all
  using (exists (select 1 from public.food_recipes r join public.clients c on c.id = r.client_id where r.id = food_recipe_items.recipe_id and c.is_self and c.trainer_id = (select auth.uid())))
  with check (exists (select 1 from public.food_recipes r join public.clients c on c.id = r.client_id where r.id = food_recipe_items.recipe_id and c.is_self and c.trainer_id = (select auth.uid())));
create policy trainer_self_all on public.food_entries for all
  using (exists (select 1 from public.clients c where c.id = food_entries.client_id and c.is_self and c.trainer_id = (select auth.uid())))
  with check (exists (select 1 from public.clients c where c.id = food_entries.client_id and c.is_self and c.trainer_id = (select auth.uid())));
create policy trainer_self_all on public.nutrition_goals for all
  using (exists (select 1 from public.clients c where c.id = nutrition_goals.client_id and c.is_self and c.trainer_id = (select auth.uid())))
  with check (exists (select 1 from public.clients c where c.id = nutrition_goals.client_id and c.is_self and c.trainer_id = (select auth.uid())));

-- Вода: в своей карточке тренер — он же «клиент», воду ведёт сам
create or replace function public.nutrition_days_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_trainer boolean;
  self boolean;
begin
  select c.trainer_id = auth.uid(), c.is_self into is_trainer, self from public.clients c where c.id = new.client_id;
  if coalesce(self, false) then
    return new;
  end if;
  if coalesce(is_trainer, false) then
    new.water_cups := case when tg_op = 'UPDATE' then old.water_cups else 0 end;
    if tg_op = 'INSERT' or new.trainer_comment is distinct from old.trainer_comment then new.comment_at := now(); end if;
  else
    new.trainer_comment := case when tg_op = 'UPDATE' then old.trainer_comment else null end;
    new.comment_at := case when tg_op = 'UPDATE' then old.comment_at else null end;
  end if;
  return new;
end;
$$;
