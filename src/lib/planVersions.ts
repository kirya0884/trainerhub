import { supabase } from "./supabase";
import { fetchPlan } from "./plans";
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

// Восстановление без момента, когда плана нет. Раньше сначала удалялись все дни, и обрыв связи
// посередине оставлял план пустым. Теперь: вставляем дни, упражнения и подходы из снапшота
// (новые id создаём здесь — всё уходит тремя запросами), и только потом одним запросом удаляем
// старые дни (упражнения и подходы — каскадом). Не вышло — убираем вставленное, план прежний.
export async function restorePlanVersion(planId: string, version: PlanVersion) {
  const { data: old, error: oldErr } = await supabase.from("plan_days").select("id").eq("plan_id", planId);
  if (oldErr) throw oldErr;
  const oldIds = (old ?? []).map((d) => d.id as string);

  const days: Record<string, any>[] = [];
  const exercises: Record<string, any>[] = [];
  const setRows: Record<string, any>[] = [];
  version.days.forEach((d, i) => {
    const dayId = crypto.randomUUID();
    days.push({ id: dayId, plan_id: planId, name: d.name, position: i, ...(d.weekday != null ? { weekday: d.weekday } : {}) });
    d.exercises.forEach((e, j) => {
      const exId = crypto.randomUUID();
      // Значения — как раньше: чего в снапшоте нет, берёт значение по умолчанию (defaultToNull: false), а не null
      exercises.push({
        id: exId, day_id: dayId, position: j, name: e.name ?? "", sets: e.sets ?? "", reps: e.reps ?? "", weight: e.weight ?? "", rest: e.rest ?? "",
        kind: "", pulse_zone: "", detailed: e.detailed ?? false,
        note: e.note, video: e.video, exercise_group: e.group, tempo: e.tempo, duration: e.duration, target: e.target,
      });
      (e.setRows ?? []).forEach((r, k) => setRows.push({ exercise_id: exId, position: k, weight: r.weight, reps: r.reps }));
    });
  });
  const insert = async (table: string, rows: Record<string, any>[]) => {
    if (!rows.length) return;
    const { error } = await supabase.from(table).insert(rows, { defaultToNull: false });
    if (error) throw error;
  };

  try {
    await insert("plan_days", days);
    await insert("plan_exercises", exercises);
    await insert("plan_exercise_set_rows", setRows);
    if (oldIds.length) {
      const { error } = await supabase.from("plan_days").delete().in("id", oldIds);
      if (error) throw error;
    }
  } catch (e) {
    // Убираем вставленное, только если старые дни точно на месте: удаление могло пройти,
    // а ответ потеряться — тогда новые дни и есть план. Не удалось проверить — не трогаем:
    // лишние дни лучше пустого плана.
    const { data: still, error: chkErr } = oldIds.length
      ? await supabase.from("plan_days").select("id").in("id", oldIds)
      : { data: [] as { id: string }[], error: null };
    if (!chkErr && (still ?? []).length === oldIds.length) {
      await supabase.from("plan_days").delete().in("id", days.map((d) => d.id)).then(() => {}, () => {});
    }
    throw e;
  }
}
