// Очередь отправки: то, что не ушло из-за сети, лежит на телефоне и досылается само —
// при появлении сети, при запуске приложения и раз в минуту, пока очередь не пуста.
// Свой механизм, а не Background Sync сервис-воркера: тот не работает на iPhone.
//
// Каждая операция знает, какие её шаги уже выполнены (state), и сохраняет это после
// каждого шага — повтор после перезапуска не повторяет сделанное.
//
// Аудит 30.10, этап 2:
//  * владелец операции — id из сохранённого на телефоне входа (не из getSession: при истёкшем
//    входе без сети тот пуст, и операция вставала без владельца и не отправлялась никогда);
//    «ничьи» операции прежней версии забирает вошедший, только если роль и данные его
//    (adoptOrphans), остальные значок предлагает удалить;
//  * операция без ответа дольше OP_TIMEOUT не держит досылку остальных (см. busy)
//  * досылает одна вкладка за раз (navigator.locks, запасной вариант — аренда в localStorage),
//    иначе две вкладки отправляли одно и то же дважды. Повтор всё равно безопасен: у тренировок
//    и еды id задаёт телефон, сервер второй раз не пишет.

import { supabase } from "./supabase";
import { track } from "./events";
import { freeCacheSpace } from "./storage";
import { notify } from "./dialog";

export type OutboxKind = "finish" | "clientFinish" | "food" | "foodOp" | "product";
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
  /** Отправляется сейчас (вкладка tab) — до until её не трогают ни другие вкладки, ни правки */
  busy?: { tab: string; until: number };
}
type Handler = (item: OutboxItem, save: (state: any) => void) => Promise<void>;

const KEY = "th-outbox-v1";
const handlers: Partial<Record<OutboxKind, Handler>> = {};
const listeners = new Set<() => void>();
let flushing = false;

const read = (): OutboxItem[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const write = (l: OutboxItem[]) => {
  const raw = JSON.stringify(l);
  try { localStorage.setItem(KEY, raw); } catch (e) {
    // Не влезло — освобождаем место за счёт кэша для зала (он восстановим из сети): очередь важнее
    if (!freeCacheSpace(() => localStorage.setItem(KEY, raw))) console.error("[outbox] запись:", e);
  }
  listeners.forEach((f) => f());
};

/** Ошибка из-за сети (а не из-за данных или прав) — такое имеет смысл повторить позже */
export function isNetworkError(e: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const m = String((e as any)?.message ?? e ?? "");
  // timeout / timed out — запрос оборван по таймауту (lib/supabase): сеть есть, но не отвечает
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|ERR_INTERNET|ERR_NETWORK/i.test(m);
}

export function registerHandler(kind: OutboxKind, h: Handler) { handlers[kind] = h; }

// ── Одна досылка на все вкладки ──
const LOCK = "th-outbox-flush";
const LEASE_KEY = "th-outbox-lease";
const LEASE_MS = 30_000;
const tabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Lease = { tab: string; until: number };
const readLease = (): Lease | null => { try { return JSON.parse(localStorage.getItem(LEASE_KEY) || "null"); } catch { return null; } };
const writeLease = () => { try { localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: tabId, until: Date.now() + LEASE_MS } satisfies Lease)); } catch { /* нет места — без отметки */ } };
const clearLease = () => { try { if (readLease()?.tab === tabId) localStorage.removeItem(LEASE_KEY); } catch { /* ничего */ } };
/** Досылает другая вкладка (по отметке в localStorage; с navigator.locks она тоже ставится) */
const otherTabFlushing = () => { const l = readLease(); return !!l && l.tab !== tabId && l.until > Date.now(); };

/** Выполнить, если досылкой не занята другая вкладка; занята — пропускаем (она дошлёт) */
async function withFlushLock(fn: () => Promise<void>) {
  const run = async () => {
    writeLease();
    const renew = setInterval(writeLease, LEASE_MS / 3);
    try { await fn(); } finally { clearInterval(renew); clearLease(); }
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    // Замок снимается сам, даже если вкладку закрыли посреди отправки
    await locks.request(LOCK, { ifAvailable: true }, async (lock) => { if (lock) await run(); });
    return;
  }
  // Запасной вариант (старые браузеры): аренда с проверкой, что её не перехватили в тот же миг
  if (otherTabFlushing()) return;
  writeLease();
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  if (readLease()?.tab !== tabId) return;
  await run();
}

