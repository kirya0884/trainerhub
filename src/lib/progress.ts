import { supabase } from "./supabase";
import { cached } from "./offlineCache";
import { fetchAll, fetchAllIn } from "./fetchAll";
import type { Metric, ProgressNote, Session, SessionItem } from "../types";

export interface ProgressData { progress: ProgressNote[]; metrics: Metric[]; sessions: Session[] }

// Упражнения тренировок (п.27, лимит 1000 строк). Страницами (fetchAll) нельзя: у
// plan_session_items нет столбца порядка, и сортировка по id для страниц перемешала бы
// упражнения внутри тренировки. Поэтому без сортировки, частями по 50 тренировок; часть,
// упёршаяся в 1000 строк, делится пополам — так ничего не обрезается молча.
const ITEMS_CHUNK = 50, MAX_ROWS = 1000;
async function itemsOf(ids: string[]): Promise<any[]> {
  const { data, error } = await supabase.from("plan_session_items").select("*").in("session_id", ids);
  if (error) throw error;
  if ((data?.length ?? 0) >= MAX_ROWS && ids.length > 1) {
    const h = ids.length >> 1;
    return [...await itemsOf(ids.slice(0, h)), ...await itemsOf(ids.slice(h))];
  }
  return data ?? [];
}
async function fetchSessionItems(sessionIds: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < sessionIds.length; i += ITEMS_CHUNK) out.push(...await itemsOf(sessionIds.slice(i, i + ITEMS_CHUNK)));
  return out;
}

// Ошибки не глотаем: пустая история вместо упавшего запроса попала бы в кэш для зала
// и обманула бы проверки при завершении тренировки
export async function fetchProgress(planId: string): Promise<ProgressData> {
  const { data: progress, error: e1 } = await supabase.from("plan_progress_notes").select("id,date,text").eq("plan_id", planId).order("date", { ascending: false });
  if (e1) throw e1;
  // Метрик у плана копится больше 1000 (≈8 за тренировку) — страницами, по уникальному (date, id)
  const metrics = await fetchAll<any>((from, to) => supabase.from("plan_metrics").select("*").eq("plan_id", planId).order("date").order("id").range(from, to));
  const { data: sessions, error: e3 } = await supabase.from("plan_sessions").select("*").eq("plan_id", planId).is("deleted_at", null).order("date", { ascending: false });
  if (e3) throw e3;
  const items = await fetchSessionItems((sessions ?? []).map((s) => s.id));
  const itemsBySession: Record<string, SessionItem[]> = {};
  for (const it of items ?? []) (itemsBySession[it.session_id] ??= []).push({ name: it.name, effort: it.effort ?? 0, rpe: it.rpe ?? 0, note: it.note ?? "", actualSets: it.actual_sets ?? undefined, plannedSets: it.planned_sets ?? undefined, plannedSummary: it.planned_summary ?? undefined });

  return {
    progress: (progress ?? []).map((p) => ({ id: p.id, date: p.date, text: p.text })),
    metrics: (metrics ?? []).map((m) => ({ id: m.id, date: m.date, exercise: m.exercise, weight: m.weight ?? "", reps: m.reps ?? "", rest: m.rest ?? "", sets: m.sets ?? "" })),
    sessions: (sessions ?? []).map((s) => ({
      id: s.id, date: s.date, dayName: s.day_name ?? "", dayId: s.day_id ?? null, mood: s.mood ?? 0, wellbeing: s.wellbeing ?? 0,
      clientRating: s.client_rating ?? 0, review: s.review ?? "", done: s.done ?? 0, total: s.total ?? 0,
      fromClient: !!s.from_client, items: itemsBySession[s.id] ?? [],
    })),
  };
}

/** История для экранов, без сети — сохранённая (последние 30 тренировок). Завершение
 *  тренировки берёт только свежую fetchProgress: проверки на устаревших данных опасны. */
export const fetchProgressCached = (planId: string) => cached(`progress:${planId}`, () => fetchProgress(planId),
  (d) => ({ ...d, sessions: d.sessions.slice(0, 30), metrics: d.metrics.slice(-300) }));

