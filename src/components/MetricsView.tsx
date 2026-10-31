import { BarChart3, Plus, X } from "lucide-react";
import { useState } from "react";
import TrendChart from "./TrendChart";
import { EXERCISE_METRICS } from "../constants";
import { parseNum, today } from "../lib/format";
import { exKey, tonnageOf } from "../lib/sessionUtils";
import type { Day, Metric, Session } from "../types";
import NumField from "./NumField";
import { ask } from "../lib/dialog";

export default function MetricsView({ days, metrics, sessions, addMetric, deleteMetric }: {
  days: Day[]; metrics: Metric[]; sessions: Session[]; addMetric: (m: Omit<Metric, "id">) => void; deleteMetric: (id: string) => void;
}) {
  // Одно упражнение с разным написанием (ё/е, регистр, пробелы) — один пункт, первое написание
  const byKey = new Map<string, string>();
  for (const d of days) for (const e of d.exercises) if (e.name && !byKey.has(exKey(e.name))) byKey.set(exKey(e.name), e.name);
  const exercises = [...byKey.values()];
  const [sel, setSel] = useState(exercises[0] || "");
  const [metric, setMetric] = useState<string>("weight");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: today(), exercise: exercises[0] || "", weight: "", reps: "", rest: "", sets: "" });

  const curExercise = exercises.includes(sel) ? sel : (exercises[0] || "");
  const curKey = exKey(curExercise);
  const m = EXERCISE_METRICS.find((x) => x.key === metric)!;
  // Тоннаж — по фактическим подходам тренировок, тем же tonnageOf, что в тренировке и журнале
  // (раньше: макс. вес × повторы × подходы). Из ручного замера — только за даты без тренировки.
  const sessionTonnage = new Map<string, number>();
  if (metric === "tonnage") {
    for (const s of sessions) for (const it of s.items ?? []) {
      if (exKey(it.name) !== curKey || !it.actualSets?.length) continue;
      const t = tonnageOf(it.actualSets); // неотмеченные подходы (done: false) tonnageOf пропускает
      // Только t > 0: тренировка с нулевым тоннажем не должна закрывать ручной замер за эту дату
      if (t > 0) sessionTonnage.set(s.date, (sessionTonnage.get(s.date) ?? 0) + t);
    }
  }
  const series = [
    ...[...sessionTonnage].map(([date, t]) => ({ date, value: Math.round(t) as number | null })),
    ...metrics.filter((x) => exKey(x.exercise) === curKey && !sessionTonnage.has(x.date)),
  ]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((x) => {
      let value: number | null;
      if ("value" in x) value = x.value;
      else if (metric === "tonnage") {
        const w = parseNum(x.weight), r = parseNum(x.reps), s = parseNum(x.sets);
        value = w == null || r == null ? null : Math.round(Math.max(0, w) * r * (s ?? 1));
      } else {
        const raw = (x as any)[metric];
        value = raw === "" || raw == null ? null : Number(raw);
      }
      return { date: x.date.slice(5), value };
    })
    .filter((d) => d.value != null);
  const entries = metrics.filter((x) => exKey(x.exercise) === curKey).sort((a, b) => (a.date < b.date ? 1 : -1));

  const submit = () => {
    if (!form.exercise) return;
    addMetric(form);
    setForm({ date: today(), exercise: form.exercise, weight: "", reps: "", rest: "", sets: "" });
    setShowForm(false);
  };

  if (exercises.length === 0) return <p className="text-sm text-zinc-600 text-center py-8">Сначала добавь упражнения во вкладке «Тренировки» — тогда сможешь записывать по ним замеры и строить графики.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold flex items-center gap-1.5"><BarChart3 size={16} style={{ color: "var(--accent)" }} /> Динамика по упражнению</h3>
        <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm transition shrink-0" style={{ background: "var(--accent)" }}><Plus size={15} /> Замер</button>
      </div>
      {showForm && (
        <div className="bg-zinc-800/40 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-zinc-500">Дата<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" /></label>
            <label className="text-xs text-zinc-500">Упражнение<select value={form.exercise} onChange={(e) => setForm({ ...form, exercise: e.target.value })} className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40">{exercises.map((ex) => <option key={ex} value={ex}>{ex}</option>)}</select></label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <NumField label="Вес кг" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="65" />
            <NumField label="Повторы" value={form.reps} onChange={(e) => setForm({ ...form, reps: e.target.value })} placeholder="8" inputMode="numeric" />
            <NumField label="Отдых с" value={form.rest} onChange={(e) => setForm({ ...form, rest: e.target.value })} placeholder="120" inputMode="numeric" />
            <NumField label="Подходы" value={form.sets} onChange={(e) => setForm({ ...form, sets: e.target.value })} placeholder="4" inputMode="numeric" />
          </div>
          <button onClick={submit} className="w-full text-zinc-950 font-semibold rounded-xl py-2 text-sm transition" style={{ background: "var(--accent)" }}>Сохранить замер</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={curExercise} onChange={(e) => setSel(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-zinc-500 max-w-full">{exercises.map((ex) => <option key={ex} value={ex}>{ex}</option>)}</select>
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5 overflow-x-auto">{EXERCISE_METRICS.map((x) => <button key={x.key} onClick={() => setMetric(x.key)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition whitespace-nowrap ${metric === x.key ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`} style={metric === x.key ? { background: "var(--accent)" } : undefined}>{x.label}</button>)}</div>
      </div>
      <div className="bg-zinc-800/30 rounded-xl p-3 pt-4">
        <TrendChart data={series} color={m.color} height={230} formatter={(v) => `${v}${m.unit ? " " + m.unit : ""}`} emptyText={`Нет данных по «${m.label}». Добавь замер или проведи тренировку.`} />
      </div>
      {entries.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1.5">Замеры ({entries.length})</p>
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-2 bg-zinc-800/40 rounded-xl px-3 py-2 text-sm">
                <span className="text-zinc-400 shrink-0 w-14">{e.date.slice(5)}</span>
                <span className="flex-1 min-w-0 flex flex-wrap gap-x-3 gap-y-0.5 text-zinc-300">
                  {e.weight !== "" && <span>{e.weight} кг</span>}
                  {e.reps !== "" && <span>{e.reps} повт.</span>}
                  {e.sets !== "" && <span>{e.sets} подх.</span>}
                  {e.rest !== "" && <span>отдых {e.rest} с</span>}
                </span>
                <button onClick={async () => { if (await ask("Удалить запись?", { ok: "Удалить", danger: true })) deleteMetric(e.id); }} className="p-1 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
