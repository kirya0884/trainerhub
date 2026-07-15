/**
 * Web Push: подписка / отписка тренера на push-уведомления.
 *
 * Публичный VAPID-ключ — в .env как VITE_VAPID_PUBLIC_KEY.
 * Приватный ключ — только в Supabase Edge Function secrets (VAPID_PRIVATE_KEY).
 *
 * Поток:
 *  1. subscribeToPush(trainerId)  → запрашивает разрешение, создаёт PushSubscription
 *  2. Сохраняет endpoint + keys в таблицу push_subscriptions
 *  3. Edge Function /send-push читает подписку и отправляет через web-push (VAPID)
 */
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/** Конвертируем base64url → Uint8Array для applicationServerKey */
function urlB64ToUint8(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr as unknown as Uint8Array<ArrayBuffer>;
}

/** Проверяем доступность Push API */
export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Текущий статус разрешения */
export function getPushPermission(): NotificationPermission {
  return "Notification" in window ? Notification.permission : "denied";
}

/**
 * Подписать тренера на Web Push.
 * Возвращает true при успехе, false если отказано или не поддерживается.
 */
export async function subscribeToPush(trainerId: string): Promise<boolean> {
  if (!isPushSupported()) return false;
  if (!VAPID_PUBLIC_KEY) {
    console.error("[Push] VITE_VAPID_PUBLIC_KEY не задан в .env");
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    // Повторно используем существующую подписку, если уже есть
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY),
      }));

    const json = sub.toJSON() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    const { error } = await supabase.from("push_subscriptions").upsert(
      { trainer_id: trainerId, endpoint: json.endpoint, keys: json.keys },
      { onConflict: "trainer_id,endpoint" }
    );
    if (error) throw error;

    return true;
  } catch (e) {
    console.error("[Push] Ошибка подписки:", e);
    return false;
  }
}

/**
 * Отписать тренера от Web Push (браузер + Supabase).
 */
export async function unsubscribeFromPush(trainerId: string): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const { endpoint } = sub.toJSON() as { endpoint: string };
    await sub.unsubscribe();
    await supabase
      .from("push_subscriptions")
      .delete()
      .match({ trainer_id: trainerId, endpoint });
  } catch (e) {
    console.error("[Push] Ошибка отписки:", e);
  }
}

/**
 * Проверить, активна ли push-подписка в текущем браузере.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub !== null;
}
