import { supabase } from "./supabase";

// Обёртки над функциями admin_* (база проверяет, что вызывающий — админ)
export type Grain = "day" | "week" | "month";
export type Range = { from: string; to: string; grain: Grain; ex: boolean; tz: string };
export type Kpis = Record<string, number>;
export type SeriesRow = {
  bucket: string; active_trainers: number; active_clients: number; new_trainers: number; new_clients: number;
  workouts_trainer: number; workouts_client: number; workouts_self: number; food: number; payments: number; gmv: number;
  bookings_done: number; no_shows: number; events: number; messages: number;
};
export type ActiveRow = { d: string; actor: "trainer" | "client"; dau: number; wau: number; mau: number };
export type RetentionRow = { cohort: string; size: number; k: number; active: number };
export type TrainerRow = {
  id: string; name: string; email: string; signed_up: string; last_active: string | null; active_days: number; events: number;
  clients: number; portal_clients: number; active_clients: number; workouts: number; client_workouts: number; gmv: number; tier: string;
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
const base = (r: Range) => ({ p_from: r.from, p_to: r.to, p_tz: r.tz, p_ex: r.ex });

export const isAdmin = () => rpc<boolean>("is_admin", {});
/** В списке админов — без учёта второго шага входа (is_admin и admin_* требуют aal2) */
export const isAdminMember = () => rpc<boolean>("is_admin_member", {});

/** Доступ к панели (п. 57): none — не админ, mfa — нужен код из приложения-аутентификатора, ok — открываем */
export async function adminAccess(): Promise<"none" | "mfa" | "ok"> {
  if (!(await isAdminMember())) return "none";
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data.currentLevel !== "aal2") return "mfa";
  return (await isAdmin()) ? "ok" : "none";
}
export const kpis = (r: Range) => rpc<{ cur: Kpis; prev: Kpis }>("admin_kpis", base(r));
export const series = (r: Range) => rpc<SeriesRow[]>("admin_series", { ...base(r), p_grain: r.grain });
export const active = (r: Range) => rpc<ActiveRow[]>("admin_active", base(r));
export const retention = (r: Range, actor: "trainer" | "client", grain: "week" | "month", periods: number) =>
  rpc<RetentionRow[]>("admin_retention", { p_actor: actor, p_grain: grain, p_periods: periods, p_tz: r.tz, p_ex: r.ex });
export const funnel = (r: Range) => rpc<{ step: string; n: number }[]>("admin_funnel", base(r));
export const features = (r: Range) => rpc<{ active: number; features: { feature: string; trainers: number; share: number }[] }>("admin_features", base(r));
export const events = (r: Range) => rpc<{
  events: { actor: string; event: string; target: string | null; n: number; users: number }[];
  devices: { device: string; actor: string; n: number }[];
  heatmap: { dow: number; h: number; n: number }[];
}>("admin_events", base(r));
export const sessions = (r: Range) => rpc<{ actor: string; sessions: number; users: number; avg_min: number; median_min: number; events_per_session: number }[]>("admin_sessions", base(r));
export const business = (r: Range) => rpc<{
  tiers: { tier: string; price: number; trainers: number; mrr: number }[]; potential_mrr: number; clients_per_trainer: number;
  by_type: { type: string; n: number; amount: number }[]; by_status: { status: string; n: number; amount: number }[];
  avg_check: number | null; top_trainers: { id: string; name: string; gmv: number; n: number }[];
}>("admin_business", base(r));
export const trainers = (r: Range) => rpc<TrainerRow[]>("admin_trainers", base(r));
export const trainer = (id: string, r: Range) => rpc<{
  daily: { d: string; trainer_events: number; client_actions: number; workouts: number }[];
  recent: { ts: string; actor: string; kind: string; device: string | null }[];
  kinds: { kind: string; n: number }[];
}>("admin_trainer", { p_id: id, p_from: r.from, p_to: r.to, p_tz: r.tz });
