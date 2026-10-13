import { UserX } from "lucide-react";
import { useState } from "react";
import ModalShell from "./ModalShell";

export const NO_SHOW_REASONS = ["Уважительная", "Проспал", "Забыл", "Другое"] as const;
export type NoShowReason = (typeof NO_SHOW_REASONS)[number];

// «Не пришёл»: причина у каждого подопечного своя. Списываем всё, кроме уважительной —
// так же, как при удалении тренировки (DeleteSessionModal).
export default function NoShowModal({ clients, onConfirm, onClose }: {
  clients: { id: string; name: string }[]; onConfirm: (reasons: Record<string, NoShowReason>) => void | Promise<void>; onClose: () => void;
}) {
  const [reasons, setReasons] = useState<Record<string, NoShowReason>>({});
  const [busy, setBusy] = useState(false);
  const ready = clients.every((c) => reasons[c.id]);
  const submit = async () => { if (!ready || busy) return; setBusy(true); try { await onConfirm(reasons); } finally { setBusy(false); } };

  return (
    <ModalShell title="Не пришёл" icon={<UserX size={16} className="text-orange-400" />} onClose={onClose}>
      <div className="p-4 space-y-4">
        <p className="text-sm text-zinc-400">Тренировка спишется с абонемента. При уважительной причине — не спишется.</p>
        {clients.map((c) => (
          <div key={c.id} className="space-y-2">
            {clients.length > 1 && <p className="font-semibold">{c.name}</p>}
            <div className="grid grid-cols-2 gap-2">
              {NO_SHOW_REASONS.map((r) => (
                <button key={r} onClick={() => setReasons((p) => ({ ...p, [c.id]: r }))} aria-pressed={reasons[c.id] === r}
                  className={`h-10 rounded-xl text-sm font-semibold transition ${reasons[c.id] === r ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>{r}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 p-4 border-t border-zinc-800">
        <button onClick={onClose} className="flex-1 h-11 bg-zinc-800 rounded-xl text-sm font-semibold text-zinc-300 hover:text-zinc-100 transition">Отмена</button>
        <button onClick={submit} disabled={!ready || busy} className="flex-1 h-11 bg-lime-400 text-zinc-950 font-bold rounded-xl text-sm hover:bg-lime-300 transition disabled:opacity-40">{busy ? "Сохраняю…" : "Отметить"}</button>
      </div>
    </ModalShell>
  );
}
