// Очередь отправки: то, что не ушло из-за сети, лежит на телефоне и досылается само —
// при появлении сети, при запуске приложения и раз в минуту, пока очередь не пуста.
// Свой механизм, а не Background Sync сервис-воркера: тот не работает на iPhone.
//
// Каждая операция знает, какие её шаги уже выполнены (state), и сохраняет это после
// каждого шага — повтор после перезапуска не повторяет сделанное.

import { supabase } from "./supabase";

export type OutboxKind = "finish" | "food" | "product";
export interface OutboxItem<P = any, S = any> {
  id: string;
  kind: OutboxKind;
  /** Чья операция — у телефона может быть несколько аккаунтов */
  owner: string;
  createdAt: string;
  payload: P;
  state: S;
  /** Последняя ошибка не из-за сети — показываем, но не выбрасываем данные */
  error?: string;
  attempts: number;
}
type Handler = (item: OutboxItem, save: (state: any) => void) => Promise<void>;

const KEY = "th-outbox-v1";
const handlers: Partial<Record<OutboxKind, Handler>> = {};
const listeners = new Set<() => void>();
let flushing = false;

const read = (): OutboxItem[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const write = (l: OutboxItem[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) { console.error("[outbox] запись:", e); }
  listeners.forEach((f) => f());
};

/** Ошибка из-за сети (а не из-за данных или прав) — такое имеет смысл повторить позже */
export function isNetworkError(e: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = String((e as any)?.message ?? e ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|ERR_INTERNET|ERR_NETWORK/i.test(m);
}

export function registerHandler(kind: OutboxKind, h: Handler) { handlers[kind] = h; }

export function subscribeOutbox(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? "";
}

/** Мои операции в очереди (для значка и для показа «ждёт отправки») */
export function pending(owner?: string, kind?: OutboxKind) {
  return read().filter((i) => (!owner || i.owner === owner) && (!kind || i.kind === kind));
}

export async function enqueue<P, S>(kind: OutboxKind, payload: P, state: S): Promise<OutboxItem<P, S>> {
  const item: OutboxItem<P, S> = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind, owner: await currentUser(), createdAt: new Date().toISOString(), payload, state, attempts: 0,
  };
  write([...read(), item]);
  return item;
}

/** Досылает свои операции по порядку. Сеть пропала — останавливаемся до следующего раза. */
export async function flushOutbox() {
  if (flushing) return;
  const owner = await currentUser();
  if (!owner) return;
  flushing = true;
  listeners.forEach((f) => f());
  try {
    for (const item of read().filter((i) => i.owner === owner)) {
      const h = handlers[item.kind];
      if (!h) continue;
      const save = (state: any) => write(read().map((x) => (x.id === item.id ? { ...x, state } : x)));
      try {
        await h({ ...item, attempts: item.attempts + 1 }, save);
        write(read().filter((x) => x.id !== item.id));
      } catch (e) {
        if (isNetworkError(e)) break;
        console.error("[outbox]", item.kind, e);
        write(read().map((x) => (x.id === item.id ? { ...x, attempts: x.attempts + 1, error: String((e as any)?.message ?? e) } : x)));
      }
    }
  } finally { flushing = false; listeners.forEach((f) => f()); }
}

export function isFlushing() { return flushing; }

/** Запуск досылки: сразу, при появлении сети и раз в минуту */
let started = false;
export function startOutbox() {
  if (started) return;
  started = true;
  const kick = () => { if (read().length) flushOutbox().catch((e) => console.error("[outbox] flush:", e)); };
  window.addEventListener("online", kick);
  setInterval(kick, 60000);
  setTimeout(kick, 1500);
}
