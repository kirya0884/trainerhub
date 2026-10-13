import { useState } from "react";
import { Target, UserCheck } from "lucide-react";
import ModalShell from "./ModalShell";
import { MACRO_COLOR } from "./NutritionParts";
import * as api from "../lib/foodDiary";
import type { Goals } from "../lib/foodDiary";
import { fmtDate } from "../lib/format";

const str = (n: number | undefined) => (n ? String(Math.round(n)) : "");

// Цели КБЖУ. Задают оба; если цель есть у тренера — действует она, своя ждёт в запасе.
export default function NutritionGoalsSheet({ clientId, goals, onSaved, onClose }: {
  clientId: string; goals: Goals; onSaved: (g: Goals) => void; onClose: () => void;
}) {
  const own = goals.client;
  const [p, setP] = useState(str(own?.protein));
  const [f, setF] = useState(str(own?.fat));
  const [c, setC] = useState(str(own?.carbs));
  const [kcal, setKcal] = useState(str(own?.kcal));
  const [busy, setBusy] = useState(false);
  const auto = api.kcalOf({ protein: api.num(p), fat: api.num(f), carbs: api.num(c) });
  const next = { kcal: kcal.trim() ? api.num(kcal) : auto, protein: api.num(p), fat: api.num(f), carbs: api.num(c) };

  const save = async () => {
    if (busy || !next.kcal) return;
    setBusy(true);
    try {
      await api.saveGoal(clientId, "client", next);
      onSaved({ ...goals, client: { ...next, waterCups: own?.waterCups ?? null, updatedAt: new Date().toISOString() } });
      onClose();
    } catch (e) { console.error("[NutritionGoalsSheet]", e); alert("Не удалось сохранить цель."); setBusy(false); }
  };

  return (
    <ModalShell title="Цели питания" icon={<Target size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-4">
        {goals.trainer && (
          <div className="rounded-2xl bg-zinc-800/60 p-3.5">
            <div className="flex items-center justify-between">
              <b>Действует сейчас</b>
              <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-bold bg-lime-400/15 text-lime-400"><UserCheck size={13} /> от тренера</span>
            </div>
            <GoalRow g={goals.trainer} />
            <p className="text-[13px] text-zinc-400 mt-2">Тренер задал цель {fmtDate(goals.trainer.updatedAt.slice(0, 10))}. Своя цель ниже включится, только если тренер свою уберёт.</p>
          </div>
        )}

        <div>
          <p className="font-bold mb-1">{goals.trainer ? "Своя цель" : "Моя цель"}</p>
          <p className="text-[13px] text-zinc-400 mb-3">Укажите граммы белков, жиров и углеводов — калории посчитаются сами. Можно вписать свои ккал.</p>
          <div className="grid grid-cols-4 gap-1.5">
            <Field label="Белки, г" value={p} onChange={setP} color={MACRO_COLOR.protein} />
            <Field label="Жиры, г" value={f} onChange={setF} color={MACRO_COLOR.fat} />
            <Field label="Углев., г" value={c} onChange={setC} color={MACRO_COLOR.carbs} />
            <Field label="Ккал" value={kcal} onChange={setKcal} color={MACRO_COLOR.kcal} placeholder={auto ? String(Math.round(auto)) : "авто"} />
          </div>
        </div>
        <button onClick={save} disabled={busy || !next.kcal} className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </ModalShell>
  );
}

function GoalRow({ g }: { g: api.Macros }) {
  const items = [["kcal", "ккал"], ["protein", "белки"], ["fat", "жиры"], ["carbs", "углеводы"]] as const;
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-2.5">
      {items.map(([k, l]) => (
        <div key={k} className="text-center py-2 rounded-xl bg-zinc-900">
          <b className="block text-[17px] font-extrabold" style={{ color: MACRO_COLOR[k] }}>{api.fmtN(g[k], 0)}</b>
          <small className="text-[11px] text-zinc-400">{l}</small>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, color, placeholder = "0" }: { label: string; value: string; onChange: (v: string) => void; color: string; placeholder?: string }) {
  return (
    <label className="block text-center rounded-xl bg-zinc-800 px-1 py-2">
      <span className="block text-[11px] text-zinc-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder={placeholder} aria-label={label}
        className="w-full bg-transparent text-center text-lg font-extrabold outline-none placeholder:text-zinc-600" style={{ color }} />
    </label>
  );
}
