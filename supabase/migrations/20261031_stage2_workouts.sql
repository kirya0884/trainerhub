-- Аудит 30.10, этап 2, пп. 21 (и основа для 15/16): запись тренировки одной транзакцией
-- с ключом от повторов.
--
-- Было: lib/progress.logSession и lib/clientPortal.logClientSession делали до 4 отдельных
-- вставок (plan_metrics, plan_progress_notes, plan_sessions, plan_session_items). Обрыв
-- между ними оставлял половину тренировки, а повтор (очередь отправки, вторая вкладка,
-- повторное «Завершить») писал метрики и сессию второй раз.
--
-- Стало: public.log_workout — всё в одной транзакции. id сессии генерирует телефон
-- (crypto.randomUUID) и хранит в очереди отправки; повтор с тем же id ничего не пишет
-- и возвращает created = false. Либо записано всё, либо ничего.
--
-- Безопасность:
--   * SECURITY INVOKER: действуют те же правила RLS, что и у прямых вставок
--     (trainer_owns; client_inserts_own; клиенту plan_progress_notes не разрешены —
--     заметка от клиента откатит всю транзакцию с ошибкой RLS). Прав больше не даёт.
--   * from_client: если вызывающий не тренер этого плана, сессия всегда from_client = true
--     (раньше клиент прямой вставкой мог записать «тренерскую» сессию, а по ней
--     finishWorkout решает, списывать ли тренировку).
--   * search_path = '' и полные имена; вызывать может только authenticated.
-- Таблицы, правила RLS и данные не меняются. Еде (п. 22) миграция не нужна: у
-- food_entries уже есть PK id, телефон теперь присылает свой id и вставляет с
-- ON CONFLICT DO NOTHING (lib/foodDiary.addEntry).

create or replace function public.log_workout(
  p_session_id uuid,
  p_plan_id    uuid,
  p_session    jsonb,
  p_items      jsonb default '[]'::jsonb,
  p_metrics    jsonb default '[]'::jsonb,
  p_note       text  default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_sess    public.plan_sessions;
  v_note    public.plan_progress_notes;
  v_metrics jsonb := '[]'::jsonb;
  v_trainer boolean;
begin
  if v_uid is null then
    raise exception 'log_workout: нужен вход' using errcode = '42501';
  end if;
  if p_session_id is null or p_plan_id is null or p_session is null
     or jsonb_typeof(p_session) <> 'object'
     or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_metrics, '[]'::jsonb)) <> 'array' then
    raise exception 'log_workout: нужны id сессии, план, сессия-объект и массивы упражнений/метрик'
      using errcode = '22023';
  end if;

  v_trainer := exists (
    select 1 from public.plans p where p.id = p_plan_id and p.trainer_id = v_uid
  );

  -- Ключ от повторов: сессия с этим id уже есть — тренировка записана, ничего не пишем.
  -- Чужая или недоступная строка с тем же id тоже даёт DO NOTHING — без утечки данных.
  insert into public.plan_sessions (
    id, plan_id, date, day_name, day_id, mood, wellbeing, client_rating,
    review, done, total, from_client
  )
  values (
    p_session_id,
    p_plan_id,
    (p_session ->> 'date')::date,
    coalesce(p_session ->> 'day_name', ''),
    nullif(p_session ->> 'day_id', '')::uuid,
    nullif((p_session ->> 'mood')::smallint, 0),
    nullif((p_session ->> 'wellbeing')::smallint, 0),
    nullif((p_session ->> 'client_rating')::smallint, 0),
    coalesce(p_session ->> 'review', ''),
    coalesce((p_session ->> 'done')::int, 0),
    coalesce((p_session ->> 'total')::int, 0),
    coalesce((p_session ->> 'from_client')::boolean, false) or not v_trainer
  )
  on conflict (id) do nothing
  returning * into v_sess;

  if v_sess.id is null then
    return jsonb_build_object('created', false, 'session_id', p_session_id);
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0 then
    insert into public.plan_session_items (
      session_id, name, effort, rpe, note, actual_sets, planned_sets, planned_summary
    )
    select v_sess.id,
           coalesce(x.name, ''),
           coalesce(x.effort, 0),
           coalesce(x.rpe, 0),
           coalesce(x.note, ''),
           x.actual_sets,
           x.planned_sets,
           x.planned_summary
    from jsonb_array_elements(p_items) with ordinality as e(val, ord)
    cross join lateral jsonb_to_record(e.val) as x(
      name text, effort smallint, rpe smallint, note text,
      actual_sets jsonb, planned_sets jsonb, planned_summary text
    )
    order by e.ord;
  end if;

  if jsonb_array_length(coalesce(p_metrics, '[]'::jsonb)) > 0 then
    with ins as (
      insert into public.plan_metrics (plan_id, date, exercise, weight, reps, rest, sets)
      select p_plan_id,
             x.date,
             x.exercise,
             coalesce(x.weight, ''),
             coalesce(x.reps, ''),
             coalesce(x.rest, ''),
             coalesce(x.sets, '')
      from jsonb_array_elements(p_metrics) with ordinality as e(val, ord)
      cross join lateral jsonb_to_record(e.val) as x(
        date date, exercise text, weight text, reps text, rest text, sets text
      )
      order by e.ord
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_metrics from ins;
  end if;

  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    insert into public.plan_progress_notes (plan_id, text)
    values (p_plan_id, p_note)
    returning * into v_note;
  end if;

  return jsonb_build_object(
    'created', true,
    'session_id', v_sess.id,
    'session', to_jsonb(v_sess),
    'metrics', v_metrics,
    'note', case when v_note.id is null then null else to_jsonb(v_note) end
  );
end;
$$;

revoke execute on function public.log_workout(uuid, uuid, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.log_workout(uuid, uuid, jsonb, jsonb, jsonb, text) to authenticated;

comment on function public.log_workout(uuid, uuid, jsonb, jsonb, jsonb, text) is
  'Запись тренировки (сессия + упражнения + метрики + заметка) одной транзакцией. '
  'p_session_id генерирует клиент; повтор с тем же id возвращает created=false и ничего не пишет.';

-- ── Проверки после применения (только чтение) ──
-- 1) Функция на месте, INVOKER, права только у authenticated:
--   select p.proname, p.prosecdef, p.proacl from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.proname = 'log_workout';
--   -- ожидание: prosecdef = false; в proacl есть authenticated=X, нет anon и =X/ (PUBLIC)
-- 2) Нет ли дублей тренировок за последние сутки (две сессии одного плана, дня и даты
--    с одинаковыми done/total, созданные с разницей < 10 мин):
--   select a.plan_id, a.date, a.day_name, a.done, a.total, count(*)
--   from public.plan_sessions a join public.plan_sessions b
--     on b.plan_id = a.plan_id and b.date = a.date and b.day_name = a.day_name
--    and b.done = a.done and b.total = a.total and b.from_client = a.from_client
--    and b.id <> a.id and abs(extract(epoch from b.created_at - a.created_at)) < 600
--   where a.created_at > now() - interval '1 day' and a.deleted_at is null
--   group by 1,2,3,4,5;
-- 3) Сессии без упражнений при done > 0 (признак оборванной записи) за сутки:
--   select s.id, s.plan_id, s.date from public.plan_sessions s
--   where s.created_at > now() - interval '1 day' and s.done > 0
--     and not exists (select 1 from public.plan_session_items i where i.session_id = s.id);
