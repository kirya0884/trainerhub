import { ChevronRight, HeartPulse, Play, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { GOALS } from "../constants";
import * as api from "../lib/clients";
import type { ClientListItem } from "../lib/clients";
import RemainingBadge from "./RemainingBadge";

export default function ClientsList({ trainerId, onOpenClient }: { trainerId: string; onOpenClient: (id: string) => void }) {
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(GOALS[0]);

  const [search, setSearch] = useState("");

  const load = () => api.fetchClients(trainerId).then(setClients);
  useEffect(() => { load(); }, [trainerId]);

  const submit = async () => {
    if (!name.trim()) return;
    await api.addClient(trainerId, name.trim(), goal, clients?.length ?? 0);
    setName(""); setGoal(GOALS[0]); setShowForm(false);
    load();
  };

  if (!clients) return <div className="text-zinc-500 text-sm p-4">Загрузка...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Подопечные <span className="text-zinc-600 font-normal">({clients.length})</span></h2>
        <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 py-2 hover:bg-lime-300 transition text-sm"><Plus size={16} /> Добавить</button>
      </div>
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени..." className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-8 pr-3 py-2 text-sm outline-none focus:border-zinc-700 placeholder:text-zinc-600" />
      </div>
      {showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4 space-y-3">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Имя подопечного" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50" />
          <select value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50">
            {GOALS.map((g) => <option key={g}>{g}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={submit} className="flex-1 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2 text-sm hover:bg-lime-300 transition">Сохранить</button>
            <button onClick={() => setShowForm(false)} className="px-4 bg-zinc-800 rounded-lg py-2 text-sm text-zinc-400 hover:text-zinc-100 transition">Отмена</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {clients.length === 0 && <p className="text-zinc-600 text-sm text-center py-8">Добавь первого подопечного, чтобы привязывать к нему планы</p>}
        {clients.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.toLowerCase())).map((c) => (
          <button key={c.id} onClick={() => onOpenClient(c.id)} className={`w-full text-left flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700 transition ${c.status === "left" ? "opacity-50" : ""}`}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-zinc-950 shrink-0" style={{ background: c.color }}>{c.name.charAt(0).toUpperCase()}</div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate flex items-center gap-1.5">
                <RemainingBadge remaining={c.remaining} />
                {c.name}
                {c.hasHealthFlags && <HeartPulse size={13} className="text-amber-400 shrink-0" />}
                {c.status === "paused" && <span className="text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-400 rounded px-1.5 py-0.5 shrink-0">пауза</span>}
                {c.status === "left" && <span className="text-[10px] uppercase tracking-wide bg-zinc-700 text-zinc-400 rounded px-1.5 py-0.5 shrink-0">ушёл</span>}
                {!!c.activeSession && <span className="text-[10px] uppercase tracking-wide bg-cyan-400/15 text-cyan-400 rounded px-1.5 py-0.5 shrink-0 flex items-center gap-1"><Play size={10} /> тренируется</span>}
              </p>
              <p className="text-xs text-zinc-500">{c.goal}</p>
            </div>
            <ChevronRight size={18} className="text-zinc-600 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
