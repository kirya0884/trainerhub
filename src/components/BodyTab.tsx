import { useState } from "react";
import { Plus, Ruler, X } from "lucide-react";
import TrendChart from "./TrendChart";
import { BODY_METRICS } from "../constants";
import { today } from "../lib/format";
import * as api from "../lib/clients";
import type { Measurement } from "../lib/clients";
import NumField from "./NumField";

export const emptyMeasurement = (): Omit<Measurement, "id"> => ({
  date: today(), note: "", weight: "", neck: "", shoulders: "", chest: "", waist: "", glutes: "", thigh: "", biceps: "", bodyfat: "", muscleMass: "",
});

export default function BodyTab({ clientId, measurements, setMeasurements }: { clientId: string; measurements: Measurement[]; setMeasurements: (m: Measurement[]) => void }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyMeasurement());
  const [bodyMetric, setBodyMetric] = useState<string>(BODY_METRICS[0].key);

  const submit = async () => {
    try {
      await api.addMeasurement(clientId, form);
      setForm(emptyMeasurement());
      setShowForm(false);
      api.fetchMeasurements(clientId).then(setMeasurements).catch((e) => console.error("[BodyTab] fetchMeasurements:", e));
    } catch (e) { console.error("[BodyTab] submit:", e); alert("Не удалось сохранить замер."); }
  };
  const remove = async (id: string) => {
    try { await api.deleteMeasurement(id); setMeasurements(measurements.filter((m) => m.id !== id)); }
    catch (e) { console.error("[BodyTab] remove:", e); }
  };

  const bm = BODY_METRICS.find((x) => x.key === bodyMetric)!;
  const series = measurements
    .map((x) => ({ date: x.date.slice(5), value: (x as any)[bodyMetric] === "" || (x as any)[bodyMetric] == null ? null : Number((x as any)[bodyMetric]) }))
    .filter((d) => d.value != null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold flex items-center gap-1.5"><Ruler size={16} style={{ color: "var(--accent)" }} /> Замеры тела</h3><button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm transition shrink-0" style={{ background: "var(--accent)" }}><Plus size={15} /> Замер</button></div>

      {showForm && (
        <div className="bg-zinc-800/40 rounded-xl p-3 space-y-2 relative">
          <button onClick={() => { setShowForm(false); setForm(emptyMeasurement()); }} className="absolute top-2 right-2 p-1 rounded-md hover:bg-zinc-700 text-zinc-400 transition" title="Закрыть"><X size={16} /></button>
          <label className="text-xs text-zinc-500 block pr-7">Дата<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" /></label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {BODY_METRICS.map((m) => (
              <NumField key={m.key} label={`${m.label} ${m.unit}`} value={(form as any)[m.key]} onChange={(e) => setForm({ ...form, [m.key]: e.target.value })} placeholder="—" />
            ))}
          </div>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="заметка (необязательно)" className="w-full bg-zinc-800 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          <button onClick={submit} className="w-full text-zinc-950 font-semibold rounded-lg py-2 text-sm transition" style={{ background: "var(--accent)" }}>Сохранить замер</button>
        </div>
      )}

      <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5 w-full overflow-x-auto">
        {BODY_METRICS.map((x) => <button key={x.key} onClick={() => setBodyMetric(x.key)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition whitespace-nowrap shrink-0 ${bodyMetric === x.key ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`} style={bodyMetric === x.key ? { background: "var(--accent)" } : undefined}>{x.label}</button>)}
      </div>

      <div className="bg-zinc-800/30 rounded-xl p-3 pt-4">
        <TrendChart data={series} color={bm.color} height={220} formatter={(v) => `${v} ${bm.unit}`} emptyText={`Нет данных по «${bm.label}». Добавь замер кнопкой выше.`} />
      </div>

      {measurements.length === 0 && !showForm && (
        <div className="text-center py-8 text-zinc-600">
          <p className="text-sm">Замеров пока нет.</p>
          <button onClick={() => setShowForm(true)} className="mt-2 text-sm font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>Добавить первый замер</button>
        </div>
      )}
      {measurements.length > 0 && (
        <div className="space-y-1.5">
          {[...measurements].reverse().map((e) => (
            <div key={e.id} className="flex items-center gap-2 bg-zinc-800/40 rounded-lg px-3 py-2 text-sm">
              <span className="text-zinc-400 shrink-0 w-16">{e.date.slice(5)}</span>
              <span className="flex-1 flex flex-wrap gap-x-3 gap-y-0.5 text-zinc-300">
                {BODY_METRICS.filter((m) => (e as any)[m.key] !== "" && (e as any)[m.key] != null).map((m) => <span key={m.key}>{m.label.toLowerCase()} {(e as any)[m.key]}{m.unit === "%" ? "%" : ""}</span>)}
                {e.note && <span className="text-zinc-500">· {e.note}</span>}
              </span>
              <button onClick={() => remove(e.id)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
