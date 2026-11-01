-- Разбор путей, группа 3 (доводка в базе), 01.11.2026.
-- 1) Клиент видит фото и видео техники из библиотеки своего тренера.
-- 2) log_workout пишет day_id, только если такой день есть в этом плане (иначе null) —
--    клиент снова шлёт id дня, а удалённый или пересозданный откатом день не роняет запись.
-- 3) Скрытое от клиента (план, блок, день) клиент не читает и через API, а не только не видит в интерфейсе.
-- 4) «Сделать активным» — одна транзакция.

-- ── 1. Медиа техники ──
create policy client_reads_trainer_media on public.exercise_media
  for select to authenticated
  using (exists (
    select 1 from public.clients c
    where c.trainer_id = exercise_media.trainer_id
      and c.auth_user_id = (select auth.uid())
      and c.deleted_at is null
  ));

-- ── 2. log_workout: day_id только своего плана ──
-- Отвечает только «этот день из этого плана?» — сам план вызывающий в log_workout всё равно
-- проходит через права на запись тренировки
create or replace function public.day_of_plan(p_day_id uuid, p_plan_id uuid)
 returns uuid
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select d.id from public.plan_days d where d.id = p_day_id and d.plan_id = p_plan_id
$$;
revoke all on function public.day_of_plan(uuid, uuid) from public, anon;
grant execute on function public.day_of_plan(uuid, uuid) to authenticated;

create or replace function public.log_workout(p_session_id uuid, p_plan_id uuid, p_session jsonb, p_items jsonb default '[]'::jsonb, p_metrics jsonb default '[]'::jsonb, p_note text default null::text)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
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
$function$;

-- ── 3. Скрытое — и в базе ──
-- Содержимое дня клиент читает, только если не скрыты ни план, ни блок, ни сам день (и не в
-- корзине) — либо это день, который он сейчас тренирует (active_session): тренер мог скрыть его
-- посреди тренировки, а без дня тренировка у клиента не откроется.
-- Сам план (название, флаги) и история тренировок остаются ему видны: по ним приложение
-- выбирает текущий план и строит историю.
-- Множеством id, а не проверкой на строку: неподвязанный подзапрос считается один раз за запрос,
-- и тренерские чтения (политики объединяются через OR) не платят за вызов на каждую строку.
create or replace function public.client_visible_day_ids()
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select d.id
  from public.clients c
  join public.plans p on p.client_id = c.id
  join public.plan_days d on d.plan_id = p.id
  left join public.plan_mesocycles m on m.id = d.mesocycle_id
  where c.auth_user_id = (select auth.uid())
    and c.deleted_at is null and p.deleted_at is null
    and (
      (p.visible_to_client is distinct from false
        and d.visible_to_client is distinct from false
        and (m.id is null or m.visible_to_client is distinct from false))
      or d.id::text = c.active_session ->> 'dayId'
    )
$$;
revoke all on function public.client_visible_day_ids() from public, anon;
grant execute on function public.client_visible_day_ids() to authenticated;

create or replace function public.client_visible_exercise_ids()
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to ''
as $$
  select e.id from public.plan_exercises e
  where e.day_id in (select public.client_visible_day_ids())
$$;
revoke all on function public.client_visible_exercise_ids() from public, anon;
grant execute on function public.client_visible_exercise_ids() to authenticated;

drop policy client_reads_own on public.plan_days;
create policy client_reads_own on public.plan_days
  for select to authenticated using (id in (select public.client_visible_day_ids()));

drop policy client_reads_own on public.plan_exercises;
create policy client_reads_own on public.plan_exercises
  for select to authenticated using (day_id in (select public.client_visible_day_ids()));

drop policy client_reads_own on public.plan_exercise_set_rows;
create policy client_reads_own on public.plan_exercise_set_rows
  for select to authenticated using (exercise_id in (select public.client_visible_exercise_ids()));

drop policy client_reads_meso on public.plan_mesocycles;
create policy client_reads_meso on public.plan_mesocycles
  for select to authenticated using (
    plan_mesocycles.visible_to_client is distinct from false
    and exists (
      select 1 from public.plans p join public.clients c on c.id = p.client_id
      where p.id = plan_mesocycles.plan_id and c.auth_user_id = (select auth.uid())
        and c.deleted_at is null and p.deleted_at is null
        and p.visible_to_client is distinct from false
    ));

-- ── 4. «Сделать активным» одной транзакцией ──
-- Права — как у тренера на свои планы (security invoker): чужой план не найдётся.
create or replace function public.make_plan_active(p_plan_id uuid)
 returns void
 language plpgsql
 security invoker
 set search_path to ''
as $$
declare v_client uuid;
begin
  select p.client_id into v_client from public.plans p
  where p.id = p_plan_id and p.trainer_id = (select auth.uid()) and p.deleted_at is null;
  if v_client is null then
    raise exception 'make_plan_active: план не найден' using errcode = '42501';
  end if;
  -- Два нажатия из двух вкладок — по очереди, без взаимной блокировки
  perform 1 from public.clients where id = v_client for update;
  update public.plans set visible_to_client = true, archived = false where id = p_plan_id;
  update public.plans set visible_to_client = false
  where client_id = v_client and id <> p_plan_id and archived = false and deleted_at is null;
end;
$$;
revoke all on function public.make_plan_active(uuid) from public, anon;
grant execute on function public.make_plan_active(uuid) to authenticated;
