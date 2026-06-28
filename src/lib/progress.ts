import { supabase } from "./supabase";
import type { Metric, ProgressNote, Session, SessionItem } from "../types";

export interface ProgressData { progress: ProgressNote[]; metrics: Metric[]; sessions: Session[] }

export async function fetchProgress(planId: string): Promise<ProgressData> {
  const { data: progress } = await supabase.from("plan_progress_notes").select("id,date,text").eq("plan_id", planId).order("date", { ascending: false });
  const { data: metrics } = await supabase.from("plan_metrics").select("*").eq("plan_id", planId).order("date");
  const { data: sessions } = await supabase.from("plan_sessions").select("*").eq("plan_id", planId).is("deleted_at", null).order("date", { ascending: false });
  const sessIds = (sessions ?? []).map((s) => s.id);
  const { data: items } = sessIds.length
    ? await supabase.from("plan_session_items").select("*").in("session_id", sessIds)
    : { data: [] as any[] };
  const itemsBySession: Record<string, SessionItem[]> = {};
  for (const it of items ?? []) (itemsBySession[it.session_id] ??= []).push({ name: it.name, effort: it.effort ?? 0, rpe: it.rpe ?? 0, note: it.note ?? "" });

  return {
    progress: (progress ?? []).map((p) => ({ id: p.id, date: p.date, text: p.text })),
    metrics: (metrics ?? []).map((m) => ({ id: m.id, date: m.date, exercise: m.exercise, weight: m.weight ?? "", reps: m.reps ?? "", rest: m.rest ?? "", sets: m.sets ?? "" })),
    sessions: (sessions ?? []).map((s) => ({
      id: s.id, date: s.date, dayName: s.day_name ?? "", mood: s.mood ?? 0, wellbeing: s.wellbeing ?? 0,
      clientRating: s.client_rating ?? 0, review: s.review ?? "", done: s.done ?? 0, total: s.total ?? 0,
      fromClient: !!s.from_client, items: itemsBySession[s.id] ?? [],
    })),
  };
}

// Сводка для PDF-отчёта по клиенту: сессии и журнал упражнений по всем (неархивным) планам клиента.
// ponytail: без фото — печатный отчёт текстовый; замеры подтягивает вызывающий код через clients.fetchMeasurements
export async function fetchClientSessionsSummary(planIds: string[]): Promise<{ sessions: Session[]; metrics: Metric[] }> {
  if (!planIds.length) return { sessions: [], metrics: [] };
  const { data: sessions } = await supabase.from("plan_sessions").select("*").in("plan_id", planIds).is("deleted_at", null).order("date", { ascending: false });
  const { data: metrics } = await supabase.from("plan_metrics").select("*").in("plan_id", planIds).order("date");
  return {
    sessions: (sessions ?? []).map((s) => ({
      id: s.id, date: s.date, dayName: s.day_name ?? "", mood: s.mood ?? 0, wellbeing: s.wellbeing ?? 0,
      clientRating: s.client_rating ?? 0, review: s.review ?? "", done: s.done ?? 0, total: s.total ?? 0,
      fromClient: !!s.from_client, items: [],
    })),
    metrics: (metrics ?? []).map((m) => ({ id: m.id, date: m.date, exercise: m.exercise, weight: m.weight ?? "", reps: m.reps ?? "", rest: m.rest ?? "", sets: m.sets ?? "" })),
  };
}

export async function addProgress(planId: string) {
  const { data, error } = await supabase.from("plan_progress_notes").insert({ plan_id: planId, text: "" }).select().single();
  if (error) throw error;
  return { id: data.id, date: data.date, text: data.text };
}
export const updateProgress = (id: string, patch: Partial<{ date: string; text: string }>) =>
  supabase.from("plan_progress_notes").update(patch).eq("id", id);
export const deleteProgress = (id: string) => supabase.from("plan_progress_notes").delete().eq("id", id);

