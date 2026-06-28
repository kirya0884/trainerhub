import { ChevronLeft, ClipboardList, Plus } from "lucide-react";
import { useState } from "react";
import { GOAL_LABELS, PROGRAM_CATALOG, type CatalogProgram } from "../data/programCatalog";
import * as api from "../lib/clients";
import * as templatesApi from "../lib/templates";
import ModalShell from "./ModalShell";

export default function ProgramCatalogModal({ trainerId, clientId, onClose, onCloned }: {
  trainerId: string; clientId: string; onClose: () => void; onCloned: (planId: string) => void;
}) {
  const [goal, setGoal] = useState<CatalogProgram["goal"] | "Все">("Все");
  const [detail, setDetail] = useState<CatalogProgram | null>(null);
  const [cloning, setCloning] = useState(false);
  const filtered = PROGRAM_CATALOG.filter((p) => goal === "Все" || p.goal === goal);

  const clone = async (p: CatalogProgram) => {
    setCloning(true);
    try {
      const plan = await api.addPlan(trainerId, clientId, p.name);
      await templatesApi.applyPlanTemplate(plan.id, p.days, 0);
      onCloned(plan.id);
    } finally { setCloning(false); }
  };

  return (
    <ModalShell title={detail ? detail.name : "Готовые программы"} icon={<ClipboardList size={17} className="text-lime-400" />} onClose={onClose} wide>
      {detail ? (
        <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-3">
          <button onClick={() => setDetail(null)} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100 transition"><ChevronLeft size={16} /> К списку</button>
          <span className="text-xs bg-lime-400/15 text-lime-400 rounded-full px-2.5 py-1 inline-block">{GOAL_LABELS[detail.goal]}</span>
          <p className="text-sm text-zinc-300">{detail.description}</p>
          <div className="space-y-2">
            {detail.days.map((d, i) => (
              <div key={i} className="bg-zinc-800/40 rounded-lg px-3 py-2">
                <p className="text-sm font-medium mb-1">{d.name}</p>
                <p className="text-xs text-zinc-500">{d.exercises.map((e) => e.name).join(", ")}</p>
              </div>
            ))}
          </div>
          <button onClick={() => clone(detail)} disabled={cloning} className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:bg-lime-300 transition disabled:opacity-50 flex items-center justify-center gap-1.5"><Plus size={16} /> {cloning ? "Клонирую..." : "Клонировать клиенту"}</button>
        </div>
      ) : (
        <>
          <div className="p-3 border-b border-zinc-800 flex gap-1.5 overflow-x-auto shrink-0">
            {(["Все", "масса", "сушка", "сфп"] as const).map((g) => (
              <button key={g} onClick={() => setGoal(g)} className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${goal === g ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"}`}>{g === "Все" ? "Все" : GOAL_LABELS[g]}</button>
            ))}
          </div>
          <div className="p-3 overflow-y-auto flex-1 min-h-0 space-y-1.5">
            {filtered.map((p) => (
              <button key={p.id} onClick={() => setDetail(p)} className="w-full text-left flex items-center gap-2 bg-zinc-800/40 rounded-lg px-3 py-2.5 hover:bg-zinc-800/70 transition">
                <div className="flex-1 min-w-0"><p className="text-sm font-medium">{p.name}</p><p className="text-[11px] text-zinc-500 truncate">{p.description}</p></div>
                <span className="text-xs bg-lime-400/15 text-lime-400 rounded-full px-2 py-0.5 shrink-0">{GOAL_LABELS[p.goal]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </ModalShell>
  );
}
