// Последние загруженные данные на телефоне — чтобы в зале без связи приложение
// открывалось и показывало подопечных, планы и записи.
//
// Всё лежит под id вошедшего пользователя. При выходе или входе другим аккаунтом
// чужие записи удаляются (setCacheOwner), поэтому данные прежнего пользователя
// показать невозможно.
//
// Сеть главнее: из кэша берём, только когда запрос упал из-за сети или телефон сам
// сообщает, что сети нет. Тогда же появляется плашка «Нет сети · данные на …».
//
// Пока что-то на экране из кэша, экраны перечитывают своё (onRevalidate): при возврате сети,
// раз в 90 с (только пока приложение на экране) и при возврате в приложение — «сеть есть, но висела»
// тоже проходит сама. Чаще не надо: во время сбоя базы (28.10) частые перечитывания её добивали.
//
// Кэш — самое неважное в хранилище: общий объём ограничен (BUDGET), а если места не
// хватает очереди отправки или черновику тренировки, кэш удаляется целиком (lib/storage).
// При выходе и смене пользователя удаляется и кэш ответов базы в service worker (sw.ts).
import { supabase } from "./supabase";
import { CACHE_PREFIX, readJson, removeKey, writeJson } from "./storage";
import { flushOutbox, isNetworkError, pending, removeOwner } from "./outbox";
import { ask, notify } from "./dialog";
import { unsubscribeFromPush } from "./pushSubscribe";

/** Общий объём кэша в символах (~1,4 МБ хранилища), старое вытесняется */
const BUDGET = 700_000;
/** Сколько отдельных планов, историй и карточек держим (по последнему обновлению) */
const MAX_ITEMS = 40;
/** Без сети supabase долго пытается обновить истёкший вход — столько ждём, потом берём сохранённое */
const SESSION_WAIT = 3000;
/** Как часто перечитывать, пока что-то из кэша; через сколько снять отметки ушедших экранов */
const RECHECK = 90_000;
const SWEEP = 15_000;
/** Кэш ответов базы в service worker (sw.ts) */
const SW_API_CACHE = "supabase-api";

type Entry<T> = { at: number; data: T };
type Index = Record<string, { at: number; size: number }>;
let owner: string | null = null;
// Что сейчас показано из кэша: имя → время сохранения данных (at) и когда отмечено (markedAt).
// Плашка берёт самое старое.
const stale = new Map<string, { at: number; markedAt: number }>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

const indexKey = (o: string) => `${CACHE_PREFIX}${o}`;
const itemKey = (o: string, name: string) => `${CACHE_PREFIX}${o}:${name}`;

/** Кто вошёл ("" — никто). Всё, что сохранено не для него, удаляется. */
export function setCacheOwner(id: string) {
  if (id === owner) return;
  // Другой пользователь (или выход) — ответы базы прежнего в service worker тоже не держим
  if (owner && typeof caches !== "undefined") caches.delete(SW_API_CACHE).catch(() => {});
  owner = id;
  stale.clear();
  try {
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX) && k.slice(CACHE_PREFIX.length).split(":")[0] !== id) drop.push(k);
    }
    drop.forEach((k) => removeKey(k));
  } catch (e) { console.error("[offlineCache] уборка:", e); }
  emit();
}

const activeKey = (uid: string) => `th-active-workout-v2-${uid}`;

/** Всё этого пользователя на телефоне: кэш, его очередь отправки, идущая тренировка, черновики,
 *  кэш дневника питания (lib/foodDiary) и данные калькулятора КБЖУ — вес/рост/возраст (NutritionGoalsSheet) */
function forgetUser(uid: string) {
  setCacheOwner("");
  if (!uid) return;
  removeOwner(uid);
  try {
    const drop = [activeKey(uid)];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && /^th-(tsess-|gslot-|food-cache:|nutri-calc-)/.test(k)) drop.push(k); }
    drop.forEach((k) => removeKey(k));
  } catch (e) { console.error("[offlineCache] черновики:", e); }
}

