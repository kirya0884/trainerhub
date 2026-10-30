import { parseNum, parseRest, today } from "./format";
import type { Day, Metric, Session } from "../types";

/** rpe — усилие подхода по запасу повторов (см. RPE_SCALE); нет/0 — не указано.
 *  done — только в сохранённом факте (actualSets): false — подход не отмечен (это план, а не
 *  факт). У старых записей флага нет — такие подходы считаются сделанными, как и раньше. */
type SetVal = { weight: string; reps: string; rpe?: number; done?: boolean };
type SetsMeta = { done?: boolean; setsDone?: Record<number, boolean> };

/** Сделанные подходы: отмеченные галочкой (или всё упражнение отмечено «Готово») и не пустые.
 *  Вес и повторы подставлены из плана заранее — неотмеченный подход это план, а не факт,
 *  поэтому в итог, тоннаж и метрики идут только эти подходы. */
export const doneSets = (rows: SetVal[], m: SetsMeta | undefined) =>
  rows.filter((r, i) => (m?.done || m?.setsDone?.[i]) && (r.weight || r.reps));

/** Факт упражнения для записи: ВСЕ подходы по порядку (индексы совпадают с plannedSets),
 *  у каждого done — отмечен ли он — и rpe, если указан. Неотмеченный пишется пустым
 *  ({ weight: "", reps: "", done: false }): старая версия приложения на телефонах фильтрует
 *  подходы по weight || reps и иначе показала бы плановые значения как сделанные. */
export const factSets = (rows: SetVal[], m: SetsMeta | undefined) =>
  rows.map((r, i) => (m?.done || m?.setsDone?.[i]
    ? { weight: r.weight, reps: r.reps, done: true, ...(r.rpe ? { rpe: r.rpe } : {}) }
    : { weight: "", reps: "", done: false }));

/** Сохранённый подход — сделанный факт: не помечен done: false и не пустой */
export const isFact = (r: SetVal) => r.done !== false && !!(r.weight || r.reps);

/** Общий хелпер: строит массив метрик из упражнений дня и сделанных подходов.
 *  Используется в SessionModal, GroupSessionModal и ClientSessionView. */
export function buildMetrics(
  day: Day,
  vals: Record<string, SetVal[]>,
  meta: Record<string, SetsMeta | undefined>,
  date = today()
): Omit<Metric, "id">[] {
  const metrics: Omit<Metric, "id">[] = [];
  day.exercises.forEach((ex) => {
    if (!ex.name || ex.kind === "functional") return; // функциональные — время/пульс, в прогрессию весов не пишем
    const rows = doneSets(vals[ex.id] || [], meta[ex.id]).filter(
      (r) => parseNum(r.weight) != null || (r.reps !== "" && r.reps != null)
    );
    if (!rows.length) return;
    let best: { w: number; reps: string } | null = null;
    rows.forEach((r) => {
      const w = parseNum(r.weight);
      if (w != null && (best == null || w > best.w)) best = { w, reps: r.reps };
    });
    const rest = parseRest(ex.rest);
    metrics.push({
      date,
      exercise: ex.name,
      weight: best ? String(best.w) : "",
      reps: best ? String(parseNum(best.reps) ?? "") : String(parseNum(rows[0].reps) ?? ""),
      rest: rest == null ? "" : String(rest),
      sets: String(rows.length),
    });
  });
  return metrics;
}

/** Тоннаж = сумма (вес × повторы) по сделанным подходам — единственный расчёт тоннажа
 *  в приложении (тренировка, журнал, график). В тренировке передаём doneSets(...); в
 *  сохранённом факте подходы с done: false пропускаются здесь же.
 *  Отрицательный вес (помощь противовеса) тоннажа не добавляет. */
export const tonnageOf = (rows: SetVal[]) =>
  rows.reduce((sum, r) => {
    if (r.done === false) return sum;
    const w = parseNum(r.weight); const rp = parseNum(r.reps);
    return w != null && rp != null ? sum + Math.max(0, w) * rp : sum;
  }, 0);

// ── Усилие: одна шкала RPE по запасу повторов, на каждый подход ──
// Значение хранится числом в подходе (actualSets[i].rpe). 5 значит «≤5». 9,5 ставит только тренер.
export const RPE_SCALE: { v: number; label: string; trainerOnly?: boolean }[] = [
  { v: 10, label: "Отказ, больше ни повтора" },
  { v: 9.5, label: "Повтор не сделать, чуть больший вес — да", trainerOnly: true },
  { v: 9, label: "Мог ещё 1 повтор" },
  { v: 8, label: "Ещё 2 в запасе" },
  { v: 7, label: "Ещё 3 в запасе" },
  { v: 6, label: "Ещё 4 в запасе" },
  { v: 5, label: "Легко, 5+ в запасе" },
];
/** Подпись значения: старые записи (прежняя шкала 0–10) ниже 6 — тоже «≤5» */
export const fmtRpe = (v: number) => (v < 6 ? "≤5" : String(v).replace(".", ","));
/** RPE упражнения для plan_session_items.rpe (smallint): максимум по подходам, округлённый
 *  вниз — 9,5 пишется как 9, а не завышается до отказа. Точное значение — в подходах. */
