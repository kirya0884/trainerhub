import { useEffect, useRef, useState } from "react";
import { ClipboardList, Search, Users, X } from "lucide-react";
import type { ClientListItem, PlanOverviewItem } from "../lib/clients";

// B04: единый поиск по подопечным и планам. Отдельный оверлей, а не поле в шапке —
// строку шапки четырьмя пунктами подряд расчищали (B23, B27, B28, B30), и возвращать
// туда постоянный инпут значило бы обнулить эту работу.
export default function SearchOverlay({ clients, plans, onOpenClient, onOpenPlan, onClose }: {
  clients: ClientListItem[];
  plans: PlanOverviewItem[];
  onOpenClient: (id: string) => void;
  onOpenPlan: (planId: string, clientId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const term = q.trim().toLowerCase();
  // ponytail: подстрока без нечёткого поиска. У самого крупного тренера 18 подопечных
  // и 16 планов — библиотека ради этого не нужна.
  const foundClients = term ? clients.filter((c) => c.name.toLowerCase().includes(term) || c.goal.toLowerCase().includes(term)).slice(0, 8) : [];
  const foundPlans = term ? plans.filter((p) => p.name.toLowerCase().includes(term) || p.clientName.toLowerCase().includes(term)).slice(0, 8) : [];
  const nothing = term.length > 0 && !foundClients.length && !foundPlans.length;

  return (
    <div className="fixed inset-0 z-[60] bg-zinc-950/95 backdrop-blur-sm flex flex-col" role="dialog" aria-label="Поиск">
      <div className="max-w-2xl w-full mx-auto px-3 sm:px-4 py-4 flex flex-col min-h-0 flex-1">
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex-1 flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
            <Search size={16} className="text-zinc-500 shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Подопечный или план..."
              aria-label="Поиск по подопечным и планам"
              className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            {q && <button onClick={() => setQ("")} aria-label="Очистить" className="p-1 text-zinc-600 hover:text-zinc-300 transition shrink-0"><X size={14} /></button>}
          </div>
          <button onClick={onClose} className="shrink-0 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-100 transition">Отмена</button>
        </div>

        <div className="flex-1 overflow-y-auto mt-3 space-y-4 min-h-0">
          {!term && <p className="text-sm text-zinc-600 text-center py-10">Начните вводить имя подопечного или название плана</p>}
          {nothing && <p className="text-sm text-zinc-600 text-center py-10">Ничего не найдено</p>}

          {foundClients.length > 0 && (
            <div>
              <p className="text-xs font-semibold tracking-widest text-zinc-500 mb-2 flex items-center gap-1.5"><Users size={12} /> ПОДОПЕЧНЫЕ</p>
              <div className="space-y-1.5">
                {foundClients.map((c) => (
                  <button key={c.id} onClick={() => { onOpenClient(c.id); onClose(); }} className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-left hover:border-zinc-700 transition">
                    {c.avatarUrl
                      ? <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                      : <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-zinc-950 shrink-0" style={{ background: c.color }}>{c.name[0]?.toUpperCase()}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-zinc-100 truncate">{c.name}</span>
                      {c.goal && <span className="block text-xs text-zinc-500 truncate">{c.goal}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {foundPlans.length > 0 && (
            <div>
              <p className="text-xs font-semibold tracking-widest text-zinc-500 mb-2 flex items-center gap-1.5"><ClipboardList size={12} /> ПЛАНЫ</p>
              <div className="space-y-1.5">
                {foundPlans.map((p) => (
                  <button key={p.id} onClick={() => { onOpenPlan(p.id, p.clientId); onClose(); }} className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-left hover:border-zinc-700 transition">
                    <span className="w-1.5 h-8 rounded-full shrink-0" style={{ background: p.clientColor }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-zinc-100 truncate">{p.name}</span>
                      <span className="block text-xs text-zinc-500 truncate">{p.clientName}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
