import { supabase } from "./supabase";
import { CLIENT_COLORS } from "../constants";
import { today } from "./format";

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
const remainingOf = (membership: any) => {
  if (membership?.type !== "sessions") return null;
  if ((membership.remaining === "" || membership.remaining == null) && !membership.extraRemaining) return null;
  return String((Number(membership.remaining) || 0) + (Number(membership.extraRemaining) || 0));
};

export async function fetchClients(trainerId: string): Promise<ClientListItem[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id,name,goal,color,status,format,active_session,health,membership,avatar_url")
    .eq("trainer_id", trainerId)
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id, name: c.name, goal: c.goal ?? "", color: c.color, status: c.status, format: c.format ?? "",
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
}

export async function fetchDeletedClients(trainerId: string): Promise<DeletedItem[]> {
  const { data, error } = await supabase.from("clients").select("id,name,deleted_at").eq("trainer_id", trainerId).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, deletedAt: c.deleted_at }));
}

export async function restoreClient(id: string) {
  const { error } = await supabase.from("clients").update({ deleted_at: null }).eq("id", id);
  if (error) throw error;
}

export async function permanentlyDeleteClient(id: string) {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
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
}

// Все планы тренера со всех клиентов — для глобальной вкладки «Планы».
export async function fetchAllPlans(trainerId: string): Promise<PlanOverviewItem[]> {
  // Без implicit embed clients(...) — у Supabase/PostgREST он падает с "more than one relationship was found",
  // если на clients ссылается больше одной колонки. Джойним вручную по уже отдельно загруженным клиентам.
  const [{ data, error }, clients] = await Promise.all([
    supabase.from("plans").select("id,name,archived,client_id").eq("trainer_id", trainerId).is("deleted_at", null).order("created_at", { ascending: false }),
    fetchClients(trainerId),
  ]);
  if (error) throw error;
  const byId = new Map(clients.map((c) => [c.id, c]));
  return (data ?? []).map((p) => ({
    id: p.id, name: p.name, archived: p.archived, clientId: p.client_id,
    clientName: byId.get(p.client_id)?.name ?? "—", clientColor: byId.get(p.client_id)?.color ?? "#71717a",
    clientRemaining: byId.get(p.client_id)?.remaining ?? null,
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
  activeSession: { planId: string; dayId: string; dayName: string; startedAt: number } | null;
}
const emptyMembership: Membership = { type: "sessions", total: "", packagePrice: "", pricePerSession: "", remaining: "", paymentDate: "", nextPaymentDate: "", split: false, partnerName: "", partnerClientId: "", note: "", remainingPrice: "", extraRemaining: "", extraPricePerSession: "", remainingTotal: "" };

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
    .select("id,name,goal,color,avatar_url,phone,telegram,whatsapp,email,status,format,pause_reason,source,trial,health,membership,auth_user_id,active_session")
    .eq("id", clientId)
    .single();
  if (error) throw error;
  return {
    id: data.id, name: data.name, goal: data.goal ?? "", color: data.color, avatarUrl: data.avatar_url ?? "",
    phone: data.phone ?? "", telegram: data.telegram ?? "", whatsapp: data.whatsapp ?? "", email: data.email ?? "",
    status: data.status, format: data.format ?? "", pauseReason: data.pause_reason ?? "", source: data.source ?? "", trial: !!data.trial,
    health: { ...emptyHealth, ...(data.health || {}) },
    membership: { ...emptyMembership, ...(data.membership || {}) },
    hasAccount: !!data.auth_user_id,
    activeSession: data.active_session || null,
  };
}

// Тренер выдаёт клиенту доступ: Edge Function сама генерирует пароль и шлёт письмо (см. functions/register-client).
export async function inviteClient(clientId: string): Promise<{ ok?: boolean; warning?: string; error?: string }> {
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
      body: JSON.stringify({ clientId }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// patch — камелкейс-поля клиента (включая membership/health целиком, если их трогаем — см. ClientProfile.patchMembership)
export async function updateClient(clientId: string, patch: Record<string, any>) {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) row[k === "pauseReason" ? "pause_reason" : k] = v;
  const { error } = await supabase.from("clients").update(row).eq("id", clientId);
  if (error) throw error;
}

// Автосписание 1 тренировки из остатка пакета при факте проведения (подписку и пустой остаток не трогаем).
// Если включён сплит с привязанным партнёром — зеркалим новый остаток в его карточку (общий пул на двоих).
export async function decrementMembershipRemaining(clientId: string, membership: Membership) {
  if (membership.type === "subscription" || membership.remaining === "" || membership.remaining == null) return membership;
  const left = Number(membership.remaining);
  if (Number.isNaN(left) || left <= 0) return membership;
  let next = { ...membership, remaining: String(left - 1) };
  // ponytail: основной блок закончился — переносим "доп. блок" (другая цена) на его место
  if (Number(next.remaining) <= 0 && Number(next.extraRemaining) > 0) {
    next = { ...next, remaining: next.extraRemaining, remainingPrice: next.extraPricePerSession, remainingTotal: next.extraRemaining, extraRemaining: "", extraPricePerSession: "" };
  }
  await updateClient(clientId, { membership: next });
  if (membership.split && membership.partnerClientId)
    await syncMembershipToPartner(membership.partnerClientId, { remaining: next.remaining, remainingPrice: next.remainingPrice, extraRemaining: next.extraRemaining, extraPricePerSession: next.extraPricePerSession });
  return next;
}

// Возврат 1 тренировки в остаток пакета — при отмене/удалении тренировки по уважительной причине (зеркало decrementMembershipRemaining).
export async function incrementMembershipRemaining(clientId: string, membership: Membership) {
  if (membership.type === "subscription" || membership.remaining === "" || membership.remaining == null) return membership;
  const left = Number(membership.remaining);
  if (Number.isNaN(left)) return membership;
  // remainingTotal is the denominator for "X of Y" display — it should NOT change when returning a session
  const next = { ...membership, remaining: String(left + 1) };
  await updateClient(clientId, { membership: next });
  if (membership.split && membership.partnerClientId) await syncMembershipToPartner(membership.partnerClientId, { remaining: next.remaining });
  return next;
}

// Переносит указанные поля абонемента партнёру по сплиту, не трогая его собственные split/partnerName/partnerClientId.
export async function syncMembershipToPartner(partnerId: string, fields: Partial<Membership>) {
  const partner = await fetchClient(partnerId);
  await updateClient(partnerId, { membership: { ...partner.membership, ...fields } });
}

// Связывает двух клиентов в сплит-пару: общий тип/остаток абонемента, оплата делится 50/50 (см. lib/payments.ts).
export async function linkSplitPartner(selfId: string, selfName: string, partnerId: string, partnerName: string, membership: Membership) {
  const selfNext: Membership = { ...membership, split: true, partnerClientId: partnerId, partnerName };
  await updateClient(selfId, { membership: selfNext });
  const partner = await fetchClient(partnerId);
  await updateClient(partnerId, {
    membership: { ...partner.membership, type: membership.type, total: membership.total, packagePrice: membership.packagePrice, pricePerSession: membership.pricePerSession, remaining: membership.remaining, remainingPrice: membership.remainingPrice, remainingTotal: membership.remainingTotal, extraRemaining: membership.extraRemaining, extraPricePerSession: membership.extraPricePerSession, paymentDate: membership.paymentDate, nextPaymentDate: membership.nextPaymentDate, split: true, partnerClientId: selfId, partnerName: selfName },
  });
  return selfNext;
}

// Отвязывает сплит-пару (с обеих сторон, если партнёр всё ещё указывает на этого клиента).
export async function unlinkSplitPartner(selfId: string, membership: Membership) {
  const partnerId = membership.partnerClientId;
  const selfNext: Membership = { ...membership, split: false, partnerClientId: "", partnerName: "" };
  await updateClient(selfId, { membership: selfNext });
  if (partnerId) {
    const partner = await fetchClient(partnerId);
    if (partner.membership.partnerClientId === selfId) await updateClient(partnerId, { membership: { ...partner.membership, split: false, partnerClientId: "", partnerName: "" } });
  }
  return selfNext;
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
  const { data, error } = await supabase.from("client_payments").select("id,date,amount,type,note,promo_applied,pay_status").eq("client_id", clientId).order("date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id, date: p.date, amount: Number(p.amount) || 0, type: p.type ?? "", note: p.note ?? "", promoApplied: p.promo_applied ?? "", payStatus: (p.pay_status as Payment["payStatus"]) || "paid" }));
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
