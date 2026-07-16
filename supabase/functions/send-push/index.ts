/**
 * Edge Function: send-push
 *
 * Вызывается Database Webhook-ом при UPDATE на таблице clients.
 * Отправляет Web Push тренеру, когда клиент начинает/завершает тренировку.
 *
 * Env secrets (supabase secrets set ...):
 *   VAPID_PUBLIC_KEY   — base64url, публичный VAPID ключ
 *   VAPID_PRIVATE_KEY  — base64url, приватный VAPID ключ
 *   VAPID_SUBJECT      — mailto:you@example.com  (или https://ваш-домен)
 *   SEND_PUSH_SECRET   — произвольная строка, добавляется в заголовок вебхука
 *
 * Автоматически доступны от Supabase:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// ── Env ──────────────────────────────────────────────────────────────────────
const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:trainer@reps.app";
const PUSH_SECRET   = Deno.env.get("SEND_PUSH_SECRET");
const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const db = createClient(SB_URL, SB_KEY);

// ── Webhook payload ───────────────────────────────────────────────────────────
interface ClientRecord {
  id: string;
  trainer_id: string;
  name: string;
  active_session: { status: "active" | "done" | null } | null;
}
interface WebhookBody {
  type: "UPDATE" | "INSERT" | "DELETE";
  table: string;
  record: ClientRecord;
  old_record: ClientRecord;
  schema: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Авторизация: кастомный секрет или Supabase service_role Bearer
  const authorized =
    (PUSH_SECRET && req.headers.get("x-webhook-secret") === PUSH_SECRET) ||
    req.headers.get("authorization") === `Bearer ${SB_KEY}`;

  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: WebhookBody;
  try { body = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400 }); }

  const { record: neo, old_record: old } = body;
  if (!neo || !old) return new Response("Missing record", { status: 400 });

  // Определяем тип события
  const wasActive  = old.active_session?.status === "active";
  const isActive   = neo.active_session?.status === "active";
  const isDone     = neo.active_session?.status === "done";

  let title: string | null = null;
  let body_text: string | null = null;
  let tag: string | null = null;

  if (!wasActive && isActive) {
    // Клиент только что начал тренировку
    title     = "Reps — Тренировка началась";
    body_text = `${neo.name} начал тренировку`;
    tag       = `session-start-${neo.id}`;
  } else if (wasActive && isDone) {
    // Клиент завершил тренировку
    title     = "Reps — Тренировка завершена";
    body_text = `${neo.name} завершил тренировку`;
    tag       = `session-done-${neo.id}`;
  } else {
    // Не интересное событие
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Читаем подписки тренера
  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("endpoint, keys")
    .eq("trainer_id", neo.trainer_id);

  if (error || !subs?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: error?.message ?? "no subscriptions" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Отправляем push на все устройства тренера
  const payload = JSON.stringify({ title, body: body_text, url: "/", tag });

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
        payload,
        { TTL: 3600 }          // храним 1 час если устройство офлайн
      )
    )
  );

  // Удаляем протухшие подписки (410 Gone = браузер отписался)
  const expired = results
    .map((r, i) => ({ r, sub: subs[i] }))
    .filter(({ r }) => r.status === "rejected" && (r.reason as any)?.statusCode === 410)
    .map(({ sub }) => sub.endpoint);

  if (expired.length > 0) {
    await db
      .from("push_subscriptions")
      .delete()
      .in("endpoint", expired)
      .eq("trainer_id", neo.trainer_id);
  }

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - sent;

  console.log(`[send-push] trainer=${neo.trainer_id} sent=${sent} failed=${failed} expired=${expired.length}`);

  return new Response(JSON.stringify({ sent, failed, total: subs.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
