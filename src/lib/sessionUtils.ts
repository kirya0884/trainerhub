import { fmtSet, parseNum, parseRest, today } from "./format";
import type { Day, Exercise, Metric, Session, SessionItem } from "../types";

// Разбор путей 3.14: сводка упражнения из «разных подходов» — подходы по числу строк, вес и
// повторы первой. Пишется вместе со строками, чтобы простой режим, печать и генератор не видели пустоту.
export const rowsSummary = (rows: { weight: string; reps: string }[]) =>
  ({ sets: rows.length ? String(rows.length) : "", weight: rows[0]?.weight ?? "", reps: rows[0]?.reps ?? "" });

/** Подходы упражнения плана текстом: «60×10, 65×8» у разных подходов, «4×10 · 60» у простых */
export function planSetsText(ex: Pick<Exercise, "kind" | "detailed" | "setRows" | "sets" | "reps" | "weight" | "duration" | "pulseZone">) {
  if (ex.kind === "functional") return [ex.duration, ex.weight, ex.pulseZone ? `пульс ${ex.pulseZone}` : ""].filter(Boolean).join(" · ");
  if (ex.detailed && ex.setRows?.length) return ex.setRows.map((s) => fmtSet(s.weight, s.reps)).join(", ");
  if (!ex.sets && !ex.reps) return ex.weight;
  return `${ex.sets || "—"}×${ex.reps || "—"}${ex.weight ? ` · ${ex.weight}` : ""}`;
}

/** rpe — усилие подхода по запасу повторов (см. RPE_SCALE); нет/0 — не указано.
 *  done — только в сохранённом факте (actualSets): false — подход не отмечен (это план, а не
 *  факт). У старых записей флага нет — такие подходы считаются сделанными, как и раньше. */
type SetVal = { weight: string; reps: string; rpe?: number; done?: boolean };
type SetsMeta = { done?: boolean; setsDone?: Record<number, boolean> };

/** Ключ сравнения упражнений по названию: регистр, ё/е и лишние пробелы не важны.
 *  Только для сопоставления — сами названия в данных не меняются. */
export const exKey = (name: string) => name.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

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

/** Вес последнего сделанного подхода с весом; нет такого — "" */
export const lastFactWeight = (sets: SetVal[] | undefined) =>
  [...(sets ?? [])].reverse().find((r) => isFact(r) && r.weight)?.weight ?? "";

/** Итог упражнения в записанной тренировке: отмечено «не сделано», сделано частично (меньше
 *  подходов, чем в плане), сделано или без отметок (старые записи, сохранённые «как есть»). */
export type ItemStatus = "done" | "partial" | "skipped" | "none";
export function itemStatus(it: Pick<SessionItem, "skipped" | "actualSets" | "plannedSets">): ItemStatus {
  if (it.skipped) return "skipped";
  const f = (it.actualSets ?? []).filter(isFact).length;
  if (!f) return "none";
  const plan = it.plannedSets?.length ?? 0;
  return plan && f < plan ? "partial" : "done";
}
export const skippedCount = (s: Pick<Session, "items">) => (s.items ?? []).filter((i) => i.skipped).length;

/** Копия проведённого дня: вес — фактический из тренировки (последний сделанный), подходы и
 *  повторы — как в плане. Строки «разных подходов» берут вес своего подхода, лишние — последний. */
export function withFactWeights(day: Day, session: Pick<Session, "items"> | undefined): Day {
  if (!session) return day;
  const exercises = day.exercises.map((ex) => {
    const actual = session.items?.find((i) => exKey(i.name) === exKey(ex.name))?.actualSets ?? [];
    const last = lastFactWeight(actual);
    if (!last) return ex;
    if (ex.detailed && ex.setRows.length) {
      const setRows = ex.setRows.map((r, i) => ({ ...r, weight: (actual[i] && isFact(actual[i]) && actual[i].weight) || last }));
      return { ...ex, setRows, weight: rowsSummary(setRows).weight };
    }
    return { ...ex, weight: last };
  });
  return { ...day, exercises };
}

/** Разбор путей 3.9: тренировка этого дня — по id дня, по названию только у старых записей без id.
 *  По одному названию копия дня или блока сразу выглядела «проведённой». */
export const isSessionOfDay = (s: Pick<Session, "dayId" | "dayName">, d: Pick<Day, "id" | "name">) => (s.dayId ? s.dayId === d.id : s.dayName === d.name);

/** Следующий день плана: после дня последней проведённой тренировки (по id дня, у старых
 *  записей — по названию); после последнего дня — снова первый. Тренировок по этим дням
 *  не было — первый день. Нет дней — null. */
export function nextDayOf(days: Day[], sessions: Pick<Session, "date" | "dayId" | "dayName">[]): Day | null {
  if (!days.length) return null;
  const idxOf = (s: Pick<Session, "dayId" | "dayName">) => days.findIndex((d) => (s.dayId ? s.dayId === d.id : s.dayName === d.name));
  // Сортировка устойчивая: в один день побеждает пришедшая первой (запрос — свежие сверху)
  const last = [...sessions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).find((s) => idxOf(s) >= 0);
  return days[last ? (idxOf(last) + 1) % days.length : 0];
}

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
    if (it.actualSets?.some(isFact)) byName[exKey(it.name)] = it.actualSets;
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
    const prev = last.byName[exKey(ex.name)];
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
    const key = exKey(it.name);
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

/** Этап 12: подход тяжелее лучшего веса прошлой тренировки этого упражнения — рекорд */
export function isWeightRecord(weight: string, prev?: { weight: string }[] | null): boolean {
  const w = parseNum(weight);
  if (w == null || !prev?.length) return false;
  const best = Math.max(...prev.map((p) => parseNum(p.weight) ?? 0));
  return best > 0 && w > best;
}

/** Этап 12: сколько недель подряд (пн–вс) были тренировки — по эту или прошлую неделю
 *  включительно (на этой неделе ещё может быть впереди). */
export function weeksStreak(dates: string[], todayIso: string): number {
  const week = (iso: string) => { const d = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000; return Math.floor((d + 3) / 7); }; // 1970-01-01 — четверг
  const set = new Set(dates.map(week));
  let w = week(todayIso);
  if (!set.has(w)) w--;
  let n = 0;
  while (set.has(w)) { n++; w--; }
  return n;
}
