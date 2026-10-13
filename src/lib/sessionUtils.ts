import { parseNum, parseRest, today } from "./format";
import type { Day, Metric, Session } from "../types";

type SetVal = { weight: string; reps: string };

/** Общий хелпер: строит массив метрик из упражнений дня и заполненных подходов.
 *  Используется в GroupSessionModal и ClientSessionView. */
export function buildMetrics(
  day: Day,
  vals: Record<string, SetVal[]>
): Omit<Metric, "id">[] {
  const metrics: Omit<Metric, "id">[] = [];
  day.exercises.forEach((ex) => {
    if (!ex.name || ex.kind === "functional") return; // функциональные — время/пульс, в прогрессию весов не пишем
    const rows = (vals[ex.id] || []).filter(
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
      date: today(),
      exercise: ex.name,
      weight: best ? String(best.w) : "",
      reps: best ? String(parseNum(best.reps) ?? "") : String(parseNum(rows[0].reps) ?? ""),
      rest: rest == null ? "" : String(rest),
      sets: String(rows.length),
    });
  });
  return metrics;
}

/** Тоннаж = сумма (вес × повторы). С setsDone — только по отмеченным подходам:
 *  вес и повторы подставлены из плана заранее, и без этого тоннаж с первой секунды
 *  показывал плановый итог, а не сделанное. */
export const tonnageOf = (rows: SetVal[], setsDone?: Record<number, boolean>) =>
  rows.reduce((sum, r, i) => {
    if (setsDone && !setsDone[i]) return sum;
    const w = parseNum(r.weight); const rp = parseNum(r.reps);
    return w != null && rp != null ? sum + w * rp : sum;
  }, 0);

// ── «Как в прошлый раз» ──
// Последнее проведение этого дня (в том же плане): по id дня, а у старых записей без
// него — по названию. Фактические подходы каждого упражнения — по названию упражнения.
export type LastTime = { date: string; byName: Record<string, SetVal[]> };
export function lastTimeFor(sessions: Session[], day: Day): LastTime | null {
  const s = [...sessions]
    .filter((x) => (x.dayId ? x.dayId === day.id : x.dayName === day.name))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .find((x) => x.items.some((it) => it.actualSets?.some((r) => r.weight || r.reps)));
  if (!s) return null;
  const byName: Record<string, SetVal[]> = {};
  for (const it of s.items) {
    const rows = (it.actualSets ?? []).filter((r) => r.weight || r.reps);
    if (rows.length) byName[it.name.trim().toLowerCase()] = rows;
  }
  return { date: s.date, byName };
}
/** Подставляет прошлые вес и повторы в подходы, которые ещё не отмечены. Количество
 *  подходов берётся из текущего плана: если подходов стало больше — повторяем последний
 *  прошлый. Упражнения, которых в прошлый раз не было, не трогаем. */
export function applyLastTime(day: Day, vals: Record<string, SetVal[]>, setsDone: (exId: string) => Record<number, boolean> | undefined, last: LastTime) {
  const next = { ...vals };
  for (const ex of day.exercises) {
    const prev = last.byName[ex.name.trim().toLowerCase()];
    if (!prev || ex.kind === "functional") continue;
    const done = setsDone(ex.id) ?? {};
    next[ex.id] = (vals[ex.id] ?? []).map((r, i) => (done[i] ? r : { weight: prev[Math.min(i, prev.length - 1)].weight || r.weight, reps: prev[Math.min(i, prev.length - 1)].reps || r.reps }));
  }
  return next;
}
