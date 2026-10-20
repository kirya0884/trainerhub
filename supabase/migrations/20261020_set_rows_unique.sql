-- Подходы плана задваивались: сохранение шло в два запроса (удалить старые → вставить новые),
-- и при обрыве связи в зале удаление могло не пройти, а вставка — пройти. Ошибки не проверялись.
-- 1) Чистка дублей: на каждый (упражнение, номер подхода) остаётся одна строка — с заполненными
--    повторами и весом, а среди равных — та, чьё значение чаще встречается в этом упражнении.
-- 2) Уникальность (exercise_id, position): дубль больше не может появиться физически;
--    приложение сохраняет подходы через upsert по этому ключу.
with freq as (
  select exercise_id, coalesce(weight, '') w, coalesce(reps, '') r, count(*) n
  from public.plan_exercise_set_rows group by 1, 2, 3
), ranked as (
  select s.id,
    row_number() over (
      partition by s.exercise_id, s.position
      order by (coalesce(s.reps, '') <> '') desc, (coalesce(s.weight, '') <> '') desc, f.n desc, s.id
    ) rn
  from public.plan_exercise_set_rows s
  join freq f on f.exercise_id = s.exercise_id and f.w = coalesce(s.weight, '') and f.r = coalesce(s.reps, '')
)
delete from public.plan_exercise_set_rows where id in (select id from ranked where rn > 1);

alter table public.plan_exercise_set_rows
  add constraint plan_exercise_set_rows_exercise_position_key unique (exercise_id, position);
