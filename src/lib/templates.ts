import { supabase } from "./supabase";
import type { Day } from "../types";
import { notify } from "./dialog";

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
// Новый план для клиента из шаблона: план + дни шаблона. Клиент видит самый новый видимый
// план, поэтому создаём скрытым (иначе подменит текущий, да ещё пустым) и открываем клиенту,
// только если другого видимого неархивного плана у него нет. Сбой на середине — удаляем
// созданный план целиком (как duplicatePlan); не удалось удалить — он хотя бы скрыт.
export async function createPlanFromTemplate(trainerId: string, clientId: string, name: string, templateDays: Day[]): Promise<{ planId: string; hidden: boolean }> {
  const { data, error } = await supabase.from("plans").insert({ trainer_id: trainerId, client_id: clientId, name, visible_to_client: false }).select("id").single();
  if (error) throw error;
  const planId = data.id as string;
  try {
    await applyPlanTemplate(planId, templateDays, 0);
  } catch (e) {
    const { error: delErr } = await supabase.from("plans").delete().eq("id", planId);
    if (delErr) {
      console.error("[templates] откат плана:", delErr);
      notify(`Остался неполный план «${name}» (скрыт от клиента) — удали его вручную`, "error");
    }
    throw e;
  }
  const { data: others, error: othersErr } = await supabase
    .from("plans").select("id,archived,visible_to_client").eq("client_id", clientId).is("deleted_at", null).neq("id", planId);
  if (othersErr) { console.error("[templates] планы клиента:", othersErr); return { planId, hidden: true }; }
  if ((others ?? []).some((p) => !p.archived && p.visible_to_client !== false)) return { planId, hidden: true };
  const { error: visErr } = await supabase.from("plans").update({ visible_to_client: true }).eq("id", planId);
  if (visErr) { console.error("[templates] показать план:", visErr); return { planId, hidden: true }; }
  return { planId, hidden: false };
}
