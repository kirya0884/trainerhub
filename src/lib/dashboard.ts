import { supabase } from "./supabase";

export interface DashboardClient { id: string; name: string; color: string; status: string; membership: Record<string, any>; birthday: string; joinedAt: string; trial: boolean; source: string }
export interface DashboardPayment { clientId: string; amount: number; date: string; payStatus: 'paid' | 'deferred' | 'installment' }

export async function fetchDashboardData(trainerId: string) {
  const { data: clients, error } = await supabase
    .from("clients").select("id,name,color,status,membership,birthday,joined_at,trial,source").eq("trainer_id", trainerId).is("deleted_at", null);
  if (error) throw error;
  const clientIds = (clients ?? []).map((c) => c.id);
  const { data: payments } = clientIds.length
    ? await supabase.from("client_payments").select("client_id,amount,date,pay_status").in("client_id", clientIds)
    : { data: [] as any[] };
  return {
    clients: (clients ?? []).map((c) => ({ id: c.id, name: c.name, color: c.color, status: c.status, membership: c.membership || {}, birthday: c.birthday || "", joinedAt: c.joined_at || "", trial: !!c.trial, source: c.source || "" } as DashboardClient)),
    payments: (payments ?? []).map((p) => ({ clientId: p.client_id, amount: Number(p.amount) || 0, date: p.date, payStatus: (p.pay_status || "paid") as DashboardPayment["payStatus"] } as DashboardPayment)),
  };
}
