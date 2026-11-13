-- Упражнение тренировки «не сделано»: тренер (или клиент) отметил его пропущенным.
-- Отличаем от «не отмечено»: раньше пропуск выглядел как забытые галочки.
-- Причина — в note упражнения. Старые версии приложения поле не шлют — будет false.
alter table public.plan_session_items add column if not exists skipped boolean not null default false;

-- log_workout: то же, что было, плюс поле skipped у упражнений
CREATE OR REPLACE FUNCTION public.log_workout(p_session_id uuid, p_plan_id uuid, p_session jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_metrics jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_sess    public.plan_sessions;
  v_note    public.plan_progress_notes;
  v_metrics jsonb := '[]'::jsonb;
  v_trainer boolean;
  v_day     uuid;
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

  -- День удалили или пересоздали (откат версии), пока шла тренировка, или id не из этого плана —
  -- пишем без дня (сопоставление пойдёт по названию), а не падаем на внешнем ключе
  -- Мимо прав на чтение дней: скрытый от клиента день — всё равно день этого плана
  v_day := public.day_of_plan(nullif(p_session ->> 'day_id', '')::uuid, p_plan_id);

  insert into public.plan_sessions (
    id, plan_id, date, day_name, day_id, mood, wellbeing, client_rating,
    review, done, total, from_client
  )
  values (
    p_session_id,
    p_plan_id,
    (p_session ->> 'date')::date,
    coalesce(p_session ->> 'day_name', ''),
    v_day,
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
      session_id, name, effort, rpe, note, actual_sets, planned_sets, planned_summary, skipped
    )
    select v_sess.id,
           coalesce(x.name, ''),
           coalesce(x.effort, 0),
           coalesce(x.rpe, 0),
           coalesce(x.note, ''),
           x.actual_sets,
           x.planned_sets,
           x.planned_summary,
           coalesce(x.skipped, false)
    from jsonb_array_elements(p_items) with ordinality as e(val, ord)
    cross join lateral jsonb_to_record(e.val) as x(
      name text, effort smallint, rpe smallint, note text,
      actual_sets jsonb, planned_sets jsonb, planned_summary text, skipped boolean
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
$function$;

notify pgrst, 'reload schema';
