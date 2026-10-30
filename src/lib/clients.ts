import { supabase } from "./supabase";
import { notifyClientsChanged } from "./clientsBus";
import { CLIENT_COLORS } from "../constants";
import { today } from "./format";
import { ask } from "./dialog";
import { upgradeLime } from "./brand";
import { fetchAll, fetchAllIn } from "./fetchAll";

export interface ClientListItem {
  id: string;
  name: string;
  goal: string;
  color: string;
  status: string;
  activeSession: unknown;
  hasHealthFlags: boolean;
  remaining: string | null;
  avatarUrl: string;
  format: string;
}

// remaining — остаток тренировок из абонемента (только для типа "sessions"); для подписки/без абонемента — null (бейдж не рисуем).
// Суммируем основной блок и "доп. блок" (если оформили новый пакет по другой цене, пока старый не закончился — см. markPaid).
export const remainingOf = (membership: any): string | null => {
  if (membership?.type !== "sessions") return null;
  if ((membership.remaining === "" || membership.remaining == null) && !membership.extraRemaining) return null;
  return String((Number(membership.remaining) || 0) + (Number(membership.extraRemaining) || 0));
};

// Абонемент на нуле — не запрет (тренировка спишется в минус), но тренер должен знать
// до начала, а не узнать после. remaining = null — подписка или учёт не ведётся.
export async function confirmEmptyMembership(clients: { name: string; remaining?: string | null }[]): Promise<boolean> {
  const empty = clients.filter((c) => c.remaining != null && Number(c.remaining) <= 0).map((c) => c.name);
  if (!empty.length) return true;
  return ask(`${empty.join(", ")}: в абонементе не осталось тренировок. Начать всё равно?`, { ok: "Начать" });
}

export async function fetchClients(trainerId: string): Promise<ClientListItem[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id,name,goal,color,status,format,active_session,health,membership,avatar_url")
    .eq("trainer_id", trainerId)
    .eq("is_self", false) // своя карточка тренера («Я») — не подопечный
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id, name: c.name, goal: c.goal ?? "", color: upgradeLime(c.color), status: c.status, format: c.format ?? "",
    activeSession: c.active_session, hasHealthFlags: !!(c.health?.injuries || c.health?.restrictions),
    remaining: remainingOf(c.membership),
    avatarUrl: c.avatar_url ?? "",
  }));
}

export async function addClient(trainerId: string, name: string, goal: string, existingCount: number) {
  const color = CLIENT_COLORS[existingCount % CLIENT_COLORS.length];
  const { data, error } = await supabase
    .from("clients")
    .insert({ trainer_id: trainerId, name, goal, color, joined_at: today() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================== Корзина (soft-delete) =====================
export interface DeletedItem { id: string; name: string; deletedAt: string }

export async function deleteClient(id: string) {
  const { error } = await supabase.from("clients").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  notifyClientsChanged();
}

export async function fetchDeletedClients(trainerId: string): Promise<DeletedItem[]> {
  const { data, error } = await supabase.from("clients").select("id,name,deleted_at").eq("trainer_id", trainerId).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, deletedAt: c.deleted_at }));
}

export async function restoreClient(id: string) {
  const { error } = await supabase.from("clients").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
  notifyClientsChanged();
}

export async function permanentlyDeleteClient(id: string) {
  // Какие записи календаря держались на этом подопечном — узнаём ДО удаления:
  // внешний ключ стоит с on delete cascade и снесёт связи вместе с клиентом.
  // п.27: больше 1000 связей отдаются страницами (иначе хвост остался бы пустыми записями)
  const links = await fetchAll<{ booking_id: string }>((from, to) => supabase.from("booking_clients").select("booking_id").eq("client_id", id).order("booking_id").range(from, to));
  const touched = [...new Set(links.map((l) => l.booking_id))];

  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;

  // А5: подчищаем записи, оставшиеся совсем без подопечных. Делаем это только здесь —
  // при мягком удалении связи трогать нельзя, иначе восстановление из корзины
  // вернуло бы клиента без его тренировок. Окончательное удаление отката не имеет.
  if (!touched.length) return;
  // Ошибка чтения — исключение, а не «никого не осталось»: иначе удалили бы и групповые записи с другими подопечными
  const still = await fetchAllIn<{ booking_id: string }>(touched, (chunk, from, to) => supabase.from("booking_clients").select("booking_id").in("booking_id", chunk).order("booking_id").order("client_id").range(from, to));
  const alive = new Set(still.map((l) => l.booking_id));
  const empty = touched.filter((b) => !alive.has(b));
  if (empty.length) {
    const { error: delErr } = await supabase.from("bookings").delete().in("id", empty);
    if (delErr) throw delErr;
  }
}

