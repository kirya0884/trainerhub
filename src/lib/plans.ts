import { supabase } from "./supabase";
import type { Mesocycle, Plan, Exercise, SetRow } from "../types";

// ponytail: построчный CRUD без батчинга — для размеров планов тренера (десятки дней/упражнений) этого достаточно

export async function fetchPlan(planId: string): Promise<Plan> {
  const { data: plan, error } = await supabase.from("plans").select("id,name,note,visible_to_client").eq("id", planId).single();
  if (error) throw error;

  const { data: mesos } = await supabase.from("plan_mesocycles").select("id,plan_id,name,position").eq("plan_id", planId).order("position");

  const { data: days } = await supabase.from("plan_days").select("id,name,weekday,date_of,position,visible_to_client,mesocycle_id").eq("plan_id", planId).order("position");
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

  const mesocycles: Mesocycle[] = (mesos ?? []).map((m) => ({ id: m.id, planId: m.plan_id, name: m.name, position: m.position }));

  return {
    id: plan.id, name: plan.name, note: plan.note ?? "", visibleToClient: plan.visible_to_client !== false,
    mesocycles,
    days: (days ?? []).map((d) => ({
      id: d.id, name: d.name, weekday: d.weekday, dateOf: d.date_of ?? null,
      visibleToClient: d.visible_to_client !== false,
      mesocycleId: d.mesocycle_id ?? null,
      exercises: exByDay[d.id] ?? [],
    })),
  };
}

export const updatePlanMeta = (planId: string, patch: Partial<Pick<Plan, "name" | "note" | "visibleToClient">>) => {
  const row: Record<string, any> = { ...patch };
  if ("visibleToClient" in row) { row.visible_to_client = row.visibleToClient; delete row.visibleToClient; }
  return supabase.from("plans").update(row).eq("id", planId);
};

export async function addDay(planId: string, name: string, position: number) {
  const { data, error } = await supabase.from("plan_days").insert({ plan_id: planId, name, position }).select().single();
  if (error) throw error;
  return data;
}
export const updateDay = (dayId: string, patch: Record<string, any>) => {
  const row: Record<string, any> = { ...patch };
  if ("dateOf" in patch) { row.date_of = patch.dateOf; delete row.dateOf; }
  if ("visibleToClient" in patch) { row.visible_to_client = patch.visibleToClient; delete row.visibleToClient; }
  if ("mesocycleId" in patch) { row.mesocycle_id = patch.mesocycleId; delete row.mesocycleId; }
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
export async function updateExercise(exId: string, patch: Record<string, any>) {
  const dbPatch: Record<string, any> = { ...patch };
  if ("group" in dbPatch) { dbPatch.exercise_group = dbPatch.group; delete dbPatch.group; }
  const { error } = await supabase.from("plan_exercises").update(dbPatch).eq("id", exId);
  if (error) console.error("[updateExercise]", error.message, { exId, patch });
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

// ── Мезоциклы ──
export async function addMesocycle(planId: string, position: number): Promise<Mesocycle> {
  const { data, error } = await supabase.from("plan_mesocycles").insert({ plan_id: planId, name: `Блок ${position + 1}`, position }).select().single();
  if (error) throw error;
  return { id: data.id, planId: data.plan_id, name: data.name, position: data.position };
}
export const updateMesocycle = (mesoId: string, patch: Partial<Pick<Mesocycle, "name" | "position">>) =>
  supabase.from("plan_mesocycles").update(patch).eq("id", mesoId);
export const deleteMesocycle = (mesoId: string) => supabase.from("plan_mesocycles").delete().eq("id", mesoId);
export const reorderMesocycles = (rows: { id: string; position: number }[]) =>
  Promise.all(rows.map((r) => supabase.from("plan_mesocycles").update({ position: r.position }).eq("id", r.id)));
