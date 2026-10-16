import { supabase } from "./supabase";
import { LEGAL_VERSION } from "../legal/docs";

// Журнал согласий (таблица user_consents). Требуемый набор зависит от роли;
// при смене LEGAL_VERSION набор считается неполным — пользователь подтверждает заново.
export type ConsentKind = "terms" | "consent" | "consent_client" | "health" | "guardian";
export type Role = "trainer" | "client";
export const REQUIRED: Record<Role, ConsentKind[]> = {
  trainer: ["terms", "consent"],
  client: ["terms", "consent_client", "health"],
};

/** Галочка при регистрации: запись в базу возможна только после входа — запоминаем до него */
const PENDING_KEY = "reps-consent-pending";
export const markSignupConsent = () => { try { localStorage.setItem(PENDING_KEY, LEGAL_VERSION); } catch { /* приватный режим */ } };

export async function recordConsents(kinds: ConsentKind[], meta: Record<string, unknown> = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Нет входа");
  const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "";
  const { error } = await supabase.from("user_consents").insert(
    kinds.map((kind) => ({ user_id: user.id, kind, version: LEGAL_VERSION, meta: { ...meta, ua } })),
  );
  if (error) throw error;
}

/**
 * Нужно ли показать экран согласия. Сеть недоступна — не блокируем вход:
 * в зале без связи приложение должно открываться, спросим при следующем запуске.
 */
export async function needsConsent(userId: string, role: Role): Promise<boolean> {
  const { data, error } = await supabase.from("user_consents").select("kind").eq("user_id", userId).eq("version", LEGAL_VERSION);
  if (error) { console.warn("[consents]", error.message); return false; }
  const have = new Set((data ?? []).map((r) => r.kind));
  const missing = REQUIRED[role].filter((k) => !have.has(k));
  if (!missing.length) return false;
  // Тренер только что зарегистрировался с галочкой на этом устройстве — записываем её
  let pending: string | null = null;
  try { pending = localStorage.getItem(PENDING_KEY); } catch { /* приватный режим */ }
  if (role === "trainer" && pending === LEGAL_VERSION) {
    try { await recordConsents(missing, { source: "signup" }); localStorage.removeItem(PENDING_KEY); return false; }
    catch (e) { console.warn("[consents] signup:", e); }
  }
  return true;
}