export async function addMetric(planId: string, m: Omit<Metric, "id">) {
  const { data, error } = await supabase.from("plan_metrics").insert({ plan_id: planId, ...m }).select().single();
  if (error) throw error;
  return { id: data.id, date: data.date, exercise: data.exercise, weight: data.weight ?? "", reps: data.reps ?? "", rest: data.rest ?? "", sets: data.sets ?? "" };
}
export const deleteMetric = (id: string) => supabase.from("plan_metrics").delete().eq("id", id);

// Правка отзыва после фиксации факта тренировки (карточка по умолчанию read-only, см. карандаш в PlanEditor).
export const updateSessionReview = (id: string, review: string) => supabase.from("plan_sessions").update({ review }).eq("id", id);

// ===================== Корзина тренировок (soft-delete) =====================
export type DeleteReason = "Уважительная" | "Проспал" | "Забыл" | "Ошибка";
export interface DeletedSession { id: string; date: string; dayName: string; deletedAt: string; deleteReason: string }

export async function deleteSession(id: string, reason: DeleteReason) {
  const { error } = await supabase.from("plan_sessions").update({ deleted_at: new Date().toISOString(), delete_reason: reason }).eq("id", id);
  if (error) throw error;
}

export async function fetchDeletedSessions(planId: string): Promise<DeletedSession[]> {
  const { data, error } = await supabase.from("plan_sessions").select("id,date,day_name,deleted_at,delete_reason").eq("plan_id", planId).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((s) => ({ id: s.id, date: s.date, dayName: s.day_name ?? "", deletedAt: s.deleted_at, deleteReason: s.delete_reason ?? "" }));
}

export async function restoreSession(id: string) {
  const { error } = await supabase.from("plan_sessions").update({ deleted_at: null, delete_reason: null }).eq("id", id);
  if (error) throw error;
}

export async function permanentlyDeleteSession(id: string) {
  const { error } = await supabase.from("plan_sessions").delete().eq("id", id);
  if (error) throw error;
}

// Фиксация факта тренировки: замеры + авто-запись в журнал + запись сессии (одной транзакцией на клиенте — три insert'а)
export async function logSession(planId: string, metricsIn: Omit<Metric, "id">[], note: string, session: Omit<Session, "id">) {
  let savedMetrics: Metric[] = [];
  if (metricsIn.length) {
    const { data, error } = await supabase.from("plan_metrics").insert(metricsIn.map((m) => ({ plan_id: planId, ...m }))).select();
    if (error) throw error;
    savedMetrics = (data ?? []).map((m) => ({ id: m.id, date: m.date, exercise: m.exercise, weight: m.weight ?? "", reps: m.reps ?? "", rest: m.rest ?? "", sets: m.sets ?? "" }));
  }

  const { data: noteRow, error: noteErr } = await supabase.from("plan_progress_notes").insert({ plan_id: planId, text: note }).select().single();
  if (noteErr) throw noteErr;

  const { data: sessRow, error: sessErr } = await supabase.from("plan_sessions").insert({
    plan_id: planId, date: session.date, day_name: session.dayName,
    mood: session.mood || null, wellbeing: session.wellbeing || null, client_rating: session.clientRating || null,
    review: session.review, done: session.done, total: session.total, from_client: session.fromClient,
  }).select().single();
  if (sessErr) throw sessErr;

  if (session.items.length) {
    const { error: itemsErr } = await supabase.from("plan_session_items").insert(
      session.items.map((i) => ({ session_id: sessRow.id, name: i.name, effort: i.effort, rpe: i.rpe, note: i.note }))
    );
    if (itemsErr) throw itemsErr;
  }

  return {
    metrics: savedMetrics,
    progress: { id: noteRow.id, date: noteRow.date, text: noteRow.text } as ProgressNote,
    session: {
      id: sessRow.id, date: sessRow.date, dayName: sessRow.day_name ?? "", mood: sessRow.mood ?? 0, wellbeing: sessRow.wellbeing ?? 0,
      clientRating: sessRow.client_rating ?? 0, review: sessRow.review ?? "", done: sessRow.done ?? 0, total: sessRow.total ?? 0,
      fromClient: !!sessRow.from_client, items: session.items,
    } as Session,
  };
}
