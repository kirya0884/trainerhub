import { supabase } from "./supabase";
import type { Plan, Exercise, SetRow } from "../types";

// ponytail: построчный CRUD без батчинга — для размеров планов тренера (десятки дней/упражнений) этого достаточно

export async function fetchPlan(planId: string): Promise<Plan> {
  const { data: plan, error } = await supabase.from("plans").select("id,name,note").eq("id", planId).single();
  if (error) throw error;

  const { data: days } = await supabase.from("plan_days").select("id,name,weekday,date_of,position").eq("plan_id", planId).order("position");
  const dayIds = (days ?? []).map((d) => d.id);

  const { data: exercises } = dayIds.length
    ? await supabase.from("plan_exercises").select("*").in("day_id", dayIds).order("position")
    : { data: [] as any[] };
  const exIds = (exercises ?? []).map((e) => e.id);

  const { data: setRows } = exIds.length
    ? await supabase.from("plan_exercise_set_rows").select("*").in("exercise_id", exIds).order("position")
    : { data: [] as any[] };

  const rowsByEx: Record<string, SetRow[]> = {};
  for (const r of setRows ?? []) (rowsByEx[r.exercise_id] ??= []).push({ id: r.id, weight: r.weight, reps: r.reps });

  const exByDay: Record<string, Exercise[]> = {};
  for (const e of exercises ?? [])
    (exByDay[e.day_id] ??= []).push({
      id: e.id, name: e.name, sets: e.sets, reps: e.reps, weight: e.weight, rest: e.rest,
      note: e.note, video: e.video, detailed: e.detailed, group: e.exercise_group,
      tempo: e.tempo, duration: e.duration, target: e.target, setRows: rowsByEx[e.id] ?? [],
    });

  return {
    id: plan.id, name: plan.name, note: plan.note ?? "",
    days: (days ?? []).map((d) => ({ id: d.id, name: d.name, weekday: d.weekday, dateOf: d.date_of ?? null, exercises: exByDay[d.id] ?? [] })),
  };
}

export const updatePlanMeta = (planId: string, patch: Partial<Pick<Plan, "name" | "note">>) =>
  supabase.from("plans").update(patch).eq("id", planId);

export async function addDay(planId: string, name: string, position: number) {
  const { data, error } = await supabase.from("plan_days").insert({ plan_id: planId, name, position }).select().single();
  if (error) throw error;
  return data;
}
export const updateDay = (dayId: string, patch: Record<string, any>) => {
  const row: Record<string, any> = { ...patch };
  if ("dateOf" in patch) { row.date_of = patch.dateOf; delete row.dateOf; }
  return supabase.from("plan_days").update(row).eq("id", dayId);
};
export const deleteDay = (dayId: string) => supabase.from("plan_days").delete().eq("id", dayId);
export const reorderDays = (rows: { id: string; position: number }[]) =>
  Promise.all(rows.map((r) => supabase.from("plan_days").update({ position: r.position }).eq("id", r.id)));

export async function addExercise(dayId: string, position: number, name = "") {
  const { data, error } = await supabase
    .from("plan_exercises")
    .insert({ day_id: dayId, position, name, sets: "", reps: "", weight: "", rest: "" })
    .select()
    .single();
  if (error) throw error;
  return data;
}
export function updateExercise(exId: string, patch: Record<string, any>) {
  const dbPatch: Record<string, any> = { ...patch };
  if ("group" in dbPatch) { dbPatch.exercise_group = dbPatch.group; delete dbPatch.group; }
  return supabase.from("plan_exercises").update(dbPatch).eq("id", exId);
}
export const deleteExercise = (exId: string) => supabase.from("plan_exercises").delete().eq("id", exId);
export const reorderExercises = (rows: { id: string; position: number }[]) =>
  Promise.all(rows.map((r) => supabase.from("plan_exercises").update({ position: r.position }).eq("id", r.id)));

export async function setSetRows(exerciseId: string, rows: SetRow[]) {
  // ponytail: проще целиком пересохранить подходы (их редко больше 12), чем дифать построчно
  await supabase.from("plan_exercise_set_rows").delete().eq("exercise_id", exerciseId);
  if (rows.length) {
    await supabase.from("plan_exercise_set_rows").insert(
      rows.map((r, i) => ({ exercise_id: exerciseId, position: i, weight: r.weight, reps: r.reps }))
    );
  }
}