export async function deletePlan(id: string) {
  const { error } = await supabase.from("plans").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function fetchDeletedPlans(trainerId: string): Promise<DeletedItem[]> {
  const { data, error } = await supabase.from("plans").select("id,name,deleted_at").eq("trainer_id", trainerId).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, deletedAt: p.deleted_at }));
}

export async function restorePlan(id: string) {
  const { error } = await supabase.from("plans").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
}

export async function permanentlyDeletePlan(id: string) {
  const { error } = await supabase.from("plans").delete().eq("id", id);
  if (error) throw error;
}

export interface PlanListItem {
  id: string;
  name: string;
  archived: boolean;
  visibleToClient?: boolean;
}

export async function fetchClientPlans(clientId: string): Promise<PlanListItem[]> {
  const { data, error } = await supabase
    .from("plans")
    .select("id,name,archived,visible_to_client")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({ ...p, visibleToClient: p.visible_to_client !== false }));
}

export interface PlanOverviewItem extends PlanListItem {
  clientId: string;
  clientName: string;
  clientColor: string;
  clientRemaining: string | null;
  /** Рабочих (не проведённых) дней в плане — для строки в «Планах». */
  daysCount?: number;
  /** Дата последней проведённой тренировки по плану. */
  lastDate?: string | null;
}

// Все планы тренера со всех клиентов — для глобальной вкладки «Планы».
export async function fetchAllPlans(trainerId: string): Promise<PlanOverviewItem[]> {
  // Без implicit embed clients(...) — у Supabase/PostgREST он падает с "more than one relationship was found",
  // если на clients ссылается больше одной колонки. Джойним вручную по уже отдельно загруженным клиентам.
  const [{ data: all, error }, clients, { data: self }] = await Promise.all([
    supabase.from("plans").select("id,name,archived,client_id,visible_to_client").eq("trainer_id", trainerId).is("deleted_at", null).order("created_at", { ascending: false }),
    fetchClients(trainerId),
    supabase.from("clients").select("id").eq("trainer_id", trainerId).eq("is_self", true).maybeSingle(),
  ]);
  if (error) throw error;
  // Свои планы тренера живут во вкладке «Я», в общем списке планов их нет
  const data = (all ?? []).filter((p) => p.client_id !== self?.id);
  const byId = new Map(clients.map((c) => [c.id, c]));
  // Число дней и последняя тренировка — только для подписи в строке, поэтому ошибка
  // этих запросов не роняет список: строка просто останется без них.
  const ids = (data ?? []).map((p) => p.id);
  // п.27: строк больше 1000 — страницами, id планов в .in() — частями (fetchAllIn)
  const noRows = (what: string) => (e: unknown) => { console.error(`[fetchAllPlans] ${what}:`, e); return []; };
  const [days, sessions] = await Promise.all([
    fetchAllIn<{ plan_id: string; archived_at: string | null }>(ids, (chunk, from, to) => supabase.from("plan_days").select("id,plan_id,archived_at").in("plan_id", chunk).order("id").range(from, to)).catch(noRows("дни")),
    fetchAllIn<{ plan_id: string; date: string | null }>(ids, (chunk, from, to) => supabase.from("plan_sessions").select("id,plan_id,date").in("plan_id", chunk).is("deleted_at", null).order("id").range(from, to)).catch(noRows("тренировки")),
  ]);
  const daysCount: Record<string, number> = {};
  for (const d of days) if (!d.archived_at) daysCount[d.plan_id] = (daysCount[d.plan_id] ?? 0) + 1;
  const lastDate: Record<string, string> = {};
  for (const s of sessions) if (s.date && (!lastDate[s.plan_id] || s.date > lastDate[s.plan_id])) lastDate[s.plan_id] = s.date;
  return (data ?? []).map((p) => ({
    id: p.id, name: p.name, archived: p.archived, clientId: p.client_id,
    visibleToClient: p.visible_to_client !== false,
    clientName: byId.get(p.client_id)?.name ?? "—", clientColor: byId.get(p.client_id)?.color ?? "#71717a",
    clientRemaining: byId.get(p.client_id)?.remaining ?? null,
    daysCount: daysCount[p.id] ?? 0, lastDate: lastDate[p.id] ?? null,
  }));
}

