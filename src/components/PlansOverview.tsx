import { useEffect, useState } from "react";
import { loadViewState, saveViewState } from "../lib/viewState";
import { logEvent } from "../lib/events";
import { useScrollRestore } from "../hooks/useScrollRestore";
import { ClipboardList, Copy, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import PlanCreateModal from "./PlanCreateModal";
import * as api from "../lib/clients";
import { duplicatePlan } from "../lib/plans";
import type { PlanOverviewItem, ClientListItem } from "../lib/clients";
import RemainingBadge from "./RemainingBadge";

// Глобальная вкладка «Планы» — все программы тренера со всех клиентов в одном месте.
export default function PlansOverview({ trainerId, clients, plans, reloadPlans, onOpenPlan, autoFocusNew }: {
  trainerId: string; clients: ClientListItem[]; plans: PlanOverviewItem[] | null; reloadPlans: () => void; onOpenPlan: (planId: string, clientId: string) => void; autoFocusNew?: boolean;
}) {
  // B12: поисковый запрос переживает переключение вкладки
  const [query, setQuery] = useState(() => loadViewState("plans-query", ""));
  const [newClientId, setNewClientId] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { saveViewState("plans-query", query); }, [query]);
  // B16: поиск логируем с задержкой — иначе событие на каждую букву
  useEffect(() => { if (!query.trim()) return; const t = setTimeout(() => logEvent(trainerId, "search", "plans", { len: query.trim().length }), 1200); return () => clearTimeout(t); }, [query, trainerId]);
  useScrollRestore("plans", !!plans);
  // B04: планы подняты в App вместе с клиентами и записями — раздел больше не грузит их сам.
  const load = reloadPlans;

  const createPlan = async () => {
    if (!newClientId || !newName.trim()) return;
    try {
      const row = await api.addPlan(trainerId, newClientId, newName.trim());
      setNewName("");
      onOpenPlan(row.id, newClientId);
    } catch (e) { console.error("[PlansOverview] createPlan:", e); alert("Не удалось создать план."); }
  };
  // B06: дубликат создаётся вместе с блоками, днями, упражнениями и подходами.
  const [dupId, setDupId] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const duplicate = async (p: PlanOverviewItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (dupId) return;
    setDupId(p.id);
    try {
      await duplicatePlan(trainerId, p.clientId, p.id, `${p.name} (копия)`);
      reloadPlans();
    } catch (err) { console.error("[PlansOverview] duplicate:", err); alert("Не удалось дублировать план."); }
    finally { setDupId(null); }
  };
  const deletePlan = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Удалить план «${name}»? Его можно восстановить из корзины.`)) return;
    try { await api.deletePlan(id); load(); }
    catch (err) { console.error("[PlansOverview] deletePlan:", err); alert("Не удалось удалить план."); }
  };

  const wizardClient = clients.find((c) => c.id === newClientId);
  const q = query.trim().toLowerCase();
  const filtered = (plans ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      {wizard && wizardClient && (
        <PlanCreateModal
          trainerId={trainerId}
          clientId={wizardClient.id}
          clientName={wizardClient.name}
          allPlans={plans ?? []}
          onCreated={(planId) => { setWizard(false); reloadPlans(); onOpenPlan(planId, wizardClient.id); }}
          onClose={() => setWizard(false)}
        />
      )}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
        <p className="text-sm text-zinc-400">Новый план</p>
        <div className="flex flex-wrap gap-2">
          <select value={newClientId} onChange={(e) => setNewClientId(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50">
            <option value="">Выбери подопечного...</option>
            {clients.map((c) => <option key={c.id} value={c.id} className="bg-zinc-900">{c.name}</option>)}
          </select>
          <input autoFocus={autoFocusNew} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createPlan()} placeholder="Название плана" className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50" />
          <button onClick={() => setWizard(true)} disabled={!newClientId} title="Создать из готовой программы или копии" className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm transition disabled:opacity-40 shrink-0"><Sparkles size={15} className="text-lime-400" /> Из готового</button>
          <button onClick={createPlan} disabled={!newClientId || !newName.trim()} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 py-2 text-sm hover:bg-lime-300 transition disabled:opacity-40 shrink-0"><Plus size={15} /> Создать</button>
        </div>
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по названию плана или подопечному..." className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none focus:border-lime-400/50" />
      </div>

      {error ? (
        <p className="text-red-400 text-sm text-center py-10">{error}</p>
      ) : plans === null ? (
        <p className="text-zinc-500 text-sm">Загрузка...</p>
      ) : filtered.length === 0 ? (
        <p className="text-zinc-600 text-sm text-center py-10">{plans.length === 0 ? "Планов пока нет. Создай первый выше." : "Ничего не найдено"}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <button key={p.id} onClick={() => onOpenPlan(p.id, p.clientId)} className="w-full text-left bg-zinc-900 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700 transition flex items-center gap-3">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.clientColor }} />
              <span className="flex-1 min-w-0">
                <span className="font-medium truncate flex items-center gap-1.5"><ClipboardList size={14} className="text-zinc-500 shrink-0" /> {p.name}</span>
                <span className="block text-xs text-zinc-500 truncate flex items-center gap-1">
                  <RemainingBadge remaining={p.clientRemaining} /> {p.clientName}
                </span>
              </span>
              {p.archived && <span className="text-[10px] uppercase tracking-wide bg-zinc-700 text-zinc-400 rounded px-1.5 py-0.5 shrink-0">архив</span>}
              <span onClick={(e) => duplicate(p, e)} className={`p-1 rounded hover:bg-zinc-700 hover:text-zinc-200 text-zinc-500 transition shrink-0 ${dupId === p.id ? "opacity-40" : ""}`} title="Дублировать план"><Copy size={14} /></span>
              <span onClick={(e) => deletePlan(p.id, p.name, e)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0" title="Удалить"><Trash2 size={14} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
