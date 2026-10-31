import { supabase } from "./supabase";
import { expandBookings } from "./bookings";
import type { Booking } from "./bookings";
import type { Metric, Session } from "../types";
import { today, addDays } from "./format";
import { enqueue, isNetworkError, pending, registerHandler } from "./outbox";
import { fetchProgress, logWorkout } from "./progress";
import { fetchAll, fetchAllIn } from "./fetchAll";
import { upgradeLime } from "./brand";
import { patchCache } from "./offlineCache";

export interface SelfClient {
  id: string; trainerId: string; name: string; color: string; goal: string;
  phone: string; telegram: string; whatsapp: string; avatarUrl: string; accentColor: string;
  health: { injuries: string; restrictions: string; notes: string };
  membership: Record<string, any>;
  /** offlineStart — начата без сети: «начало» дошлётся вместе с завершением */
  activeSession: { planId: string; dayId: string; dayName: string; startedAt: number; offlineStart?: boolean } | null;
  /** Задан ли PIN кабинета (сам хэш на сервере). Хранится в кэше для зала, чтобы без сети PIN спрашивался */
  hasPin?: boolean;
}

export interface ClientActivity {
  id: string; date: string; type: string; value: string; unit: string;
}

// hasPin здесь не заполняется: App узнаёт его один раз при проверке доступа (has_my_pin),
// а перечитывание карточки по realtime во время тренировки PIN не трогает.
// П. 60: у одного входа может быть несколько карточек — у разных тренеров. Удалённые
// тренером (в корзине) доступа не дают. Порядок — по дате создания, чтобы список выбора не прыгал.
export async function fetchSelfClients(authUserId: string): Promise<SelfClient[]> {
  const { data, error } = await supabase
    .from("clients").select("id,trainer_id,name,color,goal,phone,telegram,whatsapp,avatar_url,accent_color,health,membership,active_session")
    .eq("auth_user_id", authUserId).is("deleted_at", null).order("created_at").order("id");
  if (error) throw error;
  return (data ?? []).map((data) => ({
    id: data.id, trainerId: data.trainer_id, name: data.name, color: upgradeLime(data.color), goal: data.goal ?? "",
    phone: data.phone ?? "", telegram: data.telegram ?? "", whatsapp: data.whatsapp ?? "", avatarUrl: data.avatar_url ?? "",
    accentColor: upgradeLime(data.accent_color) || "#22d3ee",
    health: { injuries: "", restrictions: "", notes: "", ...(data.health || {}) },
    membership: data.membership || {}, activeSession: data.active_session || null,
  }));
}

/** Кэш проверки доступа (offlineCache "access"). У клиента — все карточки (selves);
 *  self — кэш версии до п. 60 (одна карточка), читаем его, пока не перезапишется. */
export type AccessCache = { trainer: boolean; hasPin?: boolean; pin?: string | null; selves?: SelfClient[]; self?: (SelfClient & { pinHash?: string | null }) | null };
export const cachedSelves = (a: AccessCache): SelfClient[] => a.selves ?? (a.self ? [a.self] : []);
/** PIN входа из кэша: сверху, в кэше до п. 60 — в карточке, до 30.10 — по хэшу */
export const cachedAccessPin = (a: AccessCache): boolean => a.hasPin ?? (a.trainer ? !!a.pin : a.self?.hasPin ?? !!a.self?.pinHash);
/** Поправить карточки в кэше доступа (кэш до п. 60 заодно переводится на selves) */
export const patchCachedSelves = (f: (s: SelfClient[]) => SelfClient[]) =>
  patchCache<AccessCache>("access", (a) => (a.trainer ? a : { trainer: false, hasPin: cachedAccessPin(a), selves: f(cachedSelves(a)) }));

/** Выбранный тренер (карточка) на этом телефоне — когда карточек несколько. Ключ по входу. */
const pickKey = (uid: string) => `reps-client-card-${uid}`;
export function loadPickedCard(uid: string): string {
  try { return localStorage.getItem(pickKey(uid)) ?? ""; } catch { return ""; }
}
export function savePickedCard(uid: string, clientId: string) {
  try { if (clientId) localStorage.setItem(pickKey(uid), clientId); else localStorage.removeItem(pickKey(uid)); } catch { /* приватный режим */ }
}

/** Имена тренеров для экрана выбора: имя из профиля, иначе бренд. Кого не прочитали — нет в ответе. */
export async function fetchTrainerNames(trainerIds: string[]): Promise<Record<string, { name: string; brand: string; logoUrl: string }>> {
  const { data, error } = await supabase.from("trainers").select("id,brand,logo_url,profile").in("id", trainerIds);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((t) => [t.id, { name: String((t.profile as any)?.name || ""), brand: t.brand || "", logoUrl: t.logo_url || "" }]));
}

