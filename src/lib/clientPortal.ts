import { supabase } from "./supabase";
import { expandBookings } from "./bookings";
import type { Booking } from "./bookings";
import type { Metric, Session } from "../types";
import { today, addDays } from "./format";
import { enqueue, isNetworkError, pending, registerHandler } from "./outbox";
import { fetchProgress } from "./progress";

export interface SelfClient {
  id: string; trainerId: string; name: string; color: string; goal: string;
  phone: string; telegram: string; whatsapp: string; avatarUrl: string; accentColor: string;
  health: { injuries: string; restrictions: string; notes: string };
  membership: Record<string, any>;
  /** offlineStart — начата без сети: «начало» дошлётся вместе с завершением */
  activeSession: { planId: string; dayId: string; dayName: string; startedAt: number; offlineStart?: boolean } | null;
}

export interface ClientActivity {
  id: string; date: string; type: string; value: string; unit: string;
}

export async function fetchSelfClient(authUserId: string): Promise<SelfClient | null> {
  const { data, error } = await supabase
    .from("clients").select("id,trainer_id,name,color,goal,phone,telegram,whatsapp,avatar_url,accent_color,health,membership,active_session")
    .eq("auth_user_id", authUserId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id, trainerId: data.trainer_id, name: data.name, color: data.color, goal: data.goal ?? "",
    phone: data.phone ?? "", telegram: data.telegram ?? "", whatsapp: data.whatsapp ?? "", avatarUrl: data.avatar_url ?? "",
    accentColor: data.accent_color || "#22d3ee",
    health: { injuries: "", restrictions: "", notes: "", ...(data.health || {}) },
    membership: data.membership || {}, activeSession: data.active_session || null,
  };
}