/**
 * Выход. Неотправленное (очередь, идущая тренировка) — личные данные этого аккаунта: на телефоне,
 * которым может пользоваться другой человек, их не оставляем. Поэтому сначала пробуем дослать,
 * а если не вышло — спрашиваем: выйти и удалить или остаться и дождаться сети.
 * Без сети supabase сессию не удаляет (выход идёт через сервер) — тогда удаляем вход на телефоне сами.
 */
export async function signOutAndForget(opts?: { scope?: "global" | "local" | "others" }) {
  const uid = owner || (await supabase.auth.getSession().catch(() => null))?.data.session?.user.id || "";
  if (uid && navigator.onLine && pending(uid).length) await flushOutbox().catch(() => {});
  const left = uid ? pending(uid).length : 0;
  const active = !!uid && localStorage.getItem(activeKey(uid)) !== null;
  if ((left || active) && !(await ask(
    `${left ? `Не отправлено: ${left} (тренировки или питание).` : "Идёт тренировка."} При выходе это удалится с телефона и в базу не попадёт.${navigator.onLine ? "" : " Можно остаться и выйти, когда появится интернет, — тогда всё отправится."} Выйти и удалить?`,
    { danger: true, ok: "Выйти и удалить" },
  ))) return;
  // Push-подписку снимаем до выхода: строку в push_subscriptions удалить может только эта сессия
  if (uid) await unsubscribeFromPush(uid);
  forgetUser(uid);
  const { error } = navigator.onLine ? await supabase.auth.signOut(opts) : { error: new Error("Failed to fetch (offline)") };
  if (!error) return;
  if (!isNetworkError(error)) { console.error("[signOut]", error); notify("Не удалось выйти. Попробуйте ещё раз."); return; }
  // Без сети: убираем вход на телефоне. _removeSession — внутренний метод supabase-js, он же
  // сообщает приложению о выходе (SIGNED_OUT); если его нет — стираем сессию и перезапускаемся.
  const auth = supabase.auth as unknown as { _removeSession?: () => Promise<void>; storageKey: string };
  if (typeof auth._removeSession === "function") await auth._removeSession();
  else { removeKey(auth.storageKey); location.reload(); }
  if (opts?.scope === "global") notify("Без интернета вы вышли только на этом телефоне. Чтобы выйти на всех устройствах, войдите и повторите, когда появится сеть.");
}

export function peekCache<T>(name: string): Entry<T> | null {
  return owner ? readJson<Entry<T> | null>(itemKey(owner, name), null) : null;
}

