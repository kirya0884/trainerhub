import { useState } from "react";
import { Repeat } from "lucide-react";
import ModalShell from "./ModalShell";
import { MESO_SCHEMES, generateMesocycle, type MesoScheme } from "../lib/periodization";
import type { Day } from "../types";

export default function PeriodizationModal({ days, planId, onClose, onDone }: { days: Day[]; planId: string; onClose: () => void; onDone: () => void }) {
  const [weeks, setWeeks] = useState(4);
  const [scheme, setScheme] = useState<MesoScheme>("linear");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try { await generateMesocycle(planId, days, weeks, scheme); onDone(); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="Генератор мезоцикла" icon={<Repeat size={17} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3 text-sm">
        <p className="text-zinc-400">Текущие {days.length} дн. плана возьмутся как неделя 1 — для недель 2..N дни будут склонированы с прогрессией веса/объёма по выбранной схеме.</p>
        <label className="text-xs text-zinc-500 block">Длительность мезоцикла (недель)
          <input type="text" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(Math.max(2, Math.min(12, parseInt(e.target.value.replace(/\D/g, "")) || 2)))} className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-lime-400/40" />
        </label>
        <label className="text-xs text-zinc-500 block">Схема прогрессии
          <select value={scheme} onChange={(e) => setScheme(e.target.value as MesoScheme)} className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 outline-none focus:ring-1 focus:ring-lime-400/40">
            {MESO_SCHEMES.map((s) => <option key={s.value} value={s.value} className="bg-zinc-900">{s.label}</option>)}
          </select>
        </label>
        <button onClick={run} disabled={busy || days.length === 0} className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 hover:bg-lime-300 transition disabled:opacity-50">{busy ? "Генерация..." : `Создать ${weeks - 1} доп. недел${weeks - 1 === 1 ? "ю" : "и"}`}</button>
      </div>
    </ModalShell>
  );
}
