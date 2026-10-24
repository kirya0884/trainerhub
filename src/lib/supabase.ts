// Первым — раньше supabase-js: при забитом хранилище освобождает место (см. lib/storage.ts)
import "./storage";
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — проверь .env");

// Сеть «есть», но не отвечает (зал, лифт): без таймаута запрос висит бесконечно, и приложение
// ждёт его вечно. Ждём ответа 8 с, потом ошибка, которую lib/outbox считает сетевой, — экраны
// берут сохранённое. Таймаут — до начала ответа: большой ответ не обрывается.
// Только чтение (GET/HEAD) и вход (/auth/v1/). Запись (POST/PATCH/PUT/DELETE, RPC) — без таймаута:
// она могла дойти до базы, а ответ опоздать — «Не удалось» и повтор дали бы дубль.
// Файлы и функции не ограничиваем, свой сигнал вызывающего не подменяем.
const TIMEOUT = 8000;
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (init?.signal || /\/(storage|functions)\/v1\//.test(href)) return fetch(input, init);
  // Телефон без сети — сразу ошибка: иначе postgrest трижды повторяет запрос (1 + 2 + 4 с).
  // Запрос не ушёл вовсе, так что и для записи это безопасно.
  if (!navigator.onLine) return Promise.reject(new DOMException("Failed to fetch (offline)", "AbortError"));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !href.includes("/auth/v1/")) return fetch(input, init);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  return fetch(input, { ...init, signal: ctrl.signal })
    .catch((e) => {
      // Именно AbortError: такую ошибку postgrest не повторяет трижды (иначе вышло бы полминуты)
      if (ctrl.signal.aborted) throw new DOMException("Network request timed out", "AbortError");
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

export const supabase = createClient(url, anonKey, { global: { fetch: fetchWithTimeout } });
