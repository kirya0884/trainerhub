import { supabase } from "./supabase";
import type { Mesocycle, Plan, Exercise, SetRow } from "../types";

// ponytail: построчный CRUD без батчинга — для размеров планов тренера (десятки дней/упражнений) этого достаточно

export async function fetchPlan(planId: string): Promise<Plan> {
  const { data: plan, error } = await supabase.from("plans").select("id,name,note,visible_to_client").eq("id", planId).single();
  if (error) throw error;

  const { data: mesos } = await supabase.from("plan_mesocycles").select("id,plan_id,name,position,visible_to_client").eq("plan_id", planId).order("position");

  const { data: days } = await supabase.from("plan_days").select("id,name,weekday,date_of,position,visible_to_client,mesocycle_id,method").eq("plan_id", planId).order("position");
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
      kind: e.kind ?? "", pulseZone: e.pulse_zone ?? "",
    });

  const mesocycles: Mesocycle[] = (mesos ?? []).map((m) => ({
    id: m.id, planId: m.plan_id, name: m.name, position: m.position,
    visibleToClient: m.visible_to_client !== false,
  }));

  return {
    id: plan.id, name: plan.name, note: plan.note ?? "", visibleToClient: plan.visible_to_client !== false,
    mesocycles,
    days: (days ?? []).map((d) => ({
      id: d.id, name: d.name, weekday: d.weekday, dateOf: d.date_of ?? null,
      method: d.method ?? "",
      visibleToClient: d.visible_to_client !== false,
      mesocycleId: d.mesocycle_id ?? null,
      exercises: exByDay[d.id] ?? [],
    })),
  };
}

export const updatePlanMeta = async (planId: string, patch: Partial<Pick<Plan, "name" | "note" | "visibleToClient">>) => {
  const row: Record<string, any> = { ...patch };
  if ("visibleToClient" in row) { row.visible_to_client = row.visibleToClient; delete row.visibleToClient; }
  const { error } = await supabase.from("plans").update(row).eq("id", planId);
  if (error) throw error;
};

export async function addDay(planId: string, name: string, position: number, mesocycleId?: string | null) {
  const insert: Record<string, any> = { plan_id: planId, name, position };
  if (mesocycleId) insert.mesocycle_id = mesocycleId;
  const { data, error } = await supabase.from("plan_days").insert(insert).select().single();
  if (error) throw error;
  return data;
}
export const updateDay = async (dayId: string, patch: Record<string, any>) => {
  const row: Record<string, any> = { ...patch };
  if ("dateOf" in patch) { row.date_of = patch.dateOf; delete row.dateOf; }
  if ("visibleToClient" in patch) { row.visible_to_client = patch.visibleToClient; delete row.visibleToClient; }
  if ("mesocycleId" in patch) { row.mesocycle_id = patch.mesocycleId; delete row.mesocycleId; }
  const { error } = await supabase.from("plan_days").update(row).eq("id", dayId);
  if (error) throw error;
};
export const deleteDay = async (dayId: string) => { const { error } = await supabase.from("plan_days").delete().eq("id", dayId); if (error) throw error; };
export const reorderDays = async (rows: { id: string; position: number }[]) => {
  const res = await Promise.all(rows.map((r) => supabase.from("plan_days").update({ position: r.position }).eq("id", r.id)));
  const err = res.find((r) => r.error)?.error; if (err) throw err;
};

export async function addExercise(dayId: string, position: number, name = "") {
  const { data, error } = await supabase
    .from("plan_exercises")
    .insert({ day_id: dayId, position, name, sets: "", reps: "", weight: "", rest: "", kind: "", pulse_zone: "" })
    .select()
    .single();
  if (error) throw error;
  return data;
}
export async function updateExercise(exId: string, patch: Record<string, any>) {
  const dbPatch: Record<string, any> = { ...patch };
  if ("group" in dbPatch) { dbPatch.exercise_group = dbPatch.group; delete dbPatch.group; }
  if ("pulseZone" in dbPatch) { dbPatch.pulse_zone = dbPatch.pulseZone; delete dbPatch.pulseZone; }
  const { error } = await supabase.from("plan_exercises").update(dbPatch).eq("id", exId);
  if (error) throw error;
}
export const deleteExercise = async (exId: string) => { const { error } = await supabase.from("plan_exercises").delete().eq("id", exId); if (error) throw error; };
export const reorderExercises = async (rows: { id: string; position: number }[]) => {
  const res = await Promise.all(rows.map((r) => supabase.from("plan_exercises").update({ position: r.position }).eq("id", r.id)));
  const err = res.find((r) => r.error)?.error; if (err) throw err;
};

// ponytail: serialise per-exercise to prevent concurrent DELETE+INSERT duplication
const _srQ = new Map<string, Promise<void>>();
export function setSetRows(exerciseId: string, rows: SetRow[]): Promise<void> {
  const run = async () => {
    await supabase.from("plan_exercise_set_rows").delete().eq("exercise_id", exerciseId);
    if (rows.length) {
      await supabase.from("plan_exercise_set_rows").insert(
        rows.map((r, i) => ({ exercise_id: exerciseId, position: i, weight: r.weight, reps: r.reps }))
      );
    }
  };
  const prev = _srQ.get(exerciseId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(run);
  _srQ.set(exerciseId, next);
  return next;
}

// ── Мезоциклы ──
export async function addMesocycle(planId: string, position: number): Promise<Mesocycle> {
  const { data, error } = await supabase.from("plan_mesocycles").insert({ plan_id: planId, name: `Блок ${position + 1}`, position }).select().single();
  if (error) throw error;
  return { id: data.id, planId: data.plan_id, name: data.name, position: data.position, visibleToClient: true };
}
export const updateMesocycle = async (mesoId: string, patch: Partial<Pick<Mesocycle, "name" | "position" | "visibleToClient">>) => {
  const row: Record<string, any> = { ...patch };
  if ("visibleToClient" in row) { row.visible_to_client = row.visibleToClient; delete row.visibleToClient; }
  const { error } = await supabase.from("plan_mesocycles").update(row).eq("id", mesoId);
  if (error) throw error;
};
export const deleteMesocycle = async (mesoId: string) => { const { error } = await supabase.from("plan_mesocycles").delete().eq("id", mesoId); if (error) throw error; };
export const reorderMesocycles = async (rows: { id: string; position: number }[]) => {
  const res = await Promise.all(rows.map((r) => supabase.from("plan_mesocycles").update({ position: r.position }).eq("id", r.id)));
  const err = res.find((r) => r.error)?.error; if (err) throw err;
};
