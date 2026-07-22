import { supabase } from "./supabase";
import type { Day } from "../types";

export interface PlanTemplate { id: string; name: string; days: Day[] }
export interface DayTemplate { id: string; name: string; day: Day }

export async function fetchPlanTemplates(trainerId: string): Promise<PlanTemplate[]> {
  const { data, error } = await supabase.from("plan_templates").select("id,name,days").eq("trainer_id", trainerId).order("name");
  if (error) throw error;
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, days: t.days || [] }));
}
export async function savePlanAsTemplate(trainerId: string, name: string, days: Day[]) {
  const { error } = await supabase.from("plan_templates").insert({ trainer_id: trainerId, name, days });
  if (error) throw error;
}
export async function deletePlanTemplate(id: string) {
  const { error } = await supabase.from("plan_templates").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchDayTemplates(trainerId: string): Promise<DayTemplate[]> {
  const { data, error } = await supabase.from("day_templates").select("id,name,day").eq("trainer_id", trainerId).order("name");
  if (error) throw error;
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, day: t.day || { id: "", name: t.name, weekday: null, exercises: [] } }));
}
export async function saveDayAsTemplate(trainerId: string, name: string, day: Day) {
  const { error } = await supabase.from("day_templates").insert({ trainer_id: trainerId, name, day });
  if (error) throw error;
}
export async function deleteDayTemplate(id: string) {
  const { error } = await supabase.from("day_templates").delete().eq("id", id);
  if (error) throw error;
}

// Bulk insert: день + все упражнения + все подходы за 3 запроса (было N×3+1)
async function insertDayFromTemplate(planId: string, td: Day, position: number) {
  // 1 запрос: создаём день (включая weekday сразу, чтобы не делать отдельный UPDATE)
  const { data: dayRow, error: dayErr } = await supabase
    .from("plan_days")
    .insert({ plan_id: planId, name: td.name, position, weekday: td.weekday ?? null, method: td.method ?? "" })
    .select()
    .single();
  if (dayErr) throw dayErr;

  if (!td.exercises.length) return;

  // 1 запрос: bulk insert всех упражнений с полными данными
  const { data: exRows, error: exErr } = await supabase
    .from("plan_exercises")
    .insert(td.exercises.map((te, j) => ({
      day_id: dayRow.id, position: j, name: te.name,
      sets: te.sets ?? "", reps: te.reps ?? "", weight: te.weight ?? "",
      rest: te.rest ?? "", note: te.note ?? "", video: te.video ?? "",
      detailed: te.detailed ?? false, exercise_group: te.group ?? "",
      tempo: te.tempo ?? "", duration: te.duration ?? "", target: te.target ?? "",
      kind: te.kind ?? "", pulse_zone: te.pulseZone ?? "",
    })))
    .select();
  if (exErr) throw exErr;

  // 1 запрос: bulk insert всех подходов
  const setRowInserts = (exRows ?? []).flatMap((exRow, j) =>
    (td.exercises[j].setRows ?? []).map((r, i) => ({
      exercise_id: exRow.id, position: i,
      weight: String(r.weight ?? ""), reps: String(r.reps ?? ""),
    }))
  );
  if (setRowInserts.length) {
    const { error: srErr } = await supabase.from("plan_exercise_set_rows").insert(setRowInserts);
    if (srErr) throw srErr;
  }
}


export async function updateDayTemplate(id: string, name: string, day: Day) {
  const { error } = await supabase.from("day_templates").update({ name, day }).eq("id", id);
  if (error) throw error;
}
export async function applyPlanTemplate(planId: string, templateDays: Day[], existingCount: number) {
  for (let i = 0; i < templateDays.length; i++) await insertDayFromTemplate(planId, templateDays[i], existingCount + i);
}
export async function applyDayTemplate(planId: string, day: Day, position: number) {
  await insertDayFromTemplate(planId, day, position);
}
