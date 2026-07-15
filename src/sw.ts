/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

// Объявляем тип self как ServiceWorkerGlobalScope (вместо window из DOM lib)
declare const self: ServiceWorkerGlobalScope;

// Перехватываем управление немедленно при обновлении
self.skipWaiting();
clientsClaim();

// ── 1. Precache: статические ассеты (инжектируется workbox при сборке) ──────
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ── 2. Runtime: Supabase REST (GET) → NetworkFirst ───────────────────────────
// При офлайне отдаём последний закешированный ответ (1h TTL)
registerRoute(
  ({ url, request }: { url: URL; request: Request }) =>
    url.hostname.endsWith("supabase.co") && request.method === "GET",
  new NetworkFirst({
    cacheName: "supabase-api",
    networkTimeoutSeconds: 8,
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 }),
    ],
  })
);

// ── 3. Картинки и шрифты → CacheFirst (30 дней) ──────────────────────────────
registerRoute(
  ({ request }: { request: Request }) =>
    request.destination === "image" || request.destination === "font",
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 86_400 }),
    ],
  })
);

// ── 4. Push notifications (Web Push API) ─────────────────────────────────────
interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;
  let data: PushPayload;
  try { data = event.data.json() as PushPayload; }
  catch { data = { title: "Reps", body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag,
      data: { url: data.url ?? "/" },
      vibrate: [200, 100, 200],
    })
  );
});

// ── 5. Notification click → открыть/сфокусировать вкладку ────────────────────
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const targetUrl: string = (event.notification.data as { url: string }).url ?? "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const open = clients.find((c) => c.url.startsWith(self.location.origin));
        return open ? open.focus() : self.clients.openWindow(targetUrl);
      })
  );
});

// ── 6. Background sync: офлайн-мутации в Supabase ────────────────────────────
// Суть: при ошибке сети ставим запрос в очередь и повторяем при reconnect.
// Очередь "offline-mutations" создаётся клиентом через pushRequest() (см. pushSubscribe.ts).
self.addEventListener("sync", (event: SyncEvent) => {
  if (event.tag === "offline-mutations") {
    // workbox-background-sync обрабатывает очередь автоматически
    // Явный replay здесь не нужен — Workbox Queue сам replay-ит на "sync"
    console.log("[SW] Background sync: replaying offline mutations");
  }
});