// Сводка для PDF-отчёта по клиенту: сессии и журнал упражнений по всем (неархивным) планам клиента.
// ponytail: без фото — печатный отчёт текстовый; замеры подтягивает вызывающий код через clients.fetchMeasurements
export async function fetchClientSessionsSummary(planIds: string[]): Promise<{ sessions: Session[]; metrics: Metric[] }> {
  if (!planIds.length) return { sessions: [], metrics: [] };
  // Страницами по уникальному ключу (п.27); ошибки пробрасываем — раньше отчёт молча выходил пустым
  const sessions = await fetchAllIn<any>(planIds, (ids, from, to) => supabase.from("plan_sessions").select("*").in("plan_id", ids).is("deleted_at", null)
    .order("date", { ascending: false }).order("id").range(from, to));
  const metrics = await fetchAllIn<any>(planIds, (ids, from, to) => supabase.from("plan_metrics").select("*").in("plan_id", ids).order("date").order("id").range(from, to));
  // Части по планам склеены — общий порядок восстанавливаем
  sessions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  metrics.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    sessions: (sessions ?? []).map((s) => ({
      id: s.id, date: s.date, dayName: s.day_name ?? "", dayId: s.day_id ?? null, mood: s.mood ?? 0, wellbeing: s.wellbeing ?? 0,
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
export const updateProgress = async (id: string, patch: Partial<{ date: string; text: string }>) => { const { error } = await supabase.from("plan_progress_notes").update(patch).eq("id", id); if (error) throw error; };
export const deleteProgress = async (id: string) => { const { error } = await supabase.from("plan_progress_notes").delete().eq("id", id); if (error) throw error; };

export async function addMetric(planId: string, m: Omit<Metric, "id">) {
  const { data, error } = await supabase.from("plan_metrics").insert({ plan_id: planId, ...m }).select().single();
  if (error) throw error;
  return { id: data.id, date: data.date, exercise: data.exercise, weight: data.weight ?? "", reps: data.reps ?? "", rest: data.rest ?? "", sets: data.sets ?? "" };
}
export const deleteMetric = async (id: string) => { const { error } = await supabase.from("plan_metrics").delete().eq("id", id); if (error) throw error; };

// Правка отзыва после фиксации факта тренировки (карточка по умолчанию read-only, см. карандаш в PlanEditor).
export const updateSessionReview = async (id: string, review: string) => { const { error } = await supabase.from("plan_sessions").update({ review }).eq("id", id); if (error) throw error; };

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

/**
 * Тренировка (сессия, упражнения, метрики, заметка) одной транзакцией — RPC log_workout
 * (миграция 20261031_stage2_workouts). sessionId задаёт телефон: повтор с тем же id
 * (очередь отправки, вторая вкладка, ответ не дошёл) ничего не пишет — created: false.
 */
export async function logWorkout(sessionId: string, planId: string, session: Record<string, unknown>,
  items: Record<string, unknown>[], metrics: Omit<Metric, "id">[], note = "") {
  const { data, error } = await supabase.rpc("log_workout", {
    p_session_id: sessionId, p_plan_id: planId, p_session: session, p_items: items, p_metrics: metrics, p_note: note,
  });
  if (error) throw error;
  return data as { created: boolean; session_id: string; session?: any; metrics?: any[]; note?: any };
}

// Фиксация факта тренировки: замеры + авто-запись в журнал + запись сессии — одной транзакцией на сервере
export async function logSession(planId: string, metricsIn: Omit<Metric, "id">[], note: string, session: Omit<Session, "id">, sessionId: string = crypto.randomUUID()) {
  const res = await logWorkout(sessionId, planId, {
    date: session.date, day_name: session.dayName, day_id: session.dayId ?? null,
    mood: session.mood || null, wellbeing: session.wellbeing || null, client_rating: session.clientRating || null,
    review: session.review, done: session.done, total: session.total, from_client: session.fromClient,
  }, session.items.map((i) => ({ name: i.name, effort: i.effort, rpe: i.rpe, note: i.note, actual_sets: i.actualSets ?? null, planned_sets: i.plannedSets ?? null, planned_summary: i.plannedSummary ?? null })),
  metricsIn, note.trim() ? note : "");

  // Повтор уже записанной (created: false): метрики и заметка ушли в прошлый раз, сессия — как отправляли
  const savedMetrics: Metric[] = (res.metrics ?? []).map((m) => ({ id: m.id, date: m.date, exercise: m.exercise, weight: m.weight ?? "", reps: m.reps ?? "", rest: m.rest ?? "", sets: m.sets ?? "" }));
  const noteRow = res.note ?? null;
  const sessRow = res.session ?? {
    id: sessionId, date: session.date, day_name: session.dayName, day_id: session.dayId ?? null, mood: session.mood, wellbeing: session.wellbeing,
    client_rating: session.clientRating, review: session.review, done: session.done, total: session.total, from_client: session.fromClient,
  };

  return {
    metrics: savedMetrics,
    progress: noteRow ? { id: noteRow.id, date: noteRow.date, text: noteRow.text } as ProgressNote : null,
    session: {
      id: sessRow.id, date: sessRow.date, dayName: sessRow.day_name ?? "", dayId: sessRow.day_id ?? null, mood: sessRow.mood ?? 0, wellbeing: sessRow.wellbeing ?? 0,
      clientRating: sessRow.client_rating ?? 0, review: sessRow.review ?? "", done: sessRow.done ?? 0, total: sessRow.total ?? 0,
      fromClient: !!sessRow.from_client, items: session.items,
    } as Session,
  };
}
