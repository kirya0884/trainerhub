import { useEffect, useState } from "react";
import { ClipboardList, Plus, Search, Trash2 } from "lucide-react";
import * as api from "../lib/clients";
import type { PlanOverviewItem, ClientListItem } from "../lib/clients";
import RemainingBadge from "./RemainingBadge";

// Глобальная вкладка «Планы» — все программы тренера со всех клиентов в одном месте.
export default function PlansOverview({ trainerId, onOpenPlan }: {
  trainerId: string; onOpenPlan: (planId: string, clientId: string) => void;
}) {
  const [plans, setPlans] = useState<PlanOverviewItem[] | null>(null);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [query, setQuery] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const load = () => api.fetchAllPlans(trainerId).then(setPlans).catch((e) => setError(e.message || "Не удалось загрузить планы"));
  useEffect(() => { load(); }, [trainerId]);
  useEffect(() => { api.fetchClients(trainerId).then(setClients).catch(() => {}); }, [trainerId]);

  const createPlan = async () => {
    if (!newClientId || !newName.trim()) return;
    const row = await api.addPlan(trainerId, newClientId, newName.trim());
    setNewName("");
    onOpenPlan(row.id, newClientId);
  };
  const deletePlan = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Удалить план «${name}»? Его можно восстановить из корзины.`)) return;
    await api.deletePlan(id);
    load();
  };

  const q = query.trim().toLowerCase();
  const filtered = (plans ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
        <p className="text-sm text-zinc-400">Новый план</p>
        <div className="flex flex-wrap gap-2">
          <select value={newClientId} onChange={(e) => setNewClientId(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50">
            <option value="">Выбери подопечного...</option>
            {clients.map((c) => <option key={c.id} value={c.id} className="bg-zinc-900">{c.name}</option>)}
          </select>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createPlan()} placeholder="Название плана" className="flex-1 min-w-[140px] bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50" />
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
              <span onClick={(e) => deletePlan(p.id, p.name, e)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0" title="Удалить"><Trash2 size={14} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