export async function fetchClientActivities(clientId: string): Promise<ClientActivity[]> {
  // Страницами (п.27, лимит 1000 строк); id — для уникальности порядка между страницами
  const data = await fetchAll<any>((from, to) => supabase.from("client_activities").select("id,date,type,value,unit").eq("client_id", clientId)
    .order("date", { ascending: false }).order("created_at", { ascending: false }).order("id").range(from, to));
  return data.map((r) => ({ id: r.id, date: r.date, type: r.type, value: r.value, unit: r.unit }));
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
  // Ошибку не глотаем: «записей нет» вместо упавшего запроса попало бы в кэш для зала
  // Страницами и частями .in() (п.27, лимит 1000 строк)
  const links = await fetchAll<{ booking_id: string }>((from, to) => supabase.from("booking_clients").select("booking_id").eq("client_id", clientId).order("booking_id").range(from, to));
  const ids = links.map((l) => l.booking_id);
  if (!ids.length) return null;
  const data = await fetchAllIn<any>(ids, (chunk, from, to) => supabase.from("bookings").select("*").in("id", chunk).order("id").range(from, to));
  const bookings: Booking[] = data.map((b: any) => toBooking(b, clientId));
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
// booking — занятие в календаре, которое сервер отметит «проведена» вместе с завершением (п.6 аудита 30.10)
export const finishClientSession = (clientId: string, booking?: { id: string; occDate: string | null } | null) =>
  supabase.rpc("finish_client_session", { p_client_id: clientId, p_booking_id: booking?.id ?? null, p_occ_date: booking?.occDate ?? null })
    .then(({ error }) => { if (error) throw error; });

// Клиенту разрешена запись только в plan_metrics / plan_sessions / plan_session_items (RLS client_inserts_own) —
// без progress_notes, поэтому в отличие от lib/progress.logSession здесь без авто-заметки тренеру.
// Одной транзакцией (RPC log_workout); повтор с тем же sessionId дубля не создаёт.
export async function logClientSession(sessionId: string, planId: string, metricsIn: Omit<Metric, "id">[], session: Omit<Session, "id">) {
  await logWorkout(sessionId, planId,
    { date: session.date, day_name: session.dayName, done: session.done, total: session.total, from_client: true },
    session.items.map((i) => ({ name: i.name, effort: i.effort, rpe: i.rpe || 0, note: i.note, actual_sets: i.actualSets ?? null, planned_sets: i.plannedSets ?? null, planned_summary: i.plannedSummary ?? null })),
    metricsIn);
}

// Занятие в календаре тренера, которое закрывает эта тренировка клиента: отметку «проведена»
// ставит сервер внутри finish_client_session (UPDATE на bookings клиенту не разрешён; групповые
// и не сегодняшние занятия сервер не отмечает — их отмечает тренер). Не нашли — null, тренер отметит сам.
async function findClientBooking(trainerId: string, clientId: string, dayName: string, date: string): Promise<{ id: string; occDate: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from("bookings")
      .select("*, booking_clients(client_id)")
      .eq("trainer_id", trainerId)
      .eq("day_name", dayName);
    if (error) throw error;
    const rows = (data ?? []).filter((b: any) => (b.booking_clients ?? []).some((x: any) => x.client_id === clientId));
    // Запись, которая действительно приходится на этот день — с учётом дня недели повтора
    // и переносов. Раньше любая еженедельная запись с этим днём плана считалась подходящей,
    // и при двух сериях (пн и чт) «проведена» могла встать не на ту.
    const occ = expandBookings(rows.map((b: any) => toBooking(b, clientId)), date, date).find((o) => o.status === "scheduled");
    return occ ? { id: occ.id, occDate: occ.isOccurrence ? occ.occDate : null } : null;
  } catch (e) { console.error("[findClientBooking]", e); return null; }
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
// sessionId — ключ от повторов записи (log_workout); у записей из очереди версии до 31.10 его нет
type ClientFinishState = { started?: boolean; logged?: boolean; finished?: boolean; sessionId?: string };

async function runClientFinish(job: ClientFinishJob, st: ClientFinishState, save: (s: ClientFinishState) => void, retry: boolean) {
  const put = (p: ClientFinishState) => { st = { ...st, ...p }; save(st); };
  if (job.offlineStart && !st.started) { await startSession(job.clientId, job.planId, job.dayId, job.dayName); put({ started: true }); }
  if (!st.logged) {
    const s = job.session;
    // Без ключа — из очереди прежней версии: она могла записать тренировку, а ответ не дошёл.
    // Тогда проверяем по истории, как раньше; с ключом повтор отсекает сервер.
    const already = retry && !st.sessionId && (await fetchProgress(job.planId)).sessions.some((x) =>
      x.fromClient && x.date === s.date && x.dayName === s.dayName && x.done === s.done && x.total === s.total);
    const sessionId = st.sessionId ?? crypto.randomUUID();
    // Ключ сохраняем ДО отправки: оборвётся — повтор пойдёт с тем же
    if (!st.sessionId) put({ sessionId });
    if (!already) await logClientSession(sessionId, job.planId, job.metrics, s);
    put({ logged: true });
  }
  if (!st.finished) {
    let stillOn = true;
    if (retry) {
      const { data, error } = await supabase.from("clients").select("active_session").eq("id", job.clientId).single();
      if (error) throw error;
      stillOn = !!data?.active_session;
    }
    if (stillOn) await finishClientSession(job.clientId, await findClientBooking(job.trainerId, job.clientId, job.dayName, job.session.date));
    put({ finished: true });
  }
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
