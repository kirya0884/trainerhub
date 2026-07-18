import { useEffect, useState } from "react";
import { RotateCcw, Trash2, Trash } from "lucide-react";
import ModalShell from "./ModalShell";
import * as api from "../lib/clients";
import type { DeletedItem } from "../lib/clients";

export default function TrashModal({ trainerId, onClose }: { trainerId: string; onClose: () => void }) {
  const [clients, setClients] = useState<DeletedItem[]>([]);
  const [plans, setPlans] = useState<DeletedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => Promise.all([api.fetchDeletedClients(trainerId), api.fetchDeletedPlans(trainerId)])
    .then(([c, p]) => { setClients(c); setPlans(p); setLoading(false); })
    .catch((e) => { setLoading(false); console.error("[TrashModal] load:", e); });
  useEffect(() => { load(); }, [trainerId]);

  const restoreClient = async (id: string) => { try { await api.restoreClient(id); load(); } catch (e) { console.error("[TrashModal] restoreClient:", e); alert("Не удалось восстановить."); } };
  const purgeClient = async (id: string, name: string) => {
    if (!window.confirm(`Удалить «${name}» навсегда? Это действие необратимо — пропадут все планы, замеры, фото и платежи.`)) return;
    try { await api.permanentlyDeleteClient(id); load(); } catch (e) { console.error("[TrashModal] purgeClient:", e); alert("Не удалось удалить."); }
  };
  const restorePlan = async (id: string) => { try { await api.restorePlan(id); load(); } catch (e) { console.error("[TrashModal] restorePlan:", e); alert("Не удалось восстановить."); } };
  const purgePlan = async (id: string, name: string) => {
    if (!window.confirm(`Удалить план «${name}» навсегда? Это действие необратимо.`)) return;
    try { await api.permanentlyDeletePlan(id); load(); } catch (e) { console.error("[TrashModal] purgePlan:", e); alert("Не удалось удалить."); }
  };

  return (
    <ModalShell title="Корзина" icon={<Trash size={17} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-4 text-sm overflow-y-auto">
        {loading && <p className="text-zinc-500">Загрузка...</p>}
        {!loading && clients.length === 0 && plans.length === 0 && <p className="text-zinc-600 text-center py-6">Корзина пуста</p>}

        {clients.length > 0 && (
          <div>
            <p className="text-zinc-400 mb-2">Удалённые подопечные</p>
            <div className="space-y-1.5">
              {clients.map((c) => (
                <div key={c.id} className="flex items-center gap-2 bg-zinc-800/60 rounded-lg px-3 py-2">
                  <span className="flex-1 truncate">{c.name}</span>
                  <button onClick={() => restoreClient(c.id)} className="p-1.5 rounded hover:bg-lime-400/20 hover:text-lime-400 text-zinc-500 transition" title="Восстановить"><RotateCcw size={15} /></button>
                  <button onClick={() => purgeClient(c.id, c.name)} className="p-1.5 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition" title="Удалить навсегда"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {plans.length > 0 && (
          <div>
            <p className="text-zinc-400 mb-2">Удалённые планы</p>
            <div className="space-y-1.5">
              {plans.map((p) => (
                <div key={p.id} className="flex items-center gap-2 bg-zinc-800/60 rounded-lg px-3 py-2">
                  <span className="flex-1 truncate">{p.name}</span>
                  <button onClick={() => restorePlan(p.id)} className="p-1.5 rounded hover:bg-lime-400/20 hover:text-lime-400 text-zinc-500 transition" title="Восстановить"><RotateCcw size={15} /></button>
                  <button onClick={() => purgePlan(p.id, p.name)} className="p-1.5 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition" title="Удалить навсегда"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
