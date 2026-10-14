-- Скорость с ростом данных (аудит 2026-10-15). Данные и смысл правил доступа не меняются.

-- 1) Индексы на внешние ключи: открытие плана, история тренировок и проверки прав
--    ходят по этим связям (дни → план, упражнения → день, подходы → упражнение и т.д.).
create index if not exists booking_clients_client_id_idx on public.booking_clients (client_id);
create index if not exists bookings_plan_id_idx on public.bookings (plan_id);
create index if not exists client_activities_client_id_idx on public.client_activities (client_id);
create index if not exists client_notes_client_id_idx on public.client_notes (client_id);
create index if not exists client_photos_client_id_idx on public.client_photos (client_id);
create index if not exists client_promotions_client_id_idx on public.client_promotions (client_id);
create index if not exists clients_auth_user_id_idx on public.clients (auth_user_id);
create index if not exists day_templates_trainer_id_idx on public.day_templates (trainer_id);
create index if not exists exercise_library_trainer_id_idx on public.exercise_library (trainer_id);
create index if not exists food_entries_product_id_idx on public.food_entries (product_id);
create index if not exists food_entries_recipe_id_idx on public.food_entries (recipe_id);
create index if not exists food_recipe_items_product_id_idx on public.food_recipe_items (product_id);
create index if not exists messages_trainer_id_idx on public.messages (trainer_id);
create index if not exists nutrition_logs_client_id_idx on public.nutrition_logs (client_id);
create index if not exists package_templates_trainer_id_idx on public.package_templates (trainer_id);
create index if not exists plan_days_mesocycle_id_idx on public.plan_days (mesocycle_id);
create index if not exists plan_days_plan_id_idx on public.plan_days (plan_id);
create index if not exists plan_exercise_set_rows_exercise_id_idx on public.plan_exercise_set_rows (exercise_id);
create index if not exists plan_exercises_day_id_idx on public.plan_exercises (day_id);
create index if not exists plan_mesocycles_plan_id_idx on public.plan_mesocycles (plan_id);
create index if not exists plan_progress_notes_plan_id_idx on public.plan_progress_notes (plan_id);
create index if not exists plan_session_items_session_id_idx on public.plan_session_items (session_id);
create index if not exists plan_templates_trainer_id_idx on public.plan_templates (trainer_id);
create index if not exists plans_trainer_id_idx on public.plans (trainer_id);

-- 2) Правила доступа: auth.uid() → (select auth.uid()). Postgres вычисляет его один раз
--    на запрос, а не для каждой строки. Условия те же; уже обёрнутые правила не трогаем.
do $$
declare p record;
begin
  for p in
    select policyname, tablename, qual, with_check from pg_policies
    where schemaname = 'public'
      and ((qual ~ 'auth\.uid\(\)' and qual !~ 'SELECT auth\.uid\(\)')
        or (with_check ~ 'auth\.uid\(\)' and with_check !~ 'SELECT auth\.uid\(\)'))
  loop
    execute format('alter policy %I on public.%I%s%s', p.policyname, p.tablename,
      case when p.qual is not null then ' using (' || regexp_replace(p.qual, 'auth\.uid\(\)', '(select auth.uid())', 'g') || ')' else '' end,
      case when p.with_check is not null then ' with check (' || regexp_replace(p.with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g') || ')' else '' end);
  end loop;
end $$;