// Операция, которая не ответила за OP_TIMEOUT, не держит досылку: замок снимается, остальные
// операции могут уйти (в том числе из другой вкладки). Сама она остаётся помеченной busy и
// повторно не отправляется, пока не ответит или не пройдёт BUSY_MS (вкладку закрыли посреди
// запроса): шаги вроде списания по id не защищены, повтор при висящем запросе опасен.
const OP_TIMEOUT = 60_000;
const BUSY_MS = 10 * 60_000;
let inflight = 0;
const isBusy = (i: OutboxItem | undefined) => !!i?.busy && i.busy.until > Date.now();
const setBusy = (id: string, busy: OutboxItem["busy"]) => write(read().map((x) => (x.id === id ? { ...x, busy } : x)));

/** Убрать операцию из очереди (передумали до отправки). false — она как раз отправляется. */
export function removeItem(id: string) {
  if (flushing || otherTabFlushing() || isBusy(read().find((i) => i.id === id))) return false;
  write(read().filter((i) => i.id !== id));
  return true;
}
/** Поправить данные ещё не отправленной операции. false — она как раз отправляется. */
export function updateItem(id: string, payload: unknown) {
  if (flushing || otherTabFlushing() || isBusy(read().find((i) => i.id === id))) return false;
  write(read().map((i) => (i.id === id ? { ...i, payload } : i)));
  return true;
}

/** Выход из аккаунта: его неотправленное с телефона убираем (см. lib/offlineCache signOutAndForget) */
export function removeOwner(owner: string) { write(read().filter((i) => i.owner !== owner)); }

export function subscribeOutbox(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? "";
}

/**
 * Кто вошёл на этом телефоне — по сохранённому входу, без сети и без обновления токена.
 * Истёкший вход тоже считается: операция его, уйдёт, когда вход обновится. "" — входа нет.
 */
export function localUid(): string {
  try {
    const key = (supabase.auth as unknown as { storageKey: string }).storageKey;
    return (JSON.parse(localStorage.getItem(key) || "null") as { user?: { id?: string } } | null)?.user?.id ?? "";
  } catch { return ""; }
}

/**
 * Операция без владельца (прежняя версия ставила так при истёкшем входе) — того ли она, кто вошёл.
 * Только при совпадении роли И данных: тренировка тренера — если trainerId = вошедший;
 * тренировка клиента — если карточка clientId привязана к этому входу; еда — то же или своя
 * карточка тренера (вкладка «Я»). На общем телефоне чужое так не уйдёт от чужого имени.
 */
async function belongsTo(item: OutboxItem, uid: string): Promise<boolean> {
  const p = item.payload as { trainerId?: string; clientId?: string } | null;
  if (item.kind === "finish") return p?.trainerId === uid;
  if (item.kind !== "clientFinish" && item.kind !== "food" && item.kind !== "foodOp") return false;
  if (!p?.clientId) return false;
  const q = supabase.from("clients").select("id").eq("id", p.clientId);
  const { data, error } = await (item.kind === "clientFinish"
    ? q.eq("auth_user_id", uid)
    : q.or(`auth_user_id.eq.${uid},and(is_self.eq.true,trainer_id.eq.${uid})`)).maybeSingle();
  if (error) throw error;
  return !!data;
}
// Уже проверено «не этого входа» — не спрашиваем базу при каждой досылке
const notMine = new Set<string>();
async function adoptOrphans(uid: string) {
  for (const it of read().filter((i) => !i.owner && !notMine.has(`${uid}|${i.id}`))) {
    let mine = false;
    try { mine = await belongsTo(it, uid); }
    catch (e) {
      if (isNetworkError(e)) return;
      // Сбой проверки — не «чужая»: иначе значок предложил бы удалить свою же запись
      console.error("[outbox] чья операция:", e); continue;
    }
    if (mine) write(read().map((x) => (x.id === it.id && !x.owner ? { ...x, owner: uid } : x)));
    else { notMine.add(`${uid}|${it.id}`); notMineIds.add(it.id); }
  }
}
const notMineIds = new Set<string>();

