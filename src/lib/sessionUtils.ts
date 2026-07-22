import { parseNum, today } from "./format";
import type { Day, Metric } from "../types";

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
    const rest = parseNum(ex.rest);
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