/** «14:05» сегодня, «23 окт. 14:05» — в другой день */
export function fmtSavedAt(at: number) {
  const d = new Date(at), time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} ${time}`;
}

/** Время самых старых данных, показанных из кэша; null — всё на экране свежее */
export const getStaleAt = () => (stale.size ? Math.min(...[...stale.values()].map((m) => m.at)) : null);
/** Время сохранения, если последняя загрузка этого имени пришла из кэша */
export const staleAtOf = (name: string) => stale.get(name)?.at ?? null;
export function subscribeStale(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
const markStale = (name: string, at: number) => { stale.set(name, { at, markedAt: Date.now() }); emit(); };
const markFresh = (name: string) => { if (stale.delete(name)) emit(); };
/** Экран ушёл — его данные больше не на экране, отметку снимаем */
export const releaseStale = markFresh;

const revalidators = new Set<() => void>();
/** Перечитать своё: вернулась сеть, раз в RECHECK, пока что-то из кэша, при возврате в приложение, «Обновить» */
export function onRevalidate(f: () => void) { revalidators.add(f); return () => { revalidators.delete(f); }; }
export function revalidate() {
  const tick = Date.now();
  revalidators.forEach((f) => f());
  // Отметка, которую никто не перечитал (экран ушёл), снимается; не вышло перечитать — она уже новая
  setTimeout(() => {
    let changed = false;
    for (const [n, m] of stale) if (m.markedAt < tick) { stale.delete(n); changed = true; }
    if (changed) emit();
  }, SWEEP);
}
if (typeof window !== "undefined") {
  let lastKick = 0;
  const kick = () => {
    if (!stale.size || !navigator.onLine || document.visibilityState !== "visible" || Date.now() - lastKick < 5000) return;
    lastKick = Date.now();
    revalidate();
  };
  // Приложение в фоне — не перечитываем; вернётся на экран — перечитает по visibilitychange
  window.addEventListener("online", () => { if (document.visibilityState !== "visible") return; lastKick = Date.now(); revalidate(); });
  window.addEventListener("focus", kick);
  document.addEventListener("visibilitychange", kick);
  setInterval(kick, RECHECK);
}

function put(o: string, name: string, data: unknown) {
  const entry = { at: Date.now(), data };
  const size = JSON.stringify(entry).length;
  // Индекс перечитываем прямо перед записью — его могла поменять другая вкладка
  const idx = readJson<Index>(indexKey(o), {});
  const evict = (n: string) => { removeKey(itemKey(o, n)); delete idx[n]; };
  if (size > BUDGET) { evict(name); writeJson(indexKey(o), idx); return; }
  idx[name] = { at: entry.at, size };
  const byAge = Object.keys(idx).filter((n) => n !== name && n !== "access").sort((a, b) => idx[a].at - idx[b].at);
  // Отдельные планы, истории и карточки (имя с «:») — не больше MAX_ITEMS
  const items = byAge.filter((n) => n.includes(":"));
  items.slice(0, Math.max(0, items.length + 1 - MAX_ITEMS)).forEach(evict);
  // Общий объём — вытесняем самое старое
  let total = Object.values(idx).reduce((s, x) => s + x.size, 0);
  for (const n of byAge) { if (total <= BUDGET) break; if (idx[n]) { total -= idx[n].size; evict(n); } }
  let ok = writeJson(itemKey(o, name), entry);
  if (!ok) {
    // Хранилище переполнено чем-то другим — освобождаем старую половину кэша и пробуем ещё раз
    byAge.slice(0, Math.ceil(byAge.length / 2)).forEach((n) => { if (idx[n]) evict(n); });
    ok = writeJson(itemKey(o, name), entry);
  }
  if (!ok) evict(name); // старое значение под этим именем тоже убираем — иначе оно осталось бы навсегда
  writeJson(indexKey(o), idx);
}

/** Поправить сохранённое (например, тренировка клиента закончилась) — без сети откроется верное */
export function patchCache<T>(name: string, f: (d: T) => T) {
  const hit = peekCache<T>(name);
  if (hit && owner) writeJson(itemKey(owner, name), { at: hit.at, data: f(hit.data) });
}

const sessionOrNull = () => Promise.race([
  supabase.auth.getSession().then(({ data }) => data.session),
  new Promise<null>((r) => setTimeout(() => r(null), SESSION_WAIT)),
]);

/**
 * Загрузить из сети и запомнить; без сети — отдать последнее сохранённое.
 * shrink — что именно хранить (например, только недавнюю историю).
 */
export async function cached<T>(name: string, load: () => Promise<T>, shrink?: (d: T) => T): Promise<T> {
  const o = owner;
  if (!o) return load();
  const fallback = () => {
    const hit = o === owner ? peekCache<T>(name) : null;
    if (hit) markStale(name, hit.at);
    return hit;
  };
  // Телефон знает, что сети нет, — не ждём, пока запрос упадёт
  if (!navigator.onLine) { const hit = fallback(); if (hit) return hit.data; }
  // Истёкший вход, который не удаётся обновить: запрос ушёл бы без входа, вернул пустой
  // список и затёр бы сохранённое
  if (!(await sessionOrNull())) { const hit = fallback(); if (hit) return hit.data; return load(); }
  try {
    const data = await load();
    if (o === owner) { put(o, name, shrink ? shrink(data) : data); markFresh(name); }
    return data;
  } catch (e) {
    const hit = isNetworkError(e) ? fallback() : null;
    if (!hit) throw e;
    return hit.data;
  }
}