export async function addPlan(trainerId: string, clientId: string, name: string) {
  const { data, error } = await supabase
    .from("plans")
    .insert({ trainer_id: trainerId, client_id: clientId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================== Карточка клиента =====================

export interface Membership {
  type: string; total: string; packagePrice: string; pricePerSession: string; remaining: string;
  paymentDate: string; nextPaymentDate: string; split: boolean; partnerName: string; partnerClientId: string; note: string;
  // Цена/тренировку текущего остатка (для сравнения при оформлении нового пакета — см. markPaid) и "доп. блок" остатка,
  // если новый пакет оформили по другой цене, пока старый ещё не израсходован.
  remainingPrice: string; extraRemaining: string; extraPricePerSession: string;
  // "Из скольки" для текущего блока остатка — отдельно от total (total — это размер ПОСЛЕДНЕГО оформленного пакета,
  // remainingTotal — сумма всех слитых пакетов, чтобы "X из Y" не выглядело как баг после слияния блоков, см. markPaid).
  remainingTotal: string;
}
export interface Health { injuries: string; restrictions: string; notes: string }
export interface ClientFull {
  id: string; name: string; goal: string; color: string; avatarUrl: string;
  phone: string; telegram: string; whatsapp: string; email: string;
  status: string; format: string; pauseReason: string; source: string; trial: boolean;
  health: Health; membership: Membership; hasAccount: boolean;
  /** Своя карточка тренера («Я») — без абонемента и оплат */
  isSelf: boolean;
  activeSession: { planId: string; dayId: string; dayName: string; startedAt: number } | null;
}
export const emptyMembership: Membership = { type: "sessions", total: "", packagePrice: "", pricePerSession: "", remaining: "", paymentDate: "", nextPaymentDate: "", split: false, partnerName: "", partnerClientId: "", note: "", remainingPrice: "", extraRemaining: "", extraPricePerSession: "", remainingTotal: "" };

// Цена одной тренировки: для подписки — pricePerSession; для пакета — packagePrice/total (как считает Дашборд),
// с фоллбэком на pricePerSession для старых записей, где он мог быть вписан вручную.
export const sessionPrice = (m: Membership) => {
  if (m.type === "subscription") return Number(m.pricePerSession) || 0;
  const total = Number(m.total) || 0;
  return total > 0 ? (Number(m.packagePrice) || 0) / total : Number(m.pricePerSession) || 0;
};
// Остаток тренировок с учётом "доп. блока" — чтобы бейджи/предупреждения не считали клиента "без тренировок",
// когда на самом деле есть второй блок по другой цене.
export const combinedRemaining = (m: Membership) => (Number(m.remaining) || 0) + (Number(m.extraRemaining) || 0);
const emptyHealth: Health = { injuries: "", restrictions: "", notes: "" };

export async function fetchClient(clientId: string): Promise<ClientFull> {
  const { data, error } = await supabase
    .from("clients")
    .select("id,name,goal,color,avatar_url,phone,telegram,whatsapp,email,status,format,pause_reason,source,trial,health,membership,auth_user_id,active_session,is_self")
    .eq("id", clientId)
    .single();
  if (error) throw error;
  return {
    id: data.id, name: data.name, goal: data.goal ?? "", color: upgradeLime(data.color), avatarUrl: data.avatar_url ?? "",
    phone: data.phone ?? "", telegram: data.telegram ?? "", whatsapp: data.whatsapp ?? "", email: data.email ?? "",
    status: data.status, format: data.format ?? "", pauseReason: data.pause_reason ?? "", source: data.source ?? "", trial: !!data.trial,
    health: { ...emptyHealth, ...(data.health || {}) },
    membership: { ...emptyMembership, ...(data.membership || {}) },
    hasAccount: !!data.auth_user_id,
    isSelf: !!data.is_self,
    activeSession: data.active_session || null,
  };
}

// Тренер выдаёт клиенту доступ: Edge Function сама генерирует пароль и шлёт письмо (см. functions/register-client).
// resend — новый пароль и повторное письмо клиенту, который ещё ни разу не входил.
// emailFailed — письмо не ушло: функция один раз возвращает логин и пароль, чтобы тренер передал их сам.
export type InviteResult = { ok?: boolean; warning?: string; error?: string; emailFailed?: boolean; email?: string; password?: string };
export async function inviteClient(clientId: string, resend = false): Promise<InviteResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-client`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token}`,
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ clientId, resend }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// patch — камелкейс-поля клиента (включая membership/health целиком, если их трогаем — см. ClientProfile.patchMembership)
export async function updateClient(clientId: string, patch: Record<string, any>) {
  const row: Record<string, any> = {};
  const COLS: Record<string, string> = { pauseReason: "pause_reason", avatarUrl: "avatar_url" };
  for (const [k, v] of Object.entries(patch)) row[COLS[k] ?? k] = v;
  const { error } = await supabase.from("clients").update(row).eq("id", clientId);
  if (error) throw error;
  // Н3: общий список подопечных живёт в App и раздаётся всем экранам — сообщаем,
  // что его пора перечитать, иначе остаток обновится только там, где правили.
  notifyClientsChanged();
}

// Автосписание 1 тренировки из остатка пакета при факте проведения (подписку и пустой остаток не трогаем).
// Если включён сплит с привязанным партнёром — зеркалим новый остаток в его карточку (общий пул на двоих).
// П12: защита от двойного списания. Списание живёт в четырёх местах — проведение из плана,
// проведение из календаря, ручная отметка «Проведена» и серверная функция, которой
// пользуется сам клиент. Раньше они друг о друге не знали, и остаток уходил дважды.
//
// Эта проверка отвечает на вопрос «за эту дату у клиента уже есть проведённая тренировка».
// Клиентский путь тоже создаёт запись сессии (from_client), поэтому проверка его видит.
//
// ponytail: сознательное ограничение — два РЕАЛЬНЫХ занятия у одного клиента в один день
// вторым не спишутся. Владелец выбрал этот компромисс вместо журнала списаний с миграцией.
export async function hasSessionOnDate(clientId: string, date: string): Promise<boolean> {
  const { data: plans, error: plansErr } = await supabase
    .from("plans").select("id").eq("client_id", clientId).is("deleted_at", null);
  if (plansErr) throw plansErr;
  const ids = (plans ?? []).map((p) => p.id);
  if (!ids.length) return false;

  const { data, error } = await supabase
    // Пустой день (0 упражнений) пишется без списания — проведённой тренировкой не считаем
    .from("plan_sessions").select("id").in("plan_id", ids).eq("date", date).is("deleted_at", null).gt("total", 0).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

// Заработок по проведённым тренировкам (таблица session_charges): цена одной тренировки
// текущего блока на момент списания. Пишет сервер в той же транзакции, что и списание.
export type ChargeKind = "workout" | "no_show" | "refund";

// Аудит 30.10, п.20: списание целиком на сервере (charge_session) — остаток, доп. блок,
// остаток партнёру по сплиту и строка заработка одной транзакцией от СВЕЖЕГО абонемента.
// Раньше это были 3–4 запроса: строка заработка терялась молча, а абонемент писался
// целиком из переданной копии. Правила те же (подписка, пустой остаток, остаток ≤ 0 —
// не списываем). Дата — местный день телефона, а не UTC сервера.
// Сигнатура прежняя; membership нужен только чтобы не ходить на сервер, когда списывать нечего.
export async function decrementMembershipRemaining(clientId: string, membership: Membership, charge: { kind?: ChargeKind; date?: string } = {}) {
  if (membership.type === "subscription" || membership.remaining === "" || membership.remaining == null) return membership;
  const { data, error } = await supabase.rpc("charge_session", { p_client_id: clientId, p_kind: charge.kind ?? "workout", p_date: charge.date ?? today() });
  if (error) throw error;
  notifyClientsChanged();
  return { ...emptyMembership, ...((data as { membership?: Membership } | null)?.membership || {}) } as Membership;
}

// Возврат 1 тренировки в остаток пакета — при отмене/удалении тренировки по уважительной
// причине (refund) или добавлении разовой (payment — оплаченная разовая: платёж 'single').
// Аудит 30.10, пп.18, 20: всё на сервере (credit_session) одной транзакцией от свежего
// абонемента: остаток, партнёру по сплиту — только remaining, строка возврата, платёж.
// Раньше абонемент и партнёр писались целиком из копий экрана (затирали чужие списания),
// а строка возврата и платёж шли отдельными запросами. Правила прежние: подписка — без
// изменений; пустой остаток (разовая без пакета, П5) считается нулём; «X из Y» не меняется,
// если Y уже был. payment.id — ключ от повторов: повтор с тем же id второй раз не добавит.
export async function incrementMembershipRemaining(clientId: string, membership: Membership, refund?: { date?: string }, payment?: { id: string; date: string; amount: number }) {
  if (membership.type === "subscription") return { membership, duplicate: false };
  const { data, error } = await supabase.rpc("credit_session", {
    p_client_id: clientId,
    p_refund_date: refund ? refund.date ?? today() : null,
    p_payment_id: payment?.id ?? null, p_payment_date: payment?.date ?? null, p_payment_amount: payment?.amount ?? null,
  });
  if (error) throw error;
  notifyClientsChanged();
  const d = data as { membership?: Membership; duplicate?: boolean } | null;
  // duplicate: платёж с этим id уже записан прошлой попыткой — второй +1 сервер не сделал
  return { membership: { ...emptyMembership, ...(d?.membership || {}) } as Membership, duplicate: !!d?.duplicate };
}

export interface Measurement {
  id: string; date: string; note: string;
  weight: string; neck: string; shoulders: string; chest: string; waist: string;
  glutes: string; thigh: string; biceps: string; bodyfat: string; muscleMass: string;
}
const numOrNull = (v: string) => (v === "" || v == null ? null : Number(v));

export async function fetchMeasurements(clientId: string): Promise<Measurement[]> {
  const { data, error } = await supabase.from("client_measurements").select("*").eq("client_id", clientId).order("date");
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id, date: m.date, note: m.note ?? "",
    weight: m.weight ?? "", neck: m.neck ?? "", shoulders: m.shoulders ?? "", chest: m.chest ?? "",
    waist: m.waist ?? "", glutes: m.glutes ?? "", thigh: m.thigh ?? "", biceps: m.biceps ?? "",
    bodyfat: m.bodyfat ?? "", muscleMass: m.muscle_mass ?? "",
  }));
}

