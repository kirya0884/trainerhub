import { supabase } from "./supabase";
import type { Membership } from "./clients";
import { emptyMembership } from "./clients";
import { notifyClientsChanged } from "./clientsBus";
import { today as todayFn } from "./format";
import { notify } from "./dialog";

// ===================== Шаблоны пакетов =====================
export interface PackageTemplate { id: string; name: string; sessions: number; price: number; discount: number; split: boolean }

// Типовые пакеты из прототипа — заводим один раз для нового тренера, цену он проставляет сам.
// ponytail: флаг "уже сидили" держим в localStorage (не в БД), чтобы не плодить лишнюю таблицу настроек;
// если тренер удалит все шаблоны, на этом устройстве они не появятся снова.
const DEFAULT_PACKAGE_TEMPLATES: Omit<PackageTemplate, "id">[] = [
  { name: "4 тренировки", sessions: 4, price: 0, discount: 0, split: false },
  { name: "8 тренировок", sessions: 8, price: 0, discount: 0, split: false },
  { name: "12 тренировок", sessions: 12, price: 0, discount: 0, split: false },
  { name: "8 тренировок (сплит)", sessions: 8, price: 0, discount: 0, split: true },
];

export async function fetchPackageTemplates(trainerId: string): Promise<PackageTemplate[]> {
  const { data, error } = await supabase.from("package_templates").select("id,name,sessions,price,discount,split").eq("trainer_id", trainerId).order("position");
  if (error) throw error;
  const seededKey = `trainerhub-seeded-templates-${trainerId}`;
  if ((data ?? []).length === 0 && !localStorage.getItem(seededKey)) {
    localStorage.setItem(seededKey, "1");
    await Promise.all(DEFAULT_PACKAGE_TEMPLATES.map((t) => savePackageTemplate(trainerId, t)));
    return fetchPackageTemplates(trainerId);
  }
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, sessions: t.sessions, price: Number(t.price), discount: Number(t.discount) || 0, split: !!t.split }));
}

export async function savePackageTemplate(trainerId: string, t: Omit<PackageTemplate, "id">) {
  const { error } = await supabase.from("package_templates").insert({ trainer_id: trainerId, name: t.name, sessions: t.sessions, price: t.price, discount: t.discount ?? 0, split: t.split });
  if (error) throw error;
}

export async function deletePackageTemplate(id: string) {
  const { error } = await supabase.from("package_templates").delete().eq("id", id);
  if (error) throw error;
}

export async function updatePackageTemplate(id: string, t: Omit<PackageTemplate, "id">) {
  const { error } = await supabase.from("package_templates").update({ name: t.name, sessions: t.sessions, price: t.price, discount: t.discount ?? 0, split: t.split }).eq("id", id);
  if (error) throw error;
}

// ===================== Акции/скидки клиента =====================
// 5.7: once — акция на одну оплату (после неё выключается, см. markPaid); until — последний день действия
export interface Promotion { id: string; label: string; type: "percent" | "fixed"; value: number; appliesTo: string; active: boolean; once: boolean; until: string }

export async function fetchPromotions(clientId: string): Promise<Promotion[]> {
  const { data, error } = await supabase.from("client_promotions").select("id,label,type,value,applies_to,active,once,until").eq("client_id", clientId).order("active", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id, label: p.label ?? "", type: p.type, value: Number(p.value), appliesTo: p.applies_to, active: !!p.active, once: !!p.once, until: p.until ?? "" }));
}

export async function addPromotion(clientId: string, p: Omit<Promotion, "id">) {
  const { error } = await supabase.from("client_promotions").insert({ client_id: clientId, label: p.label, type: p.type, value: p.value, applies_to: p.appliesTo, active: p.active, once: p.once, until: p.until || null });
  if (error) throw error;
}

