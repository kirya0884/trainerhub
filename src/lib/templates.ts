import { supabase } from "./supabase";
import { addDay, addExercise, updateExercise, setSetRows } from "./plans";
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

// Применение шаблона — построчная вставка через lib/plans.ts (а не bulk insert),
// чтобы id/position проставлялись той же логикой, что и при ручном редактировании.
async function insertDayFromTemplate(planId: string, td: Day, position: number) {
  const dayRow = await addDay(planId, td.name, position);
  if (td.weekday != null) await supabase.from("plan_days").update({ weekday: td.weekday }).eq("id", dayRow.id);
  // Parallel insert: all exercises run concurrently (each still serialised internally by setSetRows queue)
  await Promise.all(td.exercises.map(async (te, j) => {
    const exRow = await addExercise(dayRow.id, j, te.name);
    await updateExercise(exRow.id, {
      sets: te.sets, reps: te.reps, weight: te.weight, rest: te.rest, note: te.note,
      video: te.video, detailed: te.detailed, group: te.group, tempo: te.tempo, duration: te.duration, target: te.target,
    });
    if (te.setRows?.length) await setSetRows(exRow.id, te.setRows);
  }));
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