export async function addMeasurement(clientId: string, m: Omit<Measurement, "id">) {
  const { error } = await supabase.from("client_measurements").insert({
    client_id: clientId, date: m.date, note: m.note,
    weight: numOrNull(m.weight), neck: numOrNull(m.neck), shoulders: numOrNull(m.shoulders), chest: numOrNull(m.chest),
    waist: numOrNull(m.waist), glutes: numOrNull(m.glutes), thigh: numOrNull(m.thigh), biceps: numOrNull(m.biceps),
    bodyfat: numOrNull(m.bodyfat), muscle_mass: numOrNull(m.muscleMass),
  });
  if (error) throw error;
}

export async function deleteMeasurement(id: string) {
  const { error } = await supabase.from("client_measurements").delete().eq("id", id);
  if (error) throw error;
}

export interface Photo { id: string; url: string; date: string }

export async function fetchPhotos(clientId: string): Promise<Photo[]> {
  const { data, error } = await supabase.from("client_photos").select("id,url,taken_at").eq("client_id", clientId).order("taken_at");
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id, url: p.url, date: p.taken_at }));
}

// ponytail: фото храним как dataURL-превью прямо в text-колонке (как в исходнике) — без Storage-бакета.
// Для большого архива снимков лучше перевести на Supabase Storage + ссылки.
export async function addPhoto(clientId: string, url: string) {
  const { error } = await supabase.from("client_photos").insert({ client_id: clientId, url, taken_at: today() });
  if (error) throw error;
}

