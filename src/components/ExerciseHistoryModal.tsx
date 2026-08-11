import { BarChart3, HeartPulse, ListOrdered } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtDate, parseNum } from "../lib/format";
import type { Metric, Session } from "../types";
import ModalShell from "./ModalShell";
import TrendChart from "./TrendChart";

type Entry = {
  date: string;
  dayName: string;
  sets: { weight: string; reps: string }[];
  note: string;
  rpe: number;
  fromClient: boolean;
  /** Подходов нет, показываем сводку из журнала метрик */
  summary?: string;
};

/**
 * П10: история одного упражнения — все подходы блоками по датам плюс простой график.
 *
 * Связь с тренировками идёт по названию: в plan_session_items и plan_metrics лежит
 * текст, а не ссылка на упражнение. Поэтому переименованное упражнение своей истории
 * не увидит — это ограничение схемы, а не логики экрана.
 */
export default function ExerciseHistoryModal({
  name, sessions, metrics, onClose,
}: { name: string; sessions: Session[]; metrics: Metric[]; onClose: () => void }) {
  const [view, setView] = useState<"sets" | "chart">("sets");
  const key = name.trim().toLowerCase();

  const entries = useMemo<Entry[]>(() => {
    const metricByDate = new Map<string, Metric>();
    for (const m of metrics) if (m.exercise.trim().toLowerCase() === key) metricByDate.set(m.date, m);

    const list: Entry[] = [];
    for (const s of sessions) {
      const item = s.items?.find((i) => i.name.trim().toLowerCase() === key);
      if (!item) continue;
      const sets = (item.actualSets?.length ? item.actualSets : item.plannedSets ?? [])
        .filter((r) => (r.weight ?? "") !== "" || (r.reps ?? "") !== "");
      const m = metricByDate.get(s.date);
      list.push({
        date: s.date, dayName: s.dayName, sets, note: item.note || "", rpe: item.rpe || 0,
        fromClient: s.fromClient,
        summary: sets.length || !m ? undefined
          : [m.sets && m.reps ? `${m.sets}×${m.reps}` : "", m.weight].filter(Boolean).join(" · "),
      });
    }
    // Даты, где есть только запись в журнале метрик, а сессии нет
    const seen = new Set(list.map((e) => e.date));
    for (const [date, m] of metricByDate) {
      if (seen.has(date)) continue;
      list.push({
        date, dayName: "", sets: [], note: "", rpe: 0, fromClient: false,
        summary: [m.sets && m.reps ? `${m.sets}×${m.reps}` : "", m.weight].filter(Boolean).join(" · ") || "—",
      });
    }
    return list.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [sessions, metrics, key]);

  // График: максимум веса за тренировку. Для упражнений с собственным весом весов нет —
  // тогда показываем максимум повторов, иначе линия была бы пустой.
  const chart = useMemo(() => {
    const byWeight: { date: string; value: number }[] = [];
    const byReps: { date: string; value: number }[] = [];
    for (const e of [...entries].reverse()) {
      let w = 0, r = 0;
      for (const s of e.sets) {
        w = Math.max(w, parseNum(s.weight) ?? 0);
        r = Math.max(r, parseNum(s.reps) ?? 0);
      }
      const label = fmtDate(e.date);
      if (w > 0) byWeight.push({ date: label, value: w });
      if (r > 0) byReps.push({ date: label, value: r });
    }
    return byWeight.length ? { data: byWeight, unit: "кг", title: "Рабочий вес" }
                           : { data: byReps, unit: "повт", title: "Повторы" };
  }, [entries]);

  return (
    <ModalShell title={name || "Упражнение"} icon={<HeartPulse size={16} className="text-lime-400" />} onClose={onClose} wide>
      <div className="p-4 space-y-3">
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5">
          <button onClick={() => setView("sets")}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium flex items-center justify-center gap-1.5 transition ${view === "sets" ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"}`}>
            <ListOrdered size={14} /> Подходы
          </button>
          <button onClick={() => setView("chart")}
            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium flex items-center justify-center gap-1.5 transition ${view === "chart" ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"}`}>
            <BarChart3 size={14} /> График
          </button>
        </div>

        {entries.length === 0 && (
          <p className="text-sm text-zinc-600 text-center py-10">
            Это упражнение ещё не проводили. История появится после первой отмеченной тренировки.
          </p>
        )}

        {view === "sets" && entries.map((e) => (
          <div key={e.date + e.dayName} className="bg-zinc-800/40 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold">{fmtDate(e.date)}</span>
              {e.dayName && <><span className="text-zinc-700">·</span><span className="text-xs text-zinc-500 truncate">{e.dayName}</span></>}
              {e.fromClient && <span className="text-[10px] bg-cyan-400/10 text-cyan-400 rounded-full px-1.5 py-0.5 leading-none">клиент</span>}
              {e.rpe > 0 && <span className="ml-auto text-[11px] text-zinc-500 shrink-0">RPE {e.rpe}</span>}
            </div>
            {e.sets.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {e.sets.map((s, i) => (
                  <span key={i} className="flex items-baseline gap-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-sm">
                    <span className="text-[10px] text-zinc-600">{i + 1}</span>
                    <span className="font-medium">{s.weight || "—"}</span>
                    <span className="text-xs text-zinc-500">×</span>
                    <span className="font-medium">{s.reps || "—"}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">{e.summary || "Подходы не заполнены"}</p>
            )}
            {e.note && <p className="text-xs text-zinc-400 border-l-2 border-zinc-700 pl-2">{e.note}</p>}
          </div>
        ))}

        {view === "chart" && entries.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">{chart.title}</p>
            <TrendChart data={chart.data} color="#a3e635" height={220}
              formatter={(v) => `${v} ${chart.unit}`}
              emptyText="В подходах нет чисел — заполни вес или повторы во время тренировки." />
          </div>
        )}
      </div>
    </ModalShell>
  );
}
