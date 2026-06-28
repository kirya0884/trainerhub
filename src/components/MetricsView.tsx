import { BarChart3, Plus, X } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EXERCISE_METRICS } from "../constants";
import { today } from "../lib/format";
import type { Day, Metric } from "../types";
import NumField from "./NumField";

export default function MetricsView({ days, metrics, addMetric, deleteMetric }: {
  days: Day[]; metrics: Metric[]; addMetric: (m: Omit<Metric, "id">) => void; deleteMetric: (id: string) => void;
}) {
  const exercises = [...new Set(days.flatMap((d) => d.exercises.map((e) => e.name).filter(Boolean)))];
  const [sel, setSel] = useState(exercises[0] || "");
  const [metric, setMetric] = useState<string>("weight");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: today(), exercise: exercises[0] || "", weight: "", reps: "", rest: "", sets: "" });

  const curExercise = exercises.includes(sel) ? sel : (exercises[0] || "");
  const m = EXERCISE_METRICS.find((x) => x.key === metric)!;
  const series = metrics
    .filter((x) => x.exercise === curExercise)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((x) => ({ date: x.date.slice(5), value: (x as any)[metric] === "" || (x as any)[metric] == null ? null : Number((x as any)[metric]) }))
    .filter((d) => d.value != null);
  const entries = metrics.filter((x) => x.exercise === curExercise).sort((a, b) => (a.date < b.date ? 1 : -1));

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
        <h3 className="font-semibold flex items-center gap-1.5"><BarChart3 size={16} className="text-lime-400" /> Динамика по упражнению</h3>
        <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm hover:bg-lime-300 transition shrink-0"><Plus size={15} /> Замер</button>
      </div>
      {showForm && (
        <div className="bg-zinc-800/40 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-zinc-500">Дата<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" /></label>
            <label className="text-xs text-zinc-500">Упражнение<select value={form.exercise} onChange={(e) => setForm({ ...form, exercise: e.target.value })} className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40">{exercises.map((ex) => <option key={ex} value={ex}>{ex}</option>)}</select></label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <NumField label="Вес кг" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="65" />
            <NumField label="Повторы" value={form.reps} onChange={(e) => setForm({ ...form, reps: e.target.value })} placeholder="8" />
            <NumField label="Отдых с" value={form.rest} onChange={(e) => setForm({ ...form, rest: e.target.value })} placeholder="120" />
            <NumField label="Подходы" value={form.sets} onChange={(e) => setForm({ ...form, sets: e.target.value })} placeholder="4" />
          </div>
          <button onClick={submit} className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2 text-sm hover:bg-lime-300 transition">Сохранить замер</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={curExercise} onChange={(e) => setSel(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-lime-400/50 max-w-full">{exercises.map((ex) => <option key={ex} value={ex}>{ex}</option>)}</select>
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5 overflow-x-auto">{EXERCISE_METRICS.map((x) => <button key={x.key} onClick={() => setMetric(x.key)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition whitespace-nowrap ${metric === x.key ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{x.label}</button>)}</div>
      </div>
      <div className="bg-zinc-800/30 rounded-xl p-3 pt-4">
        {series.length === 0 ? (
          <p className="text-sm text-zinc-600 text-center py-10">Нет данных по «{m.label}». Добавь замер или проведи тренировку.</p>
        ) : (
          <div style={{ width: "100%", height: 230 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="date" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} width={36} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#a1a1aa" }} formatter={(v: any) => [`${v}${m.unit ? " " + m.unit : ""}`, m.label]} />
                <Line type="monotone" dataKey="value" stroke={m.color} strokeWidth={2.5} dot={{ r: 3, fill: m.color }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {entries.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 mb-1.5">Замеры ({entries.length})</p>
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-2 bg-zinc-800/40 rounded-lg px-3 py-2 text-sm">
                <span className="text-zinc-400 shrink-0 w-14">{e.date.slice(5)}</span>
                <span className="flex-1 min-w-0 flex flex-wrap gap-x-3 gap-y-0.5 text-zinc-300">
                  {e.weight !== "" && <span>{e.weight} кг</span>}
                  {e.reps !== "" && <span>{e.reps} повт.</span>}
                  {e.sets !== "" && <span>{e.sets} подх.</span>}
                  {e.rest !== "" && <span>отдых {e.rest} с</span>}
                </span>
                <button onClick={() => deleteMetric(e.id)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
