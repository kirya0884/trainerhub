-- Сохранение редактора плана одним запросом вместо пачки.
-- Бесплатный Supabase в моменты перегрузки не справляется с очередями запросов:
--   * подходы упражнения сохранялись двумя запросами (upsert + удаление хвоста);
--   * перестановка дней/упражнений/мезоциклов шла N параллельными PATCH (по одному на строку).
-- Здесь — четыре функции, каждая делает то же самое за один вызов.
--
-- Безопасность:
--   * SECURITY INVOKER (по умолчанию): функции работают с правами вызывающего, поэтому
--     действуют те же RLS-правила (trainer_owns, trainer_owns_meso, client_reads_*),
--     что и при прямых запросах. Прав больше, чем у прямого PATCH/POST, они не дают.
--   * search_path = '' и полностью квалифицированные имена — защита от подмены объектов.
--   * Вызывать может только вошедший пользователь (authenticated), не anon и не PUBLIC.
-- Таблицы, правила RLS и данные не меняются.
--
-- Уникальные индексы на position: в репозитории есть только
-- plan_exercise_set_rows_exercise_position_key unique (exercise_id, position) — его
-- replace_set_rows не переставляет (позиция = индекс в массиве, upsert по ключу).
-- На plan_days / plan_exercises / plan_mesocycles уникальности по position нет, поэтому
-- перестановка одним UPDATE безопасна. Перед применением проверь на живой базе
-- (запрос в конце файла), что такого индекса не появилось из панели.

-- 1. Подходы упражнения: [{weight, reps}, ...] -> строки с position = индекс в массиве.
create or replace function public.replace_set_rows(p_exercise_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_exercise_id is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'replace_set_rows: нужен exercise_id и массив подходов'
      using errcode = '22023';
  end if;

  -- Если упражнение чужое, INSERT не пройдёт WITH CHECK правила trainer_owns, а
  -- ON CONFLICT DO UPDATE по невидимой строке тоже падает — ошибка RLS, как и сейчас.
  insert into public.plan_exercise_set_rows (exercise_id, position, weight, reps)
  select p_exercise_id,
         (r.ord - 1)::int,
         coalesce(r.val ->> 'weight', ''),
         coalesce(r.val ->> 'reps', '')
  from jsonb_array_elements(p_rows) with ordinality as r(val, ord)
  on conflict (exercise_id, position)
  do update set weight = excluded.weight, reps = excluded.reps;

  -- Хвост (подходов стало меньше). Чужие строки RLS тихо пропускает, как прямой DELETE.
  delete from public.plan_exercise_set_rows
  where exercise_id = p_exercise_id
    and position >= jsonb_array_length(p_rows);
end;
$$;

-- 2. Перестановка: p_rows = [{id, position}, ...]. Строки, недоступные по RLS,
--    тихо пропускаются — так же, как при прямом PATCH.
create or replace function public.reorder_plan_days(p_rows jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.plan_days t
  set position = r.position
  from jsonb_to_recordset(p_rows) as r(id uuid, position int)
  where t.id = r.id
    and t.position is distinct from r.position;
$$;

create or replace function public.reorder_plan_exercises(p_rows jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.plan_exercises t
  set position = r.position
  from jsonb_to_recordset(p_rows) as r(id uuid, position int)
  where t.id = r.id
    and t.position is distinct from r.position;
$$;

create or replace function public.reorder_plan_mesocycles(p_rows jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.plan_mesocycles t
  set position = r.position
  from jsonb_to_recordset(p_rows) as r(id uuid, position int)
  where t.id = r.id
    and t.position is distinct from r.position;
$$;

-- Права: по умолчанию EXECUTE выдан PUBLIC (а значит и anon) — убираем.
revoke execute on function public.replace_set_rows(uuid, jsonb) from public, anon;
revoke execute on function public.reorder_plan_days(jsonb) from public, anon;
revoke execute on function public.reorder_plan_exercises(jsonb) from public, anon;
revoke execute on function public.reorder_plan_mesocycles(jsonb) from public, anon;
grant execute on function public.replace_set_rows(uuid, jsonb) to authenticated;
grant execute on function public.reorder_plan_days(jsonb) to authenticated;
grant execute on function public.reorder_plan_exercises(jsonb) to authenticated;
grant execute on function public.reorder_plan_mesocycles(jsonb) to authenticated;

-- Чтобы PostgREST сразу увидел новые функции.
notify pgrst, 'reload schema';

-- Проверка перед применением (только чтение): уникальные индексы, содержащие position.
-- Ожидается одна строка — plan_exercise_set_rows_exercise_position_key.
-- select tablename, indexname, indexdef from pg_indexes
-- where schemaname = 'public'
--   and tablename in ('plan_days', 'plan_exercises', 'plan_mesocycles', 'plan_exercise_set_rows')
--   and indexdef ilike 'create unique%' and indexdef ilike '%position%';

-- Откат:
-- drop function if exists public.replace_set_rows(uuid, jsonb);
-- drop function if exists public.reorder_plan_days(jsonb);
-- drop function if exists public.reorder_plan_exercises(jsonb);
-- drop function if exists public.reorder_plan_mesocycles(jsonb);
-- notify pgrst, 'reload schema';
