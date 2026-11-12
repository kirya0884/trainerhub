import { supabase } from "./supabase";

// Этап 13: свой ID и действующая подписка тренера (функция my_subscription в базе).
// Последний ответ помним по пользователю — без сети профиль всё равно покажет ID и тариф.
export type Tier = "start" | "basic" | "pro" | "studio";
export type MySub = { public_id: string; tier: Tier; source?: string; starts_at?: string; ends_at?: string | null };

export const TIER_NAMES: Record<Tier, string> = { start: "Старт", basic: "Базовый", pro: "Профи", studio: "Студия" };
const key = (uid: string) => `th-my-sub:${uid}`;

export function lastMySub(uid: string): MySub | null {
  try { return JSON.parse(localStorage.getItem(key(uid)) || "null"); } catch { return null; }
}

export async function fetchMySub(uid: string): Promise<MySub | null> {
  const { data, error } = await supabase.rpc("my_subscription");
  if (error || !data) return lastMySub(uid);
  try { localStorage.setItem(key(uid), JSON.stringify(data)); } catch { /* приватный режим */ }
  return data as MySub;
}

/** «Профи до 12.02.2027», «Студия бессрочно», «Старт» */
export function subLabel(s: Pick<MySub, "tier" | "ends_at">): string {
  if (s.tier === "start") return TIER_NAMES.start;
  return `${TIER_NAMES[s.tier]} ${s.ends_at ? `до ${new Date(s.ends_at + "T00:00:00").toLocaleDateString("ru-RU")}` : "бессрочно"}`;
}
