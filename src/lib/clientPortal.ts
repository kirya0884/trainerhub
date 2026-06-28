import { supabase } from "./supabase";
import { expandBookings } from "./bookings";
import type { Booking } from "./bookings";
import type { Metric, Session } from "../types";
import { today, addDays } from "./format";

export interface SelfClient {
  id: string; trainerId: string; name: string; color: string; goal: string;
  phone: string; telegram: string; whatsapp: string; avatarUrl: string; accentColor: string;
  membership: Record<string, any>;
  activeSession: { planId: string; dayId: string; dayName: string; startedAt: number } | null;
}

export async function fetchSelfClient(authUserId: string): Promise<SelfClient | null> {
  const { data, error } = await supabase
    .from("clients").select("id,trainer_id,name,color,goal,phone,telegram,whatsapp,avatar_url,accent_color,membership,active_session")
    .eq("auth_user_id", authUserId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id, trainerId: data.trainer_id, name: data.name, color: data.color, goal: data.goal ?? "",
    phone: data.phone ?? "", telegram: data.telegram ?? "", whatsapp: data.whatsapp ?? "", avatarUrl: data.avatar_url ?? "",
    accentColor: data.accent_color || "#22d3ee",
    membership: data.membership || {}, activeSession: data.active_session || null,
  };
}

// Клиент правит только свои контакты/фото/цвет — через RPC (см. update_client_self_profile), не общий update.
export async function updateSelfProfile(clientId: string, p: { phone: string; telegram: string; whatsapp: string; avatarUrl: string; accentColor?: string }) {
  const { error } = await supabase.rpc("update_client_self_profile", { p_client_id: clientId, p_phone: p.phone, p_telegram: p.telegram, p_whatsapp: p.whatsapp, p_avatar_url: p.avatarUrl, p_accent_color: p.accentColor ?? null });
  if (error) throw error;
}

export async function fetchTrainerBrand(trainerId: string) {
  const { data } = await supabase.from("trainers").select("brand,logo_url").eq("id", trainerId).maybeSingle();
  return { brand: data?.brand || "TrainerHub", logoUrl: data?.logo_url || "" };
}

export interface UpcomingBooking { date: string; time: string; duration: number }

// Клиент может читать только bookings, в которых он участвует (см. миграцию 0003) — раскрываем повторы на лету и берём ближайшее занятие
export async function fetchUpcomingBooking(clientId: string): Promise<UpcomingBooking | null> {
  const { data: links } = await supabase.from("booking_clients").select("booking_id").eq("client_id", clientId);
  const ids = (links ?? []).map((l) => l.booking_id);
  if (!ids.length) return null;
  const { data } = await supabase.from("bookings").select("*").in("id", ids);
  const bookings: Booking[] = (data ?? []).map((b: any) => ({
    id: b.id, planId: b.plan_id, date: b.date, time: b.time ?? "", duration: b.duration ?? 60,
    status: b.status ?? "scheduled", note: b.note ?? "", recurring: !!b.recurring, recurUntil: b.recur_until,
    exceptions: b.exceptions ?? {}, clientIds: [clientId],
  }));
  const todayStr = today();
  const occs = expandBookings(bookings, todayStr, addDays(todayStr, 60)).filter((o) => o.status !== "cancelled");
  occs.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const next = occs[0];
  return next ? { date: next.date, time: next.time, duration: next.duration } : null;
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
      session.items.map((i) => ({ session_id: sessRow.id, name: i.name, effort: i.effort, rpe: i.rpe || 0, note: i.note }))
    );
    if (itemsErr) throw itemsErr;
  }
}
