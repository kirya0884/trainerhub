import { supabase } from "./supabase";
import type { Membership, Payment } from "./clients";
import { updateClient, syncMembershipToPartner, sessionPrice } from "./clients";
import { today as todayFn, addMonths } from "./format";

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
export interface Promotion { id: string; label: string; type: "percent" | "fixed"; value: number; appliesTo: string; active: boolean }

export async function fetchPromotions(clientId: string): Promise<Promotion[]> {
  const { data, error } = await supabase.from("client_promotions").select("id,label,type,value,applies_to,active").eq("client_id", clientId).order("active", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({ id: p.id, label: p.label ?? "", type: p.type, value: Number(p.value), appliesTo: p.applies_to, active: !!p.active }));
}

export async function addPromotion(clientId: string, p: Omit<Promotion, "id">) {
  const { error } = await supabase.from("client_promotions").insert({ client_id: clientId, label: p.label, type: p.type, value: p.value, applies_to: p.appliesTo, active: p.active });
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

// Применяет первую активную акцию, подходящую под appliesTo, к базовой цене
export function applyPromotion(basePrice: number, promotions: Promotion[], appliesTo: string) {
  const promo = promotions.find((p) => p.active && p.appliesTo === appliesTo);
  if (!promo) return { amount: basePrice, label: "" };
  const amount = promo.type === "percent" ? Math.round(basePrice * (1 - promo.value / 100)) : Math.max(0, basePrice - promo.value);
  return { amount, label: promo.label || (promo.type === "percent" ? `-${promo.value}%` : `-${promo.value}₽`) };
}

// ===================== Платежи (журнал) =====================
// sessionsDelta — сколько тренировок этот платёж добавил в остаток (см. markPaid) — нужно, чтобы при
// удалении платежа (deletePayment) корректно откатить остаток назад, а не оставлять его "зависшим".
export async function addPayment(clientId: string, p: { date: string; amount: number; type: string; note: string; promoApplied?: string }, sessionsDelta?: number) {
  const { error } = await supabase.from("client_payments").insert({ client_id: clientId, date: p.date, amount: p.amount, type: p.type, note: p.note, promo_applied: p.promoApplied ?? "", sessions_delta: sessionsDelta ?? null });
  if (error) throw error;
}

export async function updatePayment(id: string, p: Partial<{ date: string; amount: number; note: string }>) {
  const { error } = await supabase.from("client_payments").update(p).eq("id", id);
  if (error) throw error;
}

async function deletePaymentRow(id: string) {
  const { error } = await supabase.from("client_payments").delete().eq("id", id);
  if (error) throw error;
}

// Удаление платежа из журнала — если он добавлял тренировки в остаток (sessions_delta), откатываем остаток
// назад, чтобы кол-во тренировок везде (карточка, план, портал клиента) оставалось верным.
export async function deletePayment(id: string, clientId: string, membership: Membership): Promise<Membership> {
  const { data: row } = await supabase.from("client_payments").select("sessions_delta").eq("id", id).single();
  await deletePaymentRow(id);
  const delta = Number(row?.sessions_delta) || 0;
  if (!delta || membership.type === "subscription") return membership;
  const next: Membership = {
    ...membership,
    remaining: String(Math.max(0, (Number(membership.remaining) || 0) - delta)),
    remainingTotal: String(Math.max(0, (Number(membership.remainingTotal) || Number(membership.total) || 0) - delta)),
  };
  await updateClient(clientId, { membership: next });
  if (membership.split && membership.partnerClientId)
    await syncMembershipToPartner(membership.partnerClientId, { remaining: next.remaining, remainingTotal: next.remainingTotal });
  return next;
}

// Разбивает один платёж на N платежей той же датой (остаток округления — в последнюю часть)
export async function splitPayment(clientId: string, payment: Payment, parts: number) {
  if (parts < 2) return;
  // Читаем sessions_delta до удаления, чтобы правильно откатить баланс при удалении части.
  const { data: orig } = await supabase.from("client_payments").select("sessions_delta").eq("id", payment.id).single();
  const sessionsDelta = Number(orig?.sessions_delta) || 0;
  await deletePaymentRow(payment.id);
  const base = Math.floor(payment.amount / parts);
  for (let i = 0; i < parts; i++) {
    const amount = i === parts - 1 ? payment.amount - base * (parts - 1) : base;
    // sessions_delta записывается только в первую часть; остальные — 0, чтобы не дублировать откат.
    await addPayment(clientId, { date: payment.date, amount, type: payment.type, note: `${payment.note} (часть ${i + 1}/${parts})`.trim() }, i === 0 && sessionsDelta ? sessionsDelta : undefined);
  }
}

// Отметка «оплачено»: запись в журнал + обновление абонемента (остаток/дата следующего платежа).
// Если включён сплит с привязанным партнёром — сумма делится 50/50, платёж пишется обоим, остаток/даты зеркалятся.
export async function markPaid(clientId: string, membership: Membership, promotions: Promotion[]) {
  const today = todayFn();
  const isSplit = membership.split && !!membership.partnerClientId;
  const type = membership.type === "subscription" ? "subscription" : "sessions";
  const base = Number(membership.type === "subscription" ? membership.pricePerSession : membership.packagePrice) || 0;
  const { amount, label } = applyPromotion(base, promotions, type);
  // ponytail: если оформляем новый пакет, а старый остаток ещё не израсходован — сравниваем цену/тренировку.
  // Совпадает (или старая цена неизвестна — старые записи без remainingPrice) → суммируем в один блок.
  // Отличается → старый остаток уходит во "доп. блок" (см. Membership.extraRemaining), чтобы не терять тренировки.
  let dateFields: Partial<Membership>;
  if (membership.type === "subscription") {
    dateFields = { nextPaymentDate: addMonths(today, 1) };
  } else {
    const newPrice = sessionPrice(membership);
    const newTotal = Number(membership.total) || 0;
    const oldRemaining = Number(membership.remaining) || 0;
    const oldPrice = Number(membership.remainingPrice) || 0;
    // remainingTotal — денонимнатор для "X из Y" в UI; копит сумму слитых пакетов отдельно от total
    // (total — это размер последнего ОФОРМЛЯЕМОГО пакета, нужен для расчёта цены/тренировку выше).
    const oldRemainingTotal = Number(membership.remainingTotal) || Number(membership.total) || 0;
    if (oldRemaining <= 0) {
      dateFields = { remaining: membership.total, remainingPrice: String(newPrice), remainingTotal: membership.total };
    } else if (oldPrice === 0 || Math.round(oldPrice) === Math.round(newPrice)) {
      dateFields = { remaining: String(oldRemaining + newTotal), remainingPrice: String(newPrice), remainingTotal: String(oldRemainingTotal + newTotal) };
    } else {
      const extraRemaining = Number(membership.extraRemaining) || 0;
      const extraPrice = Number(membership.extraPricePerSession) || 0;
      const sameAsExtra = extraRemaining > 0 && Math.round(extraPrice) === Math.round(oldPrice);
      dateFields = {
        remaining: membership.total, remainingPrice: String(newPrice), remainingTotal: membership.total,
        extraRemaining: String(sameAsExtra ? extraRemaining + oldRemaining : oldRemaining),
        extraPricePerSession: String(oldPrice),
      };
    }
  }
  const merged: Membership = { ...membership, paymentDate: today, ...dateFields };
  // Во всех трёх веток выше новые тренировки пакета попадают в "remaining" — значит откат при
  // удалении платежа (deletePayment) всегда должен вычитать ровно membership.total из текущего остатка.
  const sessionsDelta = membership.type === "subscription" ? undefined : Number(membership.total) || 0;

  if (isSplit) {
    const half = Math.round(amount / 2);
    await addPayment(clientId, { date: today, amount: half, type, note: "сплит 50/50", promoApplied: label }, sessionsDelta);
    await addPayment(membership.partnerClientId, { date: today, amount: amount - half, type, note: "сплит 50/50 (партнёр)", promoApplied: label }, sessionsDelta);
    await updateClient(clientId, { membership: merged });
    await syncMembershipToPartner(membership.partnerClientId, { paymentDate: merged.paymentDate, ...dateFields });
  } else {
    await addPayment(clientId, { date: today, amount, type, note: "", promoApplied: label }, sessionsDelta);
    await updateClient(clientId, { membership: merged });
  }
  return merged;
}
