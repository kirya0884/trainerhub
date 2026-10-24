import { supabase } from "./supabase";
import { isNetworkError } from "./outbox";

// B16: событийная аналитика. Таблица app_events append-only на уровне RLS —
// политик на UPDATE и DELETE нет вовсе, поэтому база их отклонит.
//
// ВАЖНО: в meta кладём только идентификаторы и признаки. Никаких имён, телефонов
// и сумм — связка «тренер открыл клиента» и так персональные данные, дублировать
// содержимое карточек в журнал событий не нужно.
//
// Кто сейчас работает (тренер или клиент) задаёт setAnalyticsContext — App для тренера,
// кабинет для клиента; track() пишет событие от его имени. Каждое событие несёт сеанс
// (перерыв больше 30 минут — новый) и устройство — для метрик админ-панели.
export type AppEvent = "view" | "open_client" | "create" | "search" | "action" | "session";

type Ctx = { actor: "trainer"; trainerId: string } | { actor: "client"; trainerId: string; clientId: string };
let ctx: Ctx | null = null;

const SESSION_KEY = "th-analytics-session";
const IDLE_MS = 30 * 60 * 1000;
function sessionId() {
  const now = Date.now();
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null") as { id: string; at: number } | null;
    const id = s && now - s.at < IDLE_MS ? s.id : `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: now }));
    return id;
  } catch { return "na"; }
}
/** ios / android / desktop; «-pwa» — открыто как установленное приложение */
export function deviceKind() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "ios" : /Android/i.test(ua) ? "android" : "desktop";
  const pwa = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return pwa ? `${os}-pwa` : os;
}

// Логирование не имеет права ломать интерфейс, поэтому ошибки только в консоль
function insert(row: Record<string, unknown>) {
  supabase.from("app_events")
    .insert({ ...row, session_id: sessionId(), device: deviceKind() })
    // Без сети событие просто теряется — это не ошибка, консоль не засоряем
    .then(({ error }) => { if (error && !isNetworkError(error)) console.error("[analytics]", error.message); });
}

/** Кто работает в приложении; при смене — событие начала сеанса */
export function setAnalyticsContext(next: Ctx | null) {
  const same = !!ctx && !!next && ctx.actor === next.actor && ctx.trainerId === next.trainerId
    && (ctx.actor !== "client" || (next.actor === "client" && ctx.clientId === next.clientId));
  ctx = next;
  if (next && !same) track("session", "start", { w: window.innerWidth });
}

/** Событие от имени текущего пользователя (тренер или клиент) */
export function track(event: AppEvent, target?: string, meta?: Record<string, string | number | boolean>) {
  if (!ctx) return;
  insert({
    trainer_id: ctx.trainerId, actor: ctx.actor, client_id: ctx.actor === "client" ? ctx.clientId : null,
    event, target: target ?? null, meta: meta ?? {},
  });
}

// ponytail: fire-and-forget без очереди и батчинга. Событий у одного тренера
// десятки в день, отдельный insert дешевле любой машинерии.
export function logEvent(trainerId: string, event: AppEvent, target?: string, meta?: Record<string, string | number | boolean>) {
  if (!trainerId) return;
  insert({ trainer_id: trainerId, actor: "trainer", event, target: target ?? null, meta: meta ?? {} });
}
