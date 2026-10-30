import { supabase } from "./supabase";
import { today, addDays } from "./format";
import { fetchEntries } from "./foodDiary";

export interface ClientGoals {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  water?: number;
  steps?: number;
  activeMinutes?: number;
  sessionsPerWeek?: number;
}

export interface DayNutrition {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface DayActivity {
  date: string;
  steps: number;
  activeMinutes: number;
}

export async function fetchClientGoals(clientId: string): Promise<ClientGoals> {
  const { data, error } = await supabase.from("clients").select("goals").eq("id", clientId).single();
  if (error) throw error;
  return (data?.goals as ClientGoals) ?? {};
}

export async function saveClientGoals(clientId: string, goals: ClientGoals): Promise<void> {
  const { error } = await supabase.from("clients").update({ goals }).eq("id", clientId);
  if (error) throw error;
}

// Итог по дням из дневника питания (food_entries); старый итог дня (nutrition_logs) —
// только за дни без записей в дневнике, как в отчётах питания.
// Не загрузился один источник — считаем по другому; не загрузились оба — ошибка.
export async function fetchNutritionByDay(clientId: string, from: string, to: string): Promise<DayNutrition[]> {
  const [entries, { data: legacy, error: legacyError }] = await Promise.all([
    fetchEntries(clientId, from, to).catch((e) => { console.error("[goals] food_entries:", e); return null; }),
    supabase.from("nutrition_logs").select("date,calories,protein,carbs,fat")
      .eq("client_id", clientId).gte("date", from).lte("date", to),
  ]);
  if (legacyError) console.error("[goals] nutrition_logs:", legacyError);
  if (!entries && legacyError) throw legacyError;
  const map: Record<string, DayNutrition> = {};
  const add = (date: string, kcal: unknown, protein: unknown, carbs: unknown, fat: unknown) => {
    if (!map[date]) map[date] = { date, calories: 0, protein: 0, carbs: 0, fat: 0 };
    map[date].calories += Number(kcal ?? 0);
    map[date].protein += Number(protein ?? 0);
    map[date].carbs += Number(carbs ?? 0);
    map[date].fat += Number(fat ?? 0);
  };
  for (const e of entries ?? []) add(e.date, e.kcal, e.protein, e.carbs, e.fat);
  const fromDiary = new Set(Object.keys(map));
  for (const r of legacy ?? []) if (!fromDiary.has(r.date)) add(r.date, r.calories, r.protein, r.carbs, r.fat);
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchActivityByDay(clientId: string, from: string, to: string): Promise<DayActivity[]> {
  const { data } = await supabase
    .from("client_activities")
    .select("date,type,value")
    .eq("client_id", clientId)
    .gte("date", from)
    .lte("date", to)
    .in("type", ["steps", "active_minutes"]);
  const map: Record<string, DayActivity> = {};
  for (const r of data ?? []) {
    if (!map[r.date]) map[r.date] = { date: r.date, steps: 0, activeMinutes: 0 };
    const v = Number(r.value ?? 0);
    if (r.type === "steps") map[r.date].steps += v;
    if (r.type === "active_minutes") map[r.date].activeMinutes += v;
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchSessionsInPeriod(clientId: string, from: string, to: string): Promise<number> {
  const { data: plans } = await supabase.from("plans").select("id").eq("client_id", clientId);
  if (!plans?.length) return 0;
  const { count } = await supabase
    .from("plan_sessions")
    .select("id", { count: "exact", head: true })
    .in("plan_id", plans.map((p) => p.id))
    .gte("date", from)
    .lte("date", to)
    .is("deleted_at", null);
  return count ?? 0;
}

// Generates all YYYY-MM-DD dates from `from` to `to` inclusive
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = from;
  while (cur <= to) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

export function periodRange(days: number): { from: string; to: string } {
  const to = today();
  const from = addDays(to, -(days - 1));
  return { from, to };
}
