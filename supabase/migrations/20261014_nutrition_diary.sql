-- Дневник питания: свои продукты, рецепты, записи по приёмам пищи и цели.
-- Значения в записях дневника — снимок на момент записи: правка продукта или рецепта
-- прошлые дни не меняет. Старая nutrition_logs (итог дня) остаётся как есть.

-- Свои продукты клиента: КБЖУ на 100 г
create table public.food_products (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  kcal numeric not null default 0,
  protein numeric not null default 0,
  fat numeric not null default 0,
  carbs numeric not null default 0,
  favorite boolean not null default false,
  last_grams numeric,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index food_products_client_idx on public.food_products (client_id, last_used_at desc nulls last);

-- Рецепты: КБЖУ на 100 г считаются по составу и весу готового блюда
create table public.food_recipes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  cooked_weight numeric,
  servings integer not null default 1,
  favorite boolean not null default false,
  last_grams numeric,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index food_recipes_client_idx on public.food_recipes (client_id);

-- Состав рецепта: сырой вес и КБЖУ на 100 г продукта
create table public.food_recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.food_recipes(id) on delete cascade,
  product_id uuid references public.food_products(id) on delete set null,
  name text not null,
  grams numeric not null default 0,
  kcal numeric not null default 0,
  protein numeric not null default 0,
  fat numeric not null default 0,
  carbs numeric not null default 0,
  position integer not null default 0
);
create index food_recipe_items_recipe_idx on public.food_recipe_items (recipe_id);

-- Записи дневника: сколько съедено (итоговые КБЖУ уже посчитаны по граммам)
create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  product_id uuid references public.food_products(id) on delete set null,
  recipe_id uuid references public.food_recipes(id) on delete set null,
  name text not null,
  grams numeric not null default 0,
  kcal numeric not null default 0,
  protein numeric not null default 0,
  fat numeric not null default 0,
  carbs numeric not null default 0,
  created_at timestamptz not null default now()
);
create index food_entries_client_date_idx on public.food_entries (client_id, date);

-- Цели: своя у клиента и от тренера; действует тренерская, если она есть
create table public.nutrition_goals (
  client_id uuid not null references public.clients(id) on delete cascade,
  set_by text not null check (set_by in ('client', 'trainer')),
  kcal numeric not null default 0,
  protein numeric not null default 0,
  fat numeric not null default 0,
  carbs numeric not null default 0,
  water_cups integer,
  updated_at timestamptz not null default now(),
  primary key (client_id, set_by)
);

alter table public.food_products enable row level security;
alter table public.food_recipes enable row level security;
alter table public.food_recipe_items enable row level security;
alter table public.food_entries enable row level security;
alter table public.nutrition_goals enable row level security;

-- Клиент ведёт своё; тренер читает своих подопечных
create policy client_owns_own on public.food_products for all
  using (exists (select 1 from public.clients c where c.id = food_products.client_id and c.auth_user_id = (select auth.uid())))
  with check (exists (select 1 from public.clients c where c.id = food_products.client_id and c.auth_user_id = (select auth.uid())));
create policy trainer_reads on public.food_products for select
  using (exists (select 1 from public.clients c where c.id = food_products.client_id and c.trainer_id = (select auth.uid())));

create policy client_owns_own on public.food_recipes for all
  using (exists (select 1 from public.clients c where c.id = food_recipes.client_id and c.auth_user_id = (select auth.uid())))
  with check (exists (select 1 from public.clients c where c.id = food_recipes.client_id and c.auth_user_id = (select auth.uid())));
create policy trainer_reads on public.food_recipes for select
  using (exists (select 1 from public.clients c where c.id = food_recipes.client_id and c.trainer_id = (select auth.uid())));

create policy client_owns_own on public.food_recipe_items for all
  using (exists (select 1 from public.food_recipes r join public.clients c on c.id = r.client_id where r.id = food_recipe_items.recipe_id and c.auth_user_id = (select auth.uid())))
  with check (exists (select 1 from public.food_recipes r join public.clients c on c.id = r.client_id where r.id = food_recipe_items.recipe_id and c.auth_user_id = (select auth.uid())));
create policy trainer_reads on public.food_recipe_items for select
  using (exists (select 1 from public.food_recipes r join public.clients c on c.id = r.client_id where r.id = food_recipe_items.recipe_id and c.trainer_id = (select auth.uid())));

create policy client_owns_own on public.food_entries for all
  using (exists (select 1 from public.clients c where c.id = food_entries.client_id and c.auth_user_id = (select auth.uid())))
  with check (exists (select 1 from public.clients c where c.id = food_entries.client_id and c.auth_user_id = (select auth.uid())));
create policy trainer_reads on public.food_entries for select
  using (exists (select 1 from public.clients c where c.id = food_entries.client_id and c.trainer_id = (select auth.uid())));

-- Цели видят оба; меняет каждый только свою строку
create policy goals_read on public.nutrition_goals for select
  using (exists (select 1 from public.clients c where c.id = nutrition_goals.client_id and (c.auth_user_id = (select auth.uid()) or c.trainer_id = (select auth.uid()))));
create policy goals_client_write on public.nutrition_goals for all
  using (set_by = 'client' and exists (select 1 from public.clients c where c.id = nutrition_goals.client_id and c.auth_user_id = (select auth.uid())))
  with check (set_by = 'client' and exists (select 1 from public.clients c where c.id = nutrition_goals.client_id and c.auth_user_id = (select auth.uid())));
create policy goals_trainer_write on public.nutrition_goals for all
  using (set_by = 'trainer' and exists (select 1 from public.clients c where c.id = nutrition_goals.client_id and c.trainer_id = (select auth.uid())))
  with check (set_by = 'trainer' and exists (select 1 from public.clients c where c.id = nutrition_goals.client_id and c.trainer_id = (select auth.uid())));