export const itemRpe = (sets: SetVal[]) => Math.floor(Math.max(0, ...sets.map((s) => (s.done === false ? 0 : s.rpe || 0))));

/** В дне нет ни одного упражнения — такую тренировку пишем без списания */
export const isEmptyDay = (day: Day) => !day.exercises.some((ex) => ex.name);

/** Тренер уже записывал этот день за эту дату (по id дня, у старых записей — по названию) */
export const isRepeatOf = (sessions: Session[], day: Day, date: string) =>
  sessions.some((s) => !s.fromClient && s.date === date && (s.dayId ? s.dayId === day.id : s.dayName === day.name));

// ── «Как в прошлый раз» ──
// Последнее проведение этого дня (в том же плане): по id дня, а у старых записей без
// него — по названию. Фактические подходы каждого упражнения — по названию упражнения.
export type LastTime = { date: string; byName: Record<string, SetVal[]> };
export function lastTimeFor(sessions: Session[], day: Day): LastTime | null {
  const s = [...sessions]
    .filter((x) => (x.dayId ? x.dayId === day.id : x.dayName === day.name))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .find((x) => x.items.some((it) => it.actualSets?.some(isFact)));
  if (!s) return null;
  // Подходы целиком, по индексам; неотмеченные (done: false) при подстановке пропускаются
  const byName: Record<string, SetVal[]> = {};
  for (const it of s.items) {
    if (it.actualSets?.some(isFact)) byName[it.name.trim().toLowerCase()] = it.actualSets;
  }
  return { date: s.date, byName };
}
/** Подставляет прошлые вес и повторы в подходы, которые ещё не отмечены. Количество
 *  подходов берётся из текущего плана: если подходов стало больше — повторяем последний
 *  сделанный прошлый. Прошлый подход не был отмечен — оставляем план. Упражнения, которых
 *  в прошлый раз не было, не трогаем. */
export function applyLastTime(day: Day, vals: Record<string, SetVal[]>, setsDone: (exId: string) => Record<number, boolean> | undefined, last: LastTime) {
  const next = { ...vals };
  for (const ex of day.exercises) {
    const prev = last.byName[ex.name.trim().toLowerCase()];
    if (!prev || ex.kind === "functional") continue;
    const done = setsDone(ex.id) ?? {};
    const facts = prev.filter(isFact);
    next[ex.id] = (vals[ex.id] ?? []).map((r, i) => {
      const p = i < prev.length ? (isFact(prev[i]) ? prev[i] : null) : facts[facts.length - 1];
      return done[i] || !p ? r : { ...r, weight: p.weight || r.weight, reps: p.reps || r.reps };
    });
  }
  return next;
}

// ── План/факт в плане ──
// Факт последней тренировки по упражнению (по названию) и как он отличается от плана,
// который был на тот момент (plannedSets сохраняются вместе с сессией).
/** dir "skip" — подход не отмечен или пуст (показывается прочерком, индексы как в плане) */
export type FactSet = { weight: string; reps: string; dir: "up" | "down" | "same" | "extra" | "skip" };
export type LastFact = { date: string; fromClient: boolean; sets: FactSet[]; changed: number };
const cmp = (a: number | null, b: number | null) => (a == null || b == null || a === b ? 0 : a > b ? 1 : -1);
export function lastFactsByName(sessions: Session[]): Record<string, LastFact> {
  const out: Record<string, LastFact> = {};
  const sorted = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const s of sorted) for (const it of s.items ?? []) {
    const key = it.name.trim().toLowerCase();
    if (!key || out[key]) continue;
    const actual = [...(it.actualSets ?? [])];
    if (!actual.some(isFact)) continue;
    while (!isFact(actual[actual.length - 1])) actual.pop(); // хвост без факта не показываем
    const planned = it.plannedSets ?? [];
    const sets = actual.map((r, i): FactSet => {
      if (!isFact(r)) return { weight: "", reps: "", dir: "skip" };
      const p = planned[i];
      if (!p) return { weight: r.weight, reps: r.reps, dir: "extra" };
      // Вес важнее: больше вес при меньших повторах — это шаг вверх
      const d = cmp(parseNum(r.weight), parseNum(p.weight)) || cmp(parseNum(r.reps), parseNum(p.reps));
      return { weight: r.weight, reps: r.reps, dir: d > 0 ? "up" : d < 0 ? "down" : "same" };
    });
    out[key] = { date: s.date, fromClient: !!s.fromClient, sets, changed: sets.filter((x) => x.dir !== "same" && x.dir !== "skip").length };
  }
  return out;
}
