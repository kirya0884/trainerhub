import { supabase } from "./supabase";
import { fetchPlan, addDay } from "./plans";
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
    if (!d.exercises.length) continue;
    // Упражнения и подходы дня — двумя запросами, а не 3–4 на каждое упражнение. Значения — как
    // раньше (вставка с пустыми полями + правка тем, что есть в снапшоте): чего в снапшоте нет,
    // берёт значение по умолчанию (defaultToNull: false), а не null.
    const { data: exRows, error: exErr } = await supabase.from("plan_exercises").insert(
      d.exercises.map((e, j) => ({
        day_id: dayRow.id, position: j, name: e.name ?? "", sets: e.sets ?? "", reps: e.reps ?? "", weight: e.weight ?? "", rest: e.rest ?? "",
        kind: "", pulse_zone: "", detailed: e.detailed ?? false,
        note: e.note, video: e.video, exercise_group: e.group, tempo: e.tempo, duration: e.duration, target: e.target,
      })),
      { defaultToNull: false },
    ).select("id,position");
    if (exErr) throw exErr;
    // Подходы — к упражнению по его позиции (= индексу в снапшоте), не по порядку строк ответа
    const rows = (exRows ?? []).flatMap((exRow) =>
      (d.exercises[exRow.position]?.setRows ?? []).map((r, i) => ({ exercise_id: exRow.id, position: i, weight: r.weight, reps: r.reps })));
    if (rows.length) {
      const { error: srErr } = await supabase.from("plan_exercise_set_rows").insert(rows);
      if (srErr) throw srErr;
    }
  }
}
