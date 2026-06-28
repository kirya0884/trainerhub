import { supabase } from "./supabase";
import { fetchPlan, addDay, addExercise, updateExercise, setSetRows } from "./plans";
import type { Day } from "../types";

export interface PlanVersion { id: string; label: string; createdAt: string; days: Day[] }

export async function fetchPlanVersions(planId: string): Promise<PlanVersion[]> {
  const { data, error } = await supabase.from("plan_versions").select("id,label,days,created_at").eq("plan_id", planId).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map((v) => ({ id: v.id, label: v.label ?? "", createdAt: v.created_at, days: v.days ?? [] }));
}

// Снимает снапшот текущего состояния плана (days/exercises/setRows целиком) — ручная точка сохранения для откатов.
export async function snapshotPlan(planId: string, label: string) {
  const plan = await fetchPlan(planId);
  const { error } = await supabase.from("plan_versions").insert({ plan_id: planId, label, days: plan.days });
  if (error) throw error;
}

export async function deletePlanVersion(id: string) {
  const { error } = await supabase.from("plan_versions").delete().eq("id", id);
  if (error) throw error;
}

// Восстановление: текущие days/exercises/setRows полностью удаляются и пересоздаются из снапшота (cascade на FK).
export async function restorePlanVersion(planId: string, version: PlanVersion) {
  const { error } = await supabase.from("plan_days").delete().eq("plan_id", planId);
  if (error) throw error;
  for (let i = 0; i < version.days.length; i++) {
    const d = version.days[i];
    const dayRow = await addDay(planId, d.name, i);
    if (d.weekday != null) await supabase.from("plan_days").update({ weekday: d.weekday }).eq("id", dayRow.id);
    for (let j = 0; j < d.exercises.length; j++) {
      const e = d.exercises[j];
      const exRow = await addExercise(dayRow.id, j, e.name);
      await updateExercise(exRow.id, { sets: e.sets, reps: e.reps, weight: e.weight, rest: e.rest, note: e.note, video: e.video, detailed: e.detailed, group: e.group, tempo: e.tempo, duration: e.duration, target: e.target });
      if (e.setRows?.length) await setSetRows(exRow.id, e.setRows);
    }
  }
}
