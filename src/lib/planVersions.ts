import { supabase } from "./supabase";
import { fetchPlan } from "./plans";
import type { Day, Mesocycle } from "../types";

export interface PlanVersion { id: string; label: string; createdAt: string; days: Day[] }

export async function fetchPlanVersions(planId: string): Promise<PlanVersion[]> {
  const { data, error } = await supabase.from("plan_versions").select("id,label,days,created_at").eq("plan_id", planId).order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map((v) => ({ id: v.id, label: v.label ?? "", createdAt: v.created_at, days: v.days ?? [] }));
}

// Снимает снапшот текущего состояния плана (days/exercises/setRows целиком) — точка для откатов.
// Разбор путей 3.23: блоки плана целиком кладём в первый день (planMesos) — отдельной колонки под
// них нет, а без них откат терял блоки, их скрытие и архив.
export type SnapDay = Day & { planMesos?: Mesocycle[] };
export async function snapshotPlan(planId: string, label: string) {
  const plan = await fetchPlan(planId);
  const days: SnapDay[] = plan.days.map((d, i) => (i === 0 ? { ...d, planMesos: plan.mesocycles ?? [] } : d));
  const { error } = await supabase.from("plan_versions").insert({ plan_id: planId, label, days });
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
  const { data: oldM, error: oldMErr } = await supabase.from("plan_mesocycles").select("id").eq("plan_id", planId);
  if (oldMErr) throw oldMErr;
  const oldMesoIds = new Set((oldM ?? []).map((m) => m.id as string));

  // Блоки. Новый снапшот хранит их список (planMesos): существующие оставляем (и возвращаем им
  // имя, порядок, скрытие, архив), исчезнувшие создаём заново, лишние после отката удаляем.
  // Старый снапшот (без списка) блоков не знает: блоки не трогаем, дни возвращаем в те, что ещё есть.
  const snapMesos = (version.days[0] as SnapDay | undefined)?.planMesos;
  const mesoMap = new Map<string, string>();
  const newMesos: Record<string, any>[] = [];
  const keepMesos: Mesocycle[] = [];
  if (snapMesos) for (const m of snapMesos) {
    if (oldMesoIds.has(m.id)) { mesoMap.set(m.id, m.id); keepMesos.push(m); continue; }
    const id = crypto.randomUUID();
    mesoMap.set(m.id, id);
    newMesos.push({ id, plan_id: planId, name: m.name, position: m.position, visible_to_client: m.visibleToClient !== false, archived_at: m.archivedAt ?? null });
  }
  else for (const id of oldMesoIds) mesoMap.set(id, id);

  const days: Record<string, any>[] = [];
  const exercises: Record<string, any>[] = [];
  const setRows: Record<string, any>[] = [];
  version.days.forEach((d, i) => {
    const dayId = crypto.randomUUID();
    // Все поля дня: скрытый день остаётся скрытым, круговая — круговой
    days.push({
      id: dayId, plan_id: planId, name: d.name, position: i, ...(d.weekday != null ? { weekday: d.weekday } : {}),
      mesocycle_id: (d.mesocycleId && mesoMap.get(d.mesocycleId)) || null,
      visible_to_client: d.visibleToClient !== false, method: d.method ?? "",
      archived_at: d.archivedAt ?? null, date_of: d.dateOf ?? null,
    });
    d.exercises.forEach((e, j) => {
      const exId = crypto.randomUUID();
      // Чего в снапшоте нет, берёт значение по умолчанию (defaultToNull: false), а не null
      exercises.push({
        id: exId, day_id: dayId, position: j, name: e.name ?? "", sets: e.sets ?? "", reps: e.reps ?? "", weight: e.weight ?? "", rest: e.rest ?? "",
        kind: e.kind ?? "", pulse_zone: e.pulseZone ?? "", detailed: e.detailed ?? false,
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
    await insert("plan_mesocycles", newMesos);
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
      if (newMesos.length) await supabase.from("plan_mesocycles").delete().in("id", newMesos.map((m) => m.id)).then(() => {}, () => {});
    }
    throw e;
  }
  // Дни уже из версии — блоки доводим до неё. Сбой здесь план не ломает: дни на месте,
  // в худшем случае останется лишний пустой блок или прежнее имя блока.
  if (snapMesos) {
    const extra = [...oldMesoIds].filter((id) => !mesoMap.has(id));
    if (extra.length) await supabase.from("plan_mesocycles").delete().in("id", extra).then(({ error }) => { if (error) console.error("[planVersions] лишние блоки:", error); });
    for (const m of keepMesos) {
      const { error } = await supabase.from("plan_mesocycles")
        .update({ name: m.name, position: m.position, visible_to_client: m.visibleToClient !== false, archived_at: m.archivedAt ?? null }).eq("id", m.id);
      if (error) console.error("[planVersions] блок:", error);
    }
  }
}