/** Операции без владельца, которые проверка отнесла не к вошедшему (значок предлагает удалить) */
export const orphans = () => read().filter((i) => !i.owner && notMineIds.has(i.id));
export function removeOrphans() { write(read().filter((i) => i.owner || !notMineIds.has(i.id) || isBusy(i))); }

/** Мои операции в очереди (для значка и для показа «ждёт отправки») */
export function pending(owner?: string, kind?: OutboxKind) {
  return read().filter((i) => (!owner || i.owner === owner) && (!kind || i.kind === kind));
}

export async function enqueue<P, S>(kind: OutboxKind, payload: P, state: S): Promise<OutboxItem<P, S>> {
  const item: OutboxItem<P, S> = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind, owner: localUid() || (await currentUser()), createdAt: new Date().toISOString(), payload, state, attempts: 0,
  };
  write([...read(), item]);
  track("action", "offline_queued", { kind });
  return item;
}

/** Досылает свои операции по порядку. Сеть пропала — останавливаемся до следующего раза. */
export async function flushOutbox() {
  if (flushing) return;
  // Отправлять можно только с действующим входом — его и спрашиваем у supabase
  const owner = await currentUser();
  if (!owner) return;
  flushing = true;
  listeners.forEach((f) => f());
  try {
    await adoptOrphans(owner);
    await withFlushLock(async () => {
      for (const { id } of read().filter((i) => i.owner === owner)) {
        // Свежая копия: шаги (state) могла сохранить прошлая досылка в другой вкладке
        const item = read().find((x) => x.id === id);
        if (!item || isBusy(item)) continue; // висит запрос (здесь или в другой вкладке) — не повторяем
        const h = handlers[item.kind];
        if (!h) continue;
        const save = (state: any) => write(read().map((x) => (x.id === item.id ? { ...x, state } : x)));
        setBusy(item.id, { tab: tabId, until: Date.now() + BUSY_MS });
        inflight++;
        const done = h({ ...item, attempts: item.attempts + 1 }, save).then(
          () => {
            write(read().filter((x) => x.id !== item.id)); track("action", "offline_sent", { kind: item.kind });
            // Аудит п. 46: клиент должен знать, что тренировка дошла; экраны перечитывают историю
            if (item.kind === "clientFinish") notify("Тренировка отправлена тренеру", "info");
            window.dispatchEvent(new CustomEvent("outbox:flushed", { detail: { kind: item.kind } }));
            return "ok" as const;
          },
          (e) => {
            if (isNetworkError(e)) { setBusy(item.id, undefined); return "net" as const; }
            console.error("[outbox]", item.kind, e);
            // Сбой не из-за сети — говорим один раз на запись (у неё ещё не было ошибки), а не на каждый повтор
            if (!item.error) notify(`${item.kind === "finish" || item.kind === "clientFinish" ? "Тренировка" : "Запись"} не отправилась. Нажми значок внизу слева, чтобы повторить`, "error");
            write(read().map((x) => (x.id === item.id ? { ...x, busy: undefined, attempts: x.attempts + 1, error: String((e as any)?.message ?? e) } : x)));
            return "err" as const;
          },
        ).finally(() => { inflight--; listeners.forEach((f) => f()); });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const r = await Promise.race([done, new Promise<"slow">((res) => { timer = setTimeout(() => res("slow"), OP_TIMEOUT); })]);
        clearTimeout(timer);
        // Сеть пропала или запрос висит — дальше не идём и отпускаем замок; висящий ответит сам
        if (r === "net" || r === "slow") break;
      }
    });
  } finally { flushing = false; listeners.forEach((f) => f()); }
}

/** Идёт досылка или ещё не ответил запрос из неё (обновление приложения ждёт, см. unsavedGuard) */
export function isFlushing() { return flushing || inflight > 0; }

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
