import { useState } from "react";
import { Plus, Trash2, Activity } from "lucide-react";
import * as portalApi from "../lib/clientPortal";
import type { ClientActivity } from "../lib/clientPortal";
import { fmtDate, today } from "../lib/format";

const ACTIVITY_PRESETS = ["Прогулка", "Бег", "Велосипед", "Плавание", "Йога", "Растяжка", "Другое"];
const UNIT_PRESETS: Record<string, string> = { "Прогулка": "шагов", "Бег": "км", "Велосипед": "км", "Плавание": "м", "Йога": "мин", "Растяжка": "мин" };

export default function ActivityTab({ clientId, activities, setActivities, readOnly, accent }: {
  clientId: string;
  activities: ClientActivity[];
  setActivities: React.Dispatch<React.SetStateAction<ClientActivity[]>>;
  readOnly?: boolean;
  accent?: string;
}) {
  const [type, setType] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);

  const accentColor = accent || "#22d3ee";

  const selectPreset = (p: string) => {
    setType(p);
    setUnit(UNIT_PRESETS[p] || "");
  };

  const add = async () => {
    if (!type.trim() || !value.trim()) return;
    setBusy(true);
    try {
      const entry = await portalApi.addClientActivity(clientId, { date, type: type.trim(), value: value.trim(), unit: unit.trim() });
      setActivities((prev) => [entry, ...prev]);
      setValue("");
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    try { await portalApi.deleteClientActivity(id); setActivities((prev) => prev.filter((a) => a.id !== id)); }
    catch (e) { console.error("[ActivityTab] remove:", e); }
  };

  // Группируем по дате
  const byDate = activities.reduce<Record<string, ClientActivity[]>>((acc, a) => {
    (acc[a.date] = acc[a.date] || []).push(a);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
          <p className="text-sm text-zinc-400 flex items-center gap-1.5"><Activity size={14} style={{ color: accentColor }} /> Добавить активность</p>

          {/* Пресеты */}
          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_PRESETS.map((p) => (
              <button key={p} onClick={() => selectPreset(p)} className="px-2.5 py-1 rounded-lg text-xs font-medium transition border" style={type === p ? { background: accentColor, color: "#09090b", borderColor: accentColor } : { borderColor: "#3f3f46", color: "#a1a1aa" }}>
                {p}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input value={type} onChange={(e) => setType(e.target.value)} placeholder="Тип активности" className="bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accentColor } as React.CSSProperties} />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accentColor } as React.CSSProperties} />
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Значение (8000)" className="bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accentColor } as React.CSSProperties} />
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Единица (шагов, км...)" className="bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accentColor } as React.CSSProperties} />
          </div>

          <button onClick={add} disabled={busy || !type.trim() || !value.trim()} className="w-full flex items-center justify-center gap-1.5 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 transition disabled:opacity-40" style={{ background: accentColor }}>
            <Plus size={15} /> Добавить
          </button>
        </div>
      )}

      {dates.length === 0 && <p className="text-sm text-zinc-600 text-center py-6">Активность не записана</p>}

      {dates.map((d) => (
        <div key={d} className="space-y-1.5">
          <p className="text-xs text-zinc-500 font-medium">{fmtDate(d)}</p>
          {byDate[d].map((a) => (
            <div key={a.id} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
              <div>
                <span className="text-sm font-medium text-zinc-200">{a.type}</span>
                <span className="text-sm text-zinc-400 ml-2">{a.value}{a.unit ? ` ${a.unit}` : ""}</span>
              </div>
              {!readOnly && (
                <button onClick={() => remove(a.id)} className="text-zinc-600 hover:text-red-400 transition p-1"><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