export async function togglePromotion(id: string, active: boolean) {
  const { error } = await supabase.from("client_promotions").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function deletePromotion(id: string) {
  const { error } = await supabase.from("client_promotions").delete().eq("id", id);
  if (error) throw error;
}

// Применяет первую активную акцию, подходящую под appliesTo и действующую на дату оплаты, к базовой цене.
// promo — какая акция применилась (5.7: одноразовую после оплаты выключаем).
export function applyPromotion(basePrice: number, promotions: Promotion[], appliesTo: string, date: string = todayFn()): { amount: number; label: string; promo?: { id: string; once: boolean } } {
  const promo = promotions.find((p) => p.active && p.appliesTo === appliesTo && (!p.until || date <= p.until));
  if (!promo) return { amount: basePrice, label: "" };
  const amount = promo.type === "percent" ? Math.round(basePrice * (1 - promo.value / 100)) : Math.max(0, basePrice - promo.value);
  return { amount, label: promo.label || (promo.type === "percent" ? `-${promo.value}%` : `-${promo.value}₽`), promo: { id: promo.id, once: promo.once } };
}

// ===================== Платежи (журнал) =====================
// sessionsDelta — сколько тренировок этот платёж добавил в остаток (см. markPaid) — нужно, чтобы при
// удалении платежа (deletePayment) корректно откатить остаток назад, а не оставлять его "зависшим".
export type PayStatus = 'paid' | 'deferred' | 'installment';

export async function addPayment(clientId: string, p: { date: string; amount: number; type: string; note: string; promoApplied?: string; payStatus?: PayStatus }, sessionsDelta?: number) {
  const { error } = await supabase.from("client_payments").insert({ client_id: clientId, date: p.date, amount: p.amount, type: p.type, note: p.note, promo_applied: p.promoApplied ?? "", sessions_delta: sessionsDelta ?? null, pay_status: p.payStatus ?? 'paid' });
  if (error) throw error;
}

// due_date — 5.3: срок оплаты «частями» (дата платежа при этом остаётся датой оплаты)
export async function updatePayment(id: string, p: Partial<{ date: string; amount: number; note: string; due_date: string }>) {
  const { error } = await supabase.from("client_payments").update(p).eq("id", id);
  if (error) throw error;
}

// 5.3: остаток оплаты «частями» — отдельная строка installment датой оплаты и сроком due_date,
// без начисления тренировок. id создаёт фронт и хранит до успеха: повтор после потерянного
// ответа упрётся в 23505 — это успех.
export async function addInstallmentRest(id: string, clientId: string, p: { date: string; dueDate: string; amount: number; type: string }) {
  const { error } = await supabase.from("client_payments").insert({ id, client_id: clientId, date: p.date, due_date: p.dueDate, amount: p.amount, type: p.type, note: "остаток", promo_applied: "", sessions_delta: null, pay_status: "installment" });
  if (error && error.code !== "23505") throw error;
}

// Аудит 2026-10-30, п. 17–18: оплата, разбивка и удаление платежа, правка абонемента —
// серверные функции (миграция 20261031_stage2_payments.sql). Каждая — одна транзакция под
// блокировкой карточки: обрыв не оставит «платёж без пакета», а остаток считается от того,
// что в базе, а не от экрана (списание клиентом/календарём больше не откатывается).
// Ключ от повторов — id платежа создаёт фронт: повтор с тем же id второй платёж не пишет.
const fullMembership = (m: unknown): Membership => ({ ...emptyMembership, ...((m as Partial<Membership>) || {}) });

// Удаление платежа из журнала — если он добавлял тренировки в остаток (sessions_delta), сервер
// откатывает остаток (и партнёру по сплиту). Повтор, когда платежа уже нет, ничего не меняет.
export async function deletePayment(id: string, clientId: string): Promise<Membership> {
  const { data, error } = await supabase.rpc("delete_payment", { p_payment_id: id, p_client_id: clientId });
  if (error) throw error;
  notifyClientsChanged();
  return fullMembership(data);
}

// Разбивает один платёж на N платежей той же датой (остаток округления — в последнюю часть).
// Исходная строка становится частью 1; newIds — id частей 2..N (N = newIds.length + 1).
// Повтор с теми же newIds ничего не делает — их надо хранить до успеха (см. ClientProfile).
export async function splitPayment(paymentId: string, newIds: string[]) {
  if (newIds.length < 1) return;
  const { error } = await supabase.rpc("split_payment", { p_payment_id: paymentId, p_new_ids: newIds });
  if (error) throw error;
}

// Правка НАСТРОЕК абонемента (тип, пакет, цена, дата след. платежа, заметка, сплит-флаг):
// на сервере сливаются только переданные ключи. Остаток через неё не меняется.
export type MembershipSettings = Partial<Pick<Membership, "type" | "total" | "packagePrice" | "pricePerSession" | "nextPaymentDate" | "note" | "split">>;
export async function patchMembership(clientId: string, patch: MembershipSettings): Promise<Membership> {
  const { data, error } = await supabase.rpc("patch_membership", { p_client_id: clientId, p_patch: patch });
  if (error) throw error;
  notifyClientsChanged();
  return fullMembership(data);
}

// Сплит-пара: общий тип/пакет/остаток, оплата 50/50. Обе стороны — одной транзакцией.
export async function linkSplit(clientId: string, partnerId: string): Promise<Membership> {
  const { data, error } = await supabase.rpc("link_split_partner", { p_client_id: clientId, p_partner_id: partnerId });
  if (error) throw error;
  notifyClientsChanged();
  return fullMembership(data);
}
export async function unlinkSplit(clientId: string): Promise<Membership> {
  const { data, error } = await supabase.rpc("unlink_split_partner", { p_client_id: clientId });
  if (error) throw error;
  notifyClientsChanged();
  return fullMembership(data);
}

// Отметка «оплачено»: платёж в журнал + пополнение абонемента (остаток/дата следующего платежа) —
// на сервере, см. record_payment. Сплит с привязанным партнёром — сумма 50/50, остаток зеркалится.
// membership — то, что видит тренер: из него берутся дата, сумма (с акцией) и настройки пакета
// (выбранный шаблон мог ещё не сохраниться). Остаток сервер считает от текущего в базе.
// paymentId — ключ от повторов: при повторе после ошибки передавать тот же.
// duplicate = true — этот платёж уже был записан раньше, второй не создан.
// amount — 5.3: записать другую сумму (отданную часть); акция всё равно считается от пакета.
// promoOff — 5.7: id одноразовой акции, которая применилась и теперь выключена (для «Отменить»).
export async function markPaid(clientId: string, membership: Membership, promotions: Promotion[], payStatus: PayStatus = 'paid', paymentId: string = crypto.randomUUID(), amount?: number): Promise<{ membership: Membership; duplicate: boolean; promoOff: string | null }> {
  // Используем дату, которую тренер указал в форме; если не указана — сегодня
  const payDate = membership.paymentDate && membership.paymentDate.length === 10 ? membership.paymentDate : todayFn();
  const type = membership.type === "subscription" ? "subscription" : "sessions";
  const base = Number(membership.type === "subscription" ? membership.pricePerSession : membership.packagePrice) || 0;
  const { amount: promoAmount, label, promo } = applyPromotion(base, promotions, type, payDate);
  const { data, error } = await supabase.rpc("record_payment", {
    p_payment_id: paymentId, p_client_id: clientId, p_date: payDate, p_amount: amount ?? promoAmount, p_pay_status: payStatus, p_promo: label,
    p_package: { type: membership.type, total: membership.total, packagePrice: membership.packagePrice, pricePerSession: membership.pricePerSession, split: !!membership.split },
  });
  if (error) throw error;
  notifyClientsChanged();
  // 5.7: одноразовая акция отработала — выключаем (и при повторе: оплата с ней уже записана).
  // Не вышло — оплату не роняем, акция останется включённой и видна в списке.
  let promoOff: string | null = null;
  if (promo?.once) {
    try { await togglePromotion(promo.id, false); promoOff = promo.id; }
    catch (e) { console.error("[payments] выключить одноразовую акцию:", e); notify("Оплата записана, но разовую акцию выключить не удалось — выключи её в «Акциях»", "error"); }
  }
  return { membership: fullMembership(data?.membership), duplicate: !!data?.duplicate, promoOff };
}

// Конвертирует deferred/installment → paid (клиент погасил долг).
// 5.4: дата — сегодня, иначе долг, погашенный сейчас, попадал в «Поступило» прошлого месяца.
// status и date — для «Отменить»: вернуть платежу прежние статус и дату.
// Чем на самом деле записан платёж с этим id — при ответе duplicate (ответ прошлой попытки потерялся)
export async function fetchPaymentRow(id: string): Promise<{ payStatus: PayStatus; amount: number } | null> {
  const { data, error } = await supabase.from("client_payments").select("pay_status,amount").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { payStatus: data.pay_status as PayStatus, amount: Number(data.amount) } : null;
}

export async function markPaymentPaid(id: string, status: PayStatus = 'paid', date: string = todayFn()) {
  const { error } = await supabase.from("client_payments").update({ pay_status: status, date }).eq("id", id);
  if (error) throw error;
}
