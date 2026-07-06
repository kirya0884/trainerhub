import { useMemo, useState } from "react";
import { Apple, Plus, X } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { today } from "../lib/format";
import * as api from "../lib/nutrition";
import type { NutritionLog } from "../lib/nutrition";
import NumField from "./NumField";

const emptyLog = (): Omit<NutritionLog, "id"> => ({ date: today(), calories: 0, protein: 0, fat: 0, carbs: 0 });

const FIELDS: { key: keyof Omit<NutritionLog, "id" | "date">; label: string; color: string }[] = [
  { key: "calories", label: "Ккал", color: "#fb923c" },
  { key: "protein", label: "Белки", color: "#a3e635" },
  { key: "fat", label: "Жиры", color: "#f472b6" },
  { key: "carbs", label: "Углеводы", color: "#22d3ee" },
];

export default function NutritionTab({ clientId, logs, setLogs, readOnly }: {
  clientId: string; logs: NutritionLog[]; setLogs: (l: NutritionLog[]) => void; readOnly?: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyLog());
  const [metric, setMetric] = useState<typeof FIELDS[number]["key"]>("calories");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const submit = async () => {
    await api.addNutritionLog(clientId, form);
    setForm(emptyLog());
    setShowForm(false);
    api.fetchNutritionLogs(clientId).then(setLogs);
  };
  const remove = async (id: string) => { await api.deleteNutritionLog(id); setLogs(logs.filter((l) => l.id !== id)); };

  const filtered = useMemo(
    () => logs.filter((l) => (!from || l.date >= from) && (!to || l.date <= to)),
    [logs, from, to]
  );
  const series = filtered.map((l) => ({ date: l.date.slice(5), value: l[metric] }));
  const fm = FIELDS.find((f) => f.key === metric)!;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-1.5"><Apple size={16} style={{ color: "var(--accent, #a3e635)" }} /> Питание</h3>
        {!readOnly && (
          <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm hover:opacity-90 transition" style={{ background: "var(--accent, #a3e635)" }}>
            <Plus size={15} /> Запись
          </button>
        )}
      </div>

      {!readOnly && showForm && (
        <div className="bg-zinc-800/40 rounded-xl p-3 space-y-2 relative">
          <button onClick={() => { setShowForm(false); setForm(emptyLog()); }} className="absolute top-2 right-2 p-1 rounded-md hover:bg-zinc-700 text-zinc-400 transition" title="Закрыть"><X size={16} /></button>
          <label className="text-xs text-zinc-500 block pr-7">Дата<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent,#a3e635)]" /></label>
          <div className="grid grid-cols-4 gap-2">
            {FIELDS.map((f) => (
              <NumField key={f.key} label={f.label} value={String(form[f.key] || "")} onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) || 0 })} placeholder="0" />
            ))}
          </div>
          <button onClick={submit} className="w-full text-zinc-950 font-semibold rounded-lg py-2 text-sm hover:opacity-90 transition" style={{ background: "var(--accent, #a3e635)" }}>Сохранить запись</button>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <span className="text-zinc-500">Период:</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-zinc-800 rounded-md px-2 py-1 text-zinc-300 outline-none" />
        <span className="text-zinc-500">—</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-zinc-800 rounded-md px-2 py-1 text-zinc-300 outline-none" />
      </div>

      <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5 w-full overflow-x-auto">
        {FIELDS.map((f) => <button key={f.key} onClick={() => setMetric(f.key)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition whitespace-nowrap shrink-0 ${metric === f.key ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{f.label}</button>)}
      </div>

      <div className="bg-zinc-800/30 rounded-xl p-3 pt-4">
        {series.length === 0 ? <p className="text-sm text-zinc-600 text-center py-10">Нет данных за выбранный период.</p> : (
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="date" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} width={36} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#a1a1aa" }} formatter={(v: any) => [v, fm.label]} />
                <Line type="monotone" dataKey="value" stroke={fm.color} strokeWidth={2.5} dot={{ r: 3, fill: fm.color }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-zinc-800/30 rounded-xl overflow-hidden">
        <div className="grid grid-cols-5 gap-1 px-3 py-2 text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
          <span>Дата</span><span>Ккал</span><span>Белки</span><span>Жиры</span><span>Углев.</span>
        </div>
        {filtered.length === 0 ? <p className="text-sm text-zinc-600 text-center py-6">{logs.length === 0 ? "Записей питания пока нет — добавь первую кнопкой выше." : "Нет записей за выбранный период."}</p> : (
          [...filtered].reverse().map((l) => (
            <div key={l.id} className="grid grid-cols-5 gap-1 px-3 py-1.5 text-sm border-b border-zinc-800/50 items-center group">
              <span className="text-zinc-400">{l.date.slice(5)}</span>
              <span>{l.calories}</span><span>{l.protein}</span><span>{l.fat}</span>
              <span className="flex items-center justify-between">
                {l.carbs}
                {!readOnly && <button onClick={() => remove(l.id)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={13} /></button>}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
