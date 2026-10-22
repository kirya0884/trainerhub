-- Аудит 2026-10-21, п. 12. Правила доступа (RLS) в схеме public были созданы без TO,
-- то есть для роли public — Postgres проверял их и для гостя (anon) и служебных ролей.
-- Советник Supabase из-за этого выдавал 172 из 216 предупреждений multiple_permissive_policies.
--
-- Что меняется: у 70 правил роль public → authenticated. Гость их и сейчас не проходит —
-- каждое сравнивает строку с auth.uid() (напрямую или через is_trainer_of_booking /
-- is_client_of_booking), а у гостя auth.uid() пустой. Теперь эти правила для гостя просто
-- не проверяются: тот же ноль строк, только без лишней работы.
-- Что НЕ меняется: условия правил (using / with check), их состав и права (GRANT) на таблицы.
-- service_role (Edge Functions) и владелец таблиц RLS обходят — их это не касается.
-- Правила app_events, session_charges и user_consents уже созданы с to authenticated.

alter policy client_reads_own on public.booking_clients to authenticated;
alter policy trainer_owns on public.booking_clients to authenticated;

alter policy client_reads_own on public.bookings to authenticated;
alter policy trainer_owns on public.bookings to authenticated;

alter policy activities_client_delete on public.client_activities to authenticated;
alter policy activities_client_insert on public.client_activities to authenticated;
alter policy activities_client_select on public.client_activities to authenticated;

alter policy client_deletes_own on public.client_measurements to authenticated;
alter policy client_inserts_own on public.client_measurements to authenticated;
alter policy client_reads_own on public.client_measurements to authenticated;
alter policy trainer_owns on public.client_measurements to authenticated;

alter policy trainer_owns on public.client_notes to authenticated;

alter policy client_reads_own on public.client_payments to authenticated;
alter policy trainer_owns on public.client_payments to authenticated;

alter policy client_reads_own on public.client_photos to authenticated;
alter policy trainer_owns on public.client_photos to authenticated;

alter policy trainer_owns on public.client_promotions to authenticated;

alter policy client_reads_self on public.clients to authenticated;
alter policy trainer_owns on public.clients to authenticated;

alter policy trainer_owns on public.day_templates to authenticated;

alter policy trainer_owns on public.exercise_library to authenticated;

alter policy trainer_owns on public.exercise_media to authenticated;

alter policy client_owns_own on public.food_entries to authenticated;
alter policy trainer_reads on public.food_entries to authenticated;
alter policy trainer_self_all on public.food_entries to authenticated;

alter policy client_owns_own on public.food_products to authenticated;
alter policy trainer_reads on public.food_products to authenticated;
alter policy trainer_self_all on public.food_products to authenticated;

alter policy client_owns_own on public.food_recipe_items to authenticated;
alter policy trainer_reads on public.food_recipe_items to authenticated;
alter policy trainer_self_all on public.food_recipe_items to authenticated;

alter policy client_owns_own on public.food_recipes to authenticated;
alter policy trainer_reads on public.food_recipes to authenticated;
alter policy trainer_self_all on public.food_recipes to authenticated;

alter policy client_inserts_own on public.messages to authenticated;
alter policy client_reads_own on public.messages to authenticated;
alter policy trainer_owns on public.messages to authenticated;

alter policy days_rw on public.nutrition_days to authenticated;

alter policy goals_client_write on public.nutrition_goals to authenticated;
alter policy goals_read on public.nutrition_goals to authenticated;
alter policy goals_trainer_write on public.nutrition_goals to authenticated;
alter policy trainer_self_all on public.nutrition_goals to authenticated;

alter policy client_owns_own on public.nutrition_logs to authenticated;
alter policy trainer_reads on public.nutrition_logs to authenticated;

alter policy trainer_owns on public.package_templates to authenticated;

alter policy client_reads_own on public.plan_days to authenticated;
alter policy trainer_owns on public.plan_days to authenticated;

alter policy client_reads_own on public.plan_exercise_set_rows to authenticated;
alter policy trainer_owns on public.plan_exercise_set_rows to authenticated;

alter policy client_reads_own on public.plan_exercises to authenticated;
alter policy trainer_owns on public.plan_exercises to authenticated;

alter policy client_reads_meso on public.plan_mesocycles to authenticated;
alter policy trainer_owns_meso on public.plan_mesocycles to authenticated;

alter policy client_inserts_own on public.plan_metrics to authenticated;
alter policy client_reads_own on public.plan_metrics to authenticated;
alter policy trainer_owns on public.plan_metrics to authenticated;

alter policy client_reads_own on public.plan_progress_notes to authenticated;
alter policy trainer_owns on public.plan_progress_notes to authenticated;

alter policy client_inserts_own on public.plan_session_items to authenticated;
alter policy client_reads_own on public.plan_session_items to authenticated;
alter policy trainer_owns on public.plan_session_items to authenticated;

alter policy client_inserts_own on public.plan_sessions to authenticated;
alter policy client_reads_own on public.plan_sessions to authenticated;
alter policy trainer_owns on public.plan_sessions to authenticated;

alter policy trainer_owns on public.plan_templates to authenticated;

alter policy trainer_owns on public.plan_versions to authenticated;

alter policy client_reads_own on public.plans to authenticated;
alter policy trainer_owns on public.plans to authenticated;

alter policy "trainer sees own subscriptions" on public.push_subscriptions to authenticated;

alter policy trainer_self on public.trainers to authenticated;

-- Откат: те же 70 команд с «to public» вместо «to authenticated», например
--   alter policy trainer_owns on public.clients to public;
-- Быстрый вариант для всех сразу (вернёт роль public только этим 70 правилам — правила
-- app_events, session_charges, user_consents изначально были authenticated, их не трогать):
--   замените в этом файле «to authenticated;» на «to public;» и выполните.
