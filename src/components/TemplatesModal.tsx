import { useEffect, useState } from "react";
import { ClipboardList, FileStack, Trash2 } from "lucide-react";
import ModalShell from "./ModalShell";
import * as api from "../lib/templates";
import type { DayTemplate, PlanTemplate } from "../lib/templates";

// Применить шаблон плана/дня к текущему плану, либо сохранить текущие дни как новый шаблон.
export default function TemplatesModal({ trainerId, currentDays, onApplyPlan, onApplyDay, onClose }: {
  trainerId: string; currentDays: { id: string; name: string }[];
  onApplyPlan: (days: PlanTemplate["days"]) => void; onApplyDay: (day: DayTemplate["day"]) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"plan" | "day">("plan");
  const [planTpls, setPlanTpls] = useState<PlanTemplate[] | null>(null);
  const [dayTpls, setDayTpls] = useState<DayTemplate[] | null>(null);
  const [name, setName] = useState("");
  const [saveDayId, setSaveDayId] = useState(currentDays[0]?.id || "");

  const load = () => { api.fetchPlanTemplates(trainerId).then(setPlanTpls).catch((e) => console.error("[TemplatesModal] fetchPlanTpls:", e)); api.fetchDayTemplates(trainerId).then(setDayTpls).catch((e) => console.error("[TemplatesModal] fetchDayTpls:", e)); };
  useEffect(() => { load(); }, [trainerId]);

  const saveAsTemplate = async () => {
    if (!name.trim()) return;
    try {
      if (tab === "plan") await api.savePlanAsTemplate(trainerId, name.trim(), currentDays as any);
      else {
        const day = currentDays.find((d) => d.id === saveDayId) as any;
        if (day) await api.saveDayAsTemplate(trainerId, name.trim(), day);
      }
      setName("");
      load();
    } catch (e) { console.error("[TemplatesModal] saveAsTemplate:", e); alert("Не удалось сохранить шаблон."); }
  };

  return (
    <ModalShell title="Шаблоны" icon={<FileStack size={17} className="text-lime-400" />} onClose={onClose} wide>
      <div className="p-4 space-y-4 overflow-y-auto">
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5 w-fit">
          <button onClick={() => setTab("plan")} className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${tab === "plan" ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>Шаблоны планов</button>
          <button onClick={() => setTab("day")} className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${tab === "day" ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>Шаблоны дней</button>
        </div>

        <div className="bg-zinc-800/40 rounded-xl p-3 space-y-2">
          <p className="text-xs text-zinc-500">{tab === "plan" ? "Сохранить все дни текущего плана как шаблон" : "Сохранить один день текущего плана как шаблон"}</p>
          {tab === "day" && currentDays.length > 0 && (
            <select value={saveDayId} onChange={(e) => setSaveDayId(e.target.value)} className="w-full bg-zinc-800 rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40">
              {currentDays.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveAsTemplate()} placeholder="Название шаблона" className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
            <button onClick={saveAsTemplate} className="bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 text-sm hover:bg-lime-300 transition shrink-0">Сохранить</button>
          </div>
        </div>

        <div className="space-y-1.5">
          {tab === "plan" && (planTpls ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="min-w-0"><p className="text-sm font-medium truncate">{t.name}</p><p className="text-xs text-zinc-500">{t.days.length} дней</p></div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => onApplyPlan(t.days)} className="flex items-center gap-1 bg-zinc-800 hover:bg-lime-400/20 hover:text-lime-400 text-zinc-300 rounded-lg px-2.5 py-1.5 text-xs transition"><ClipboardList size={13} /> Применить</button>
                <button onClick={() => api.deletePlanTemplate(t.id).then(load).catch((e) => console.error("[TemplatesModal] delete:", e))} className="p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {tab === "day" && (dayTpls ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="min-w-0"><p className="text-sm font-medium truncate">{t.name}</p><p className="text-xs text-zinc-500">{t.day.exercises?.length ?? 0} упр.</p></div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => onApplyDay(t.day)} className="flex items-center gap-1 bg-zinc-800 hover:bg-lime-400/20 hover:text-lime-400 text-zinc-300 rounded-lg px-2.5 py-1.5 text-xs transition"><ClipboardList size={13} /> Применить</button>
                <button onClick={() => api.deleteDayTemplate(t.id).then(load).catch((e) => console.error("[TemplatesModal] delete:", e))} className="p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {tab === "plan" && planTpls?.length === 0 && <p className="text-sm text-zinc-600 text-center py-6">Шаблонов планов пока нет</p>}
          {tab === "day" && dayTpls?.length === 0 && <p className="text-sm text-zinc-600 text-center py-6">Шаблонов дней пока нет</p>}
        </div>
      </div>
    </ModalShell>
  );
}
