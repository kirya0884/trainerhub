import { supabase } from "./supabase";
import type { Mesocycle, Plan, Exercise, SetRow } from "../types";

// ponytail: построчный CRUD без батчинга — для размеров планов тренера (десятки дней/упражнений) этого достаточно

export async function fetchPlan(planId: string): Promise<Plan> {
  const { data: plan, error } = await supabase.from("plans").select("id,name,note,visible_to_client").eq("id", planId).single();
  if (error) throw error;

  const { data: mesos } = await supabase.from("plan_mesocycles").select("id,plan_id,name,position,visible_to_client,archived_at").eq("plan_id", planId).order("position");

  const { data: days } = await supabase.from("plan_days").select("id,name,weekday,date_of,position,visible_to_client,mesocycle_id,method,archived_at").eq("plan_id", planId).order("position");
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
    visibleToClient: m.visible_to_client !== false, archivedAt: m.archived_at ?? null,
  }));

  return {
    id: plan.id, name: plan.name, note: plan.note ?? "", visibleToClient: plan.visible_to_client !== false,
    mesocycles,
    days: (days ?? []).map((d) => ({
      id: d.id, name: d.name, weekday: d.weekday, dateOf: d.date_of ?? null,
      method: d.method ?? "",
      visibleToClient: d.visible_to_client !== false,
      mesocycleId: d.mesocycle_id ?? null,
      archivedAt: d.archived_at ?? null,
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
  if ("archivedAt" in patch) { row.archived_at = patch.archivedAt; delete row.archivedAt; }
  const { error } = await supabase.from("plan_days").update(row).eq("id", dayId);
  if (error) throw error;
};
export const deleteDay = async (dayId: string) => { const { error } = await supabase.from("plan_days").delete().eq("id", dayId); if (error) throw error; };
export const reorderDays = async (rows: { id: string; position: number }[]) => {
  const res = await Promise.all(rows.map((r) => supabase.from("plan_days").update({ position: r.position }).eq("id", r.id)));
  const err = res.find((r) => r.error)?.error; if (err) throw err;
};

export async function addExercise(dayId: string, position: number, name = "", detailed = false) {
  const { data, error } = await supabase
    .from("plan_exercises")
    .insert({ day_id: dayId, position, name, sets: "", reps: "", weight: "", rest: "", kind: "", pulse_zone: "", detailed })
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
// B06: дублирование плана целиком. Не через applyPlanTemplate — та функция не переносит
// mesocycle_id, и дубликат плана с блоками потерял бы структуру: все дни свалились бы в кучу.
// Здесь блоки копируются первыми, их новые id подставляются дням (тот же приём ремапа,
// что в импорте бэкапа).
//
// Транзакции из браузера недоступны, поэтому при ошибке на середине удаляем созданный план:
// недоделанный план в списке хуже, чем несработавшее действие.
export async function duplicatePlan(trainerId: string, clientId: string, sourcePlanId: string, newName: string) {
  const src = await fetchPlan(sourcePlanId);
  const { data: planRow, error: planErr } = await supabase
    .from("plans").insert({ trainer_id: trainerId, client_id: clientId, name: newName, note: src.note }).select("id").single();
  if (planErr) throw planErr;
  const newPlanId = planRow.id as string;

  try {
    // 1. Блоки — сначала, чтобы знать их новые id
    const mesoMap: Record<string, string> = {};
    for (const m of src.mesocycles ?? []) {
      const { data, error } = await supabase
        .from("plan_mesocycles")
        .insert({ plan_id: newPlanId, name: m.name, position: m.position, visible_to_client: m.visibleToClient !== false })
        .select("id").single();
      if (error) throw error;
      mesoMap[m.id] = data.id;
    }

    // 2. Дни — с переназначением блока
    for (let i = 0; i < src.days.length; i++) {
      const d = src.days[i];
      const { data: dayRow, error: dayErr } = await supabase.from("plan_days").insert({
        plan_id: newPlanId, name: d.name, position: i, weekday: d.weekday ?? null,
        date_of: d.dateOf ?? null, visible_to_client: d.visibleToClient !== false,
        mesocycle_id: d.mesocycleId ? mesoMap[d.mesocycleId] ?? null : null,
        method: d.method ?? "",
      }).select("id").single();
      if (dayErr) throw dayErr;
      await copyExercises(dayRow.id as string, d.exercises);
    }
    return newPlanId;
  } catch (e) {
    // Откат: убираем огрызок целиком, каскад унесёт дни и упражнения
    await supabase.from("plans").delete().eq("id", newPlanId);
    throw e;
  }
}

// B06: дублирование блока (в интерфейсе — «неделя») вместе с его днями.
export async function duplicateMesocycle(planId: string, sourceMesoId: string) {
  const src = await fetchPlan(planId);
  const meso = (src.mesocycles ?? []).find((m) => m.id === sourceMesoId);
  if (!meso) throw new Error("Блок не найден");

  const { data: mesoRow, error: mesoErr } = await supabase
    .from("plan_mesocycles")
    .insert({ plan_id: planId, name: `${meso.name} (копия)`, position: (src.mesocycles ?? []).length })
    .select("id").single();
  if (mesoErr) throw mesoErr;
  const newMesoId = mesoRow.id as string;

  try {
    const days = src.days.filter((d) => d.mesocycleId === sourceMesoId);
    let pos = src.days.length;
    for (const d of days) {
      const { data: dayRow, error: dayErr } = await supabase.from("plan_days").insert({
        plan_id: planId, name: d.name, position: pos++, weekday: d.weekday ?? null,
        visible_to_client: d.visibleToClient !== false, mesocycle_id: newMesoId, method: d.method ?? "",
      }).select("id").single();
      if (dayErr) throw dayErr;
      await copyExercises(dayRow.id as string, d.exercises);
    }
    return newMesoId;
  } catch (e) {
    await supabase.from("plan_mesocycles").delete().eq("id", newMesoId);
    throw e;
  }
}

// Общий кусок для обоих дубликаторов: упражнения дня и их подходы.
async function copyExercises(dayId: string, exercises: Plan["days"][number]["exercises"]) {
  if (!exercises.length) return;
  const { data: exRows, error: exErr } = await supabase.from("plan_exercises").insert(
    exercises.map((e, j) => ({
      day_id: dayId, position: j, name: e.name, sets: e.sets, reps: e.reps, weight: e.weight,
      rest: e.rest, note: e.note, video: e.video, detailed: e.detailed, exercise_group: e.group,
      tempo: e.tempo, duration: e.duration, target: e.target, kind: e.kind ?? "", pulse_zone: e.pulseZone ?? "",
    }))
  ).select("id");
  if (exErr) throw exErr;

  const rows = (exRows ?? []).flatMap((exRow, j) =>
    (exercises[j].setRows ?? []).map((r, i) => ({ exercise_id: exRow.id, position: i, weight: String(r.weight ?? ""), reps: String(r.reps ?? "") }))
  );
  if (rows.length) {
    const { error } = await supabase.from("plan_exercise_set_rows").insert(rows);
    if (error) throw error;
  }
}

export async function addMesocycle(planId: string, position: number, name: string): Promise<Mesocycle> {
  // Имя приходит снаружи: с вставкой сверху позиция всегда 0 и выводить имя из неё нельзя.
  const { data, error } = await supabase.from("plan_mesocycles").insert({ plan_id: planId, name, position }).select().single();
  if (error) throw error;
  return { id: data.id, planId: data.plan_id, name: data.name, position: data.position, visibleToClient: true, archivedAt: null };
}
export const updateMesocycle = async (mesoId: string, patch: Partial<Pick<Mesocycle, "name" | "position" | "visibleToClient" | "archivedAt">>) => {
  const row: Record<string, any> = { ...patch };
  if ("archivedAt" in row) { row.archived_at = row.archivedAt; delete row.archivedAt; }
  if ("visibleToClient" in row) { row.visible_to_client = row.visibleToClient; delete row.visibleToClient; }
  const { error } = await supabase.from("plan_mesocycles").update(row).eq("id", mesoId);
  if (error) throw error;
};
export const deleteMesocycle = async (mesoId: string) => { const { error } = await supabase.from("plan_mesocycles").delete().eq("id", mesoId); if (error) throw error; };
export const reorderMesocycles = async (rows: { id: string; position: number }[]) => {
  const res = await Promise.all(rows.map((r) => supabase.from("plan_mesocycles").update({ position: r.position }).eq("id", r.id)));
  const err = res.find((r) => r.error)?.error; if (err) throw err;
};
