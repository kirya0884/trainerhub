-- Разбор путей, группа 6 «Питание и деньги вглубь», 01.11.2026.

-- 5.7: одноразовая акция («друг привёл друга −10%») действовала на все будущие оплаты.
-- once — после первой оплаты с ней акция выключается (это делает приложение);
-- until — последний день действия. Старые акции остаются как были (once = false).
alter table public.client_promotions
  add column if not exists once boolean not null default false,
  add column if not exists until date;

-- 5.3: срок остатка при оплате «частями» — отдельно от даты платежа (дата остаётся днём оплаты)
alter table public.client_payments add column if not exists due_date date;

-- 5.12: библиотека продуктов и рецептов тренера для всех его клиентов. Тренер ведёт их в своём
-- «Я» (карточка is_self) и отмечает «видят клиенты» — shared. Клиенту они только для чтения.
alter table public.food_products add column if not exists shared boolean not null default false;
alter table public.food_recipes add column if not exists shared boolean not null default false;

-- Карточка «Я» тренера вызывающего клиента. Клиенту строки clients тренера не видны, поэтому
-- definer; setof — чтобы в правилах проверка шла один раз на запрос (id in (select …)).
create or replace function public.my_trainer_food_owner_ids()
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select s.id
  from public.clients me
  join public.clients s on s.trainer_id = me.trainer_id and s.is_self and s.deleted_at is null
  where me.auth_user_id = (select auth.uid())
    and me.deleted_at is null
$$;
revoke all on function public.my_trainer_food_owner_ids() from public, anon;
grant execute on function public.my_trainer_food_owner_ids() to authenticated;

drop policy if exists client_reads_trainer_shared on public.food_products;
create policy client_reads_trainer_shared on public.food_products
  for select to authenticated
  using (shared and client_id in (select public.my_trainer_food_owner_ids()));

drop policy if exists client_reads_trainer_shared on public.food_recipes;
create policy client_reads_trainer_shared on public.food_recipes
  for select to authenticated
  using (shared and client_id in (select public.my_trainer_food_owner_ids()));

drop policy if exists client_reads_trainer_shared on public.food_recipe_items;
create policy client_reads_trainer_shared on public.food_recipe_items
  for select to authenticated
  using (recipe_id in (
    select r.id from public.food_recipes r
    where r.shared and r.client_id in (select public.my_trainer_food_owner_ids())));

-- 5.13: одна система целей КБЖУ и воды — «Цели питания» (nutrition_goals). Цели, которые тренер
-- задал во вкладке «Цели» (clients.goals), дневник не видел. Переносим их как цели тренера;
-- вода там в мл — в стаканы по 250 мл. Шаги, минуты и тренировки остаются в clients.goals.
-- Если клиент уже сам задал себе цели в дневнике — не перекрываем их старыми целями тренера.
-- Нечисловые значения пропускаем, чтобы миграция не упала на мусоре.
insert into public.nutrition_goals (client_id, set_by, kcal, protein, fat, carbs, water_cups, updated_at)
select c.id, 'trainer', v.kcal, v.protein, v.fat, v.carbs,
  nullif(round(v.water / 250), 0)::integer, now()
from public.clients c
cross join lateral (select
  case when jsonb_typeof(c.goals -> 'calories') = 'number' then (c.goals ->> 'calories')::numeric else 0 end as kcal,
  case when jsonb_typeof(c.goals -> 'protein') = 'number' then (c.goals ->> 'protein')::numeric else 0 end as protein,
  case when jsonb_typeof(c.goals -> 'fat') = 'number' then (c.goals ->> 'fat')::numeric else 0 end as fat,
  case when jsonb_typeof(c.goals -> 'carbs') = 'number' then (c.goals ->> 'carbs')::numeric else 0 end as carbs,
  case when jsonb_typeof(c.goals -> 'water') = 'number' then (c.goals ->> 'water')::numeric else 0 end as water) v
where c.deleted_at is null
  and (v.kcal > 0 or v.protein > 0 or v.fat > 0 or v.carbs > 0)
  and not exists (select 1 from public.nutrition_goals g where g.client_id = c.id and g.set_by = 'client')
on conflict (client_id, set_by) do nothing;