export async function deletePhoto(id: string) {
  const { error } = await supabase.from("client_photos").delete().eq("id", id);
  if (error) throw error;
}

export interface Payment { id: string; date: string; amount: number; type: string; note: string; promoApplied: string; payStatus: 'paid' | 'deferred' | 'installment' }

export async function fetchPayments(clientId: string): Promise<Payment[]> {
  // п.27: больше 1000 платежей — страницами; id — второй ключ сортировки, чтобы страницы не пересекались
  const data = await fetchAll<any>((from, to) => supabase.from("client_payments").select("id,date,amount,type,note,promo_applied,pay_status").eq("client_id", clientId).order("date", { ascending: false }).order("id").range(from, to));
  return data.map((p) => ({ id: p.id, date: p.date, amount: Number(p.amount) || 0, type: p.type ?? "", note: p.note ?? "", promoApplied: p.promo_applied ?? "", payStatus: (p.pay_status as Payment["payStatus"]) || "paid" }));
}

export interface ClientNote { id: string; date: string; text: string }

export async function fetchNotes(clientId: string): Promise<ClientNote[]> {
  const { data, error } = await supabase.from("client_notes").select("id,date,text").eq("client_id", clientId).order("date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addNote(clientId: string, text: string) {
  const { error } = await supabase.from("client_notes").insert({ client_id: clientId, text });
  if (error) throw error;
}

export async function deleteNote(id: string) {
  const { error } = await supabase.from("client_notes").delete().eq("id", id);
  if (error) throw error;
}