export async function fetchClientActivities(clientId: string): Promise<ClientActivity[]> {
  const { data, error } = await supabase.from("client_activities").select("id,date,type,value,unit").eq("client_id", clientId).order("date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, date: r.date, type: r.type, value: r.value, unit: r.unit }));
}

export async function addClientActivity(clientId: string, a: Omit<ClientActivity, "id">): Promise<ClientActivity> {
  const { data, error } = await supabase.from("client_activities").insert({ client_id: clientId, date: a.date, type: a.type, value: a.value, unit: a.unit }).select().single();
  if (error) throw error;
  return { id: data.id, date: data.date, type: data.type, value: data.value, unit: data.unit };
}

export async function deleteClientActivity(id: string) {
  const { error } = await supabase.from("client_activities").delete().eq("id", id);
  if (error) throw error;
}

// Клиент правит свои данные — через RPC (см. update_client_self_profile), не общий update.
export async function updateSelfProfile(clientId: string, p: { phone: string; telegram: string; whatsapp: string; avatarUrl: string; accentColor?: string; name?: string; goal?: string; health?: Record<string, string> }) {
  const { error } = await supabase.rpc("update_client_self_profile", {
    p_client_id: clientId, p_phone: p.phone, p_telegram: p.telegram, p_whatsapp: p.whatsapp, p_avatar_url: p.avatarUrl,
    p_accent_color: p.accentColor ?? null, p_name: p.name ?? null, p_goal: p.goal ?? null, p_health: p.health ?? null,
  });
  if (error) throw error;
}

export async function fetchTrainerBrand(trainerId: string) {
  const { data } = await supabase.from("trainers").select("brand,logo_url,profile").eq("id", trainerId).maybeSingle();
  return { brand: data?.brand || "Reps", logoUrl: data?.logo_url || "", trainingRules: (data?.profile as any)?.trainingRules || "" };
}

// Строка bookings глазами клиента: участники ему не видны, поэтому в записи только он сам
const toBooking = (b: any, clientId: string): Booking => ({
  id: b.id, planId: b.plan_id, dayId: b.day_id ?? null, dayName: b.day_name ?? null, date: b.date, time: b.time ?? "", duration: b.duration ?? 60,
  status: b.status ?? "scheduled", note: b.note ?? "", recurring: !!b.recurring, recurUntil: b.recur_until,
  exceptions: b.exceptions ?? {}, clientIds: [clientId],
});

export interface UpcomingBooking { date: string; time: string; duration: number }

// Клиент может читать только bookings, в которых он участвует (см. миграцию 0003) — раскрываем повторы на лету и берём ближайшее занятие
export async function fetchUpcomingBooking(clientId: string): Promise<UpcomingBooking | null> {
  const { data: links } = await supabase.from("booking_clients").select("booking_id").eq("client_id", clientId);
  const ids = (links ?? []).map((l) => l.booking_id);
  if (!ids.length) return null;
  const { data } = await supabase.from("bookings").select("*").in("id", ids);
  const bookings: Booking[] = (data ?? []).map((b: any) => toBooking(b, clientId));
  const todayStr = today();
  const occs = expandBookings(bookings, todayStr, addDays(todayStr, 60)).filter((o) => o.status !== "cancelled");
  occs.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const next = occs[0];
  return next ? { date: next.date, time: next.time, duration: next.duration } : null;
}

export async function updateSessionProgress(clientId: string, progress: Record<string, { done: boolean; setsDone?: Record<number, boolean>; note?: string }>) {
  const { error } = await supabase.rpc("update_session_progress", { p_client_id: clientId, p_progress: progress });
  if (error) throw error;
}

export const startSession = (clientId: string, planId: string, dayId: string, dayName: string) =>
  supabase.rpc("start_client_session", { p_client_id: clientId, p_plan_id: planId, p_day_id: dayId, p_day_name: dayName }).then(({ error }) => { if (error) throw error; });
export const cancelSession = (clientId: string) =>
  supabase.rpc("cancel_client_session", { p_client_id: clientId }).then(({ error }) => { if (error) throw error; });
export const finishClientSession = (clientId: string) =>
  supabase.rpc("finish_client_session", { p_client_id: clientId }).then(({ error }) => { if (error) throw error; });

// Клиенту разрешена запись только в plan_metrics / plan_sessions / plan_session_items (RLS client_inserts_own) —
// без progress_notes, поэтому в отличие от lib/progress.logSession здесь без авто-заметки тренеру
export async function logClientSession(planId: string, metricsIn: Omit<Metric, "id">[], session: Omit<Session, "id">) {
  if (metricsIn.length) {
    const { error } = await supabase.from("plan_metrics").insert(metricsIn.map((m) => ({ plan_id: planId, ...m })));
    if (error) throw error;
  }
  const { data: sessRow, error: sessErr } = await supabase.from("plan_sessions").insert({
    plan_id: planId, date: session.date, day_name: session.dayName, done: session.done, total: session.total, from_client: true,
  }).select().single();
  if (sessErr) throw sessErr;
  if (session.items.length) {
    const { error: itemsErr } = await supabase.from("plan_session_items").insert(
      session.items.map((i) => ({ session_id: sessRow.id, name: i.name, effort: i.effort, rpe: i.rpe || 0, note: i.note, actual_sets: i.actualSets ?? null, planned_sets: i.plannedSets ?? null, planned_summary: i.plannedSummary ?? null }))
    );
    if (itemsErr) throw itemsErr;
  }
}

// Отмечает запись в календаре тренера как проведённую, когда клиент завершает тренировку.
// fire-and-forget: если RLS не разрешает — тихо игнорируем, тренер отметит вручную.
export async function markClientBookingDone(trainerId: string, clientId: string, dayName: string, date: string) {
  try {
    const { data } = await supabase
      .from("bookings")
      .select("*, booking_clients(client_id)")
      .eq("trainer_id", trainerId)
      .eq("day_name", dayName);
    const rows = (data ?? []).filter((b: any) => (b.booking_clients ?? []).some((x: any) => x.client_id === clientId));
    // Запись, которая действительно приходится на этот день — с учётом дня недели повтора
    // и переносов. Раньше любая еженедельная запись с этим днём плана считалась подходящей,
    // и при двух сериях (пн и чт) «проведена» могла встать не на ту.
    const occ = expandBookings(rows.map((b: any) => toBooking(b, clientId)), date, date).find((o) => o.status === "scheduled");
    if (!occ) return;
    if (occ.isOccurrence) {
      const ex = rows.find((b: any) => b.id === occ.id)?.exceptions ?? {};
      const exceptions = { ...ex, [occ.occDate]: { ...(ex[occ.occDate] ?? {}), status: "done" } };
      await supabase.from("bookings").update({ exceptions }).eq("id", occ.id);
    } else {
      await supabase.from("bookings").update({ status: "done" }).eq("id", occ.id);
    }
  } catch (e) { console.error("[markClientBookingDone]", e); }
}

// ── Тренировка клиента без интернета ──
// Завершение (запись + finish_client_session, где сервер списывает тренировку) кладётся
// в очередь отправки с отметками сделанных шагов. finish_client_session списывает при
// каждом вызове, поэтому перед повтором проверяем: если на сервере тренировка уже не
// идёт (active_session пуст) — завершение прошло, второй раз не вызываем.
export type ClientFinishJob = {
  clientId: string; trainerId: string; planId: string; dayId: string; dayName: string;
  metrics: Omit<Metric, "id">[]; session: Omit<Session, "id">; offlineStart?: boolean;
};
type ClientFinishState = { started?: boolean; logged?: boolean; finished?: boolean };

async function runClientFinish(job: ClientFinishJob, st: ClientFinishState, save: (s: ClientFinishState) => void, retry: boolean) {
  const put = (p: ClientFinishState) => { st = { ...st, ...p }; save(st); };
  if (job.offlineStart && !st.started) { await startSession(job.clientId, job.planId, job.dayId, job.dayName); put({ started: true }); }
  if (!st.logged) {
    const s = job.session;
    const already = retry && (await fetchProgress(job.planId)).sessions.some((x) =>
      x.fromClient && x.date === s.date && x.dayName === s.dayName && x.done === s.done && x.total === s.total);
    if (!already) await logClientSession(job.planId, job.metrics, s);
    put({ logged: true });
  }
  if (!st.finished) {
    let stillOn = true;
    if (retry) {
      const { data, error } = await supabase.from("clients").select("active_session").eq("id", job.clientId).single();
      if (error) throw error;
      stillOn = !!data?.active_session;
    }
    if (stillOn) await finishClientSession(job.clientId);
    put({ finished: true });
  }
  markClientBookingDone(job.trainerId, job.clientId, job.dayName, job.session.date);
}
registerHandler("clientFinish", async (item, save) => {
  await runClientFinish(item.payload as ClientFinishJob, item.state as ClientFinishState, save, true);
});

/** Завершить сейчас, а без сети — в очередь. queued: true — тренировка ждёт отправки. */
// Сорвалось не из-за сети и клиент жмёт «Завершить» снова — продолжаем с того же шага
const attempts = new Map<string, ClientFinishState>();
export async function finishClientOrQueue(job: ClientFinishJob): Promise<{ queued: boolean }> {
  const key = `${job.clientId}|${job.dayId}|${job.session.date}`;
  const retry = attempts.has(key);
  let st: ClientFinishState = attempts.get(key) ?? {};
  try {
    await runClientFinish(job, st, (s) => { st = s; attempts.set(key, s); }, retry);
    attempts.delete(key);
    return { queued: false };
  } catch (e) {
    if (!isNetworkError(e)) { attempts.set(key, st); throw e; }
    attempts.delete(key);
    await enqueue("clientFinish", job, st);
    return { queued: true };
  }
}

/** Есть ли у клиента неотправленная тренировка — новую начинать нельзя, чтобы не перепутались */
export const hasPendingClientFinish = (clientId: string) =>
  pending(undefined, "clientFinish").some((i) => (i.payload as ClientFinishJob).clientId === clientId);
