import { History, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import * as versionsApi from "../lib/planVersions";
import type { PlanVersion } from "../lib/planVersions";
import { fmtDate } from "../lib/format";
import ModalShell from "./ModalShell";

export default function PlanVersionsModal({ planId, onClose, onRestored }: { planId: string; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<PlanVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => { setError(""); versionsApi.fetchPlanVersions(planId).then(setVersions).catch((e) => setError(e.message || "Не удалось загрузить версии")); };
  useEffect(load, [planId]);

  const save = async () => {
    const label = window.prompt("Название версии (необязательно):", `Версия от ${fmtDate(new Date().toISOString().slice(0, 10))}`) ?? "";
    setBusy(true);
    try { await versionsApi.snapshotPlan(planId, label); load(); } catch (e: any) { setError(e.message || "Не удалось сохранить версию"); } finally { setBusy(false); }
  };
  const restore = async (v: PlanVersion) => {
    if (!window.confirm(`Откатить план к версии «${v.label || fmtDate(v.createdAt.slice(0, 10))}»? Текущее содержимое дней будет заменено (саму версию можно сохранить перед откатом).`)) return;
    setBusy(true);
    try { await versionsApi.restorePlanVersion(planId, v); onRestored(); } catch (e: any) { setError(e.message || "Не удалось восстановить версию"); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { try { await versionsApi.deletePlanVersion(id); load(); } catch (e: any) { setError(e.message || "Не удалось удалить версию"); } };

  return (
    <ModalShell title="История версий плана" icon={<History size={17} className="text-lime-400" />} onClose={onClose}
      footer={(
        <div className="p-3 border-t border-zinc-800 shrink-0">
          <button onClick={save} disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:bg-lime-300 transition disabled:opacity-50"><Save size={15} /> Сохранить текущую версию</button>
        </div>
      )}>
      <div className="p-3 overflow-y-auto flex-1 min-h-0 space-y-1.5">
        {error && <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
        {versions === null && !error && <p className="text-sm text-zinc-500">Загрузка...</p>}
        {versions?.length === 0 && <p className="text-sm text-zinc-600 text-center py-6">Версий пока нет. Сохраните текущее состояние плана, чтобы можно было к нему вернуться.</p>}
        {versions?.map((v) => (
          <div key={v.id} className="flex items-center gap-2 bg-zinc-800/40 rounded-lg px-3 py-2.5">
            <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{v.label || "Без названия"}</p><p className="text-[11px] text-zinc-500">{fmtDate(v.createdAt.slice(0, 10))} · {v.days.length} дн.</p></div>
            <button onClick={() => restore(v)} disabled={busy} className="p-1.5 rounded-md bg-cyan-400/15 text-cyan-400 hover:bg-cyan-400/25 transition shrink-0" title="Откатить к этой версии"><RotateCcw size={15} /></button>
            <button onClick={() => remove(v.id)} disabled={busy} className="p-1.5 rounded-md hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0" title="Удалить версию"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
