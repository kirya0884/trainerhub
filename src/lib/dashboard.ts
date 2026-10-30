import { supabase } from "./supabase";
import { upgradeLime } from "./brand";
import { fetchAll, fetchAllIn } from "./fetchAll";

export interface DashboardClient { id: string; name: string; color: string; status: string; membership: Record<string, any>; birthday: string; joinedAt: string; trial: boolean; source: string; isTraining: boolean }
/** Строка заработка: списание тренировки по цене на момент списания (session_charges) */
export interface DashboardCharge { clientId: string; date: string; amount: number; kind: "workout" | "client" | "no_show" | "refund" }
export interface DashboardPayment { id: string; clientId: string; amount: number; date: string; type: string; note: string; payStatus: 'paid' | 'deferred' | 'installment' }

export async function fetchDashboardData(trainerId: string) {
  const { data: clients, error } = await supabase
    .from("clients").select("id,name,color,status,membership,birthday,joined_at,trial,source,active_session").eq("trainer_id", trainerId).eq("is_self", false).is("deleted_at", null);
  if (error) throw error;
  const clientIds = (clients ?? []).map((c) => c.id);
  // Ошибки не глотаем: главная без оплат из-за оборвавшейся связи попала бы в кэш для зала.
  // Постранично: за год оплат и списаний становится больше 1000 — лимита одного ответа базы.
  const payments = await fetchAllIn<any>(clientIds, (ids, from, to) =>
    supabase.from("client_payments").select("id,client_id,amount,date,type,note,pay_status").in("client_id", ids).order("id").range(from, to));
  const charges = await fetchAll<any>((from, to) =>
    supabase.from("session_charges").select("client_id,date,amount,kind").eq("trainer_id", trainerId).order("id").range(from, to));
  return {
    charges: charges.map((c) => ({ clientId: c.client_id, date: c.date, amount: Number(c.amount) || 0, kind: c.kind } as DashboardCharge)),
    clients: (clients ?? []).map((c) => ({ id: c.id, name: c.name, color: upgradeLime(c.color), status: c.status, membership: c.membership || {}, birthday: c.birthday || "", joinedAt: c.joined_at || "", trial: !!c.trial, source: c.source || "", isTraining: !!(c.active_session && c.active_session.status === "active") } as DashboardClient)),
    payments: payments.map((p) => ({ id: p.id, type: p.type || "", note: p.note || "", clientId: p.client_id, amount: Number(p.amount) || 0, date: p.date, payStatus: (p.pay_status || "paid") as DashboardPayment["payStatus"] } as DashboardPayment)),
  };
}
