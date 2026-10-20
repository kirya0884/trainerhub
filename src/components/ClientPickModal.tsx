import { useState } from "react";
import { Check, Search, UserPlus } from "lucide-react";
import ModalShell from "./ModalShell";
import { SkeletonRows } from "./Skeleton";

export type PickClient = { id: string; name: string; color: string; avatarUrl?: string; remaining?: string | null };

/**
 * Выбор подопечных для совместной тренировки: один (тап — сразу выбран) или несколько
 * (отметки + кнопка). Поиск без автофокуса — клавиатура не выезжает сама.
 */
export default function ClientPickModal({ candidates, multi = false, max = 3, title, onPick, onClose }: {
  candidates: PickClient[] | null; multi?: boolean; max?: number; title: string;
  onPick: (picked: PickClient[]) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const term = q.trim().toLowerCase();
  const list = (candidates ?? []).filter((c) => !term || c.name.toLowerCase().includes(term));
  const toggle = (c: PickClient) => {
    if (!multi) { onPick([c]); return; }
    setSel((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : s.length >= max ? s : [...s, c.id]));
  };
  const picked = (candidates ?? []).filter((c) => sel.includes(c.id));

  return (
    <ModalShell title={title} icon={<UserPlus size={16} className="text-lime-400" />} onClose={onClose}
      footer={multi ? (
        <div className="p-3 border-t border-zinc-800 shrink-0">
          <button onClick={() => picked.length && onPick(picked)} disabled={!picked.length}
            className="w-full h-12 rounded-xl bg-lime-400 text-zinc-950 font-bold disabled:opacity-40 active:scale-[0.98] transition">
            {picked.length ? `Начать вместе · ${picked.length + 1} чел.` : `Отметьте до ${max} подопечных`}
          </button>
        </div>
      ) : undefined}>
      <div className="p-3 space-y-2">
        <label className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 h-11">
          <Search size={16} className="text-zinc-500 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск подопечного" className="flex-1 min-w-0 bg-transparent outline-none" />
        </label>
        {!candidates && <SkeletonRows rows={3} />}
        {candidates && list.length === 0 && <p className="text-sm text-zinc-500 text-center py-4">Никого не найдено</p>}
        <div className="space-y-1">
          {list.map((c) => {
            const on = sel.includes(c.id);
            return (
              <button key={c.id} onClick={() => toggle(c)} aria-pressed={multi ? on : undefined}
                className={`w-full flex items-center gap-3 px-2 h-14 rounded-xl text-left transition ${on ? "bg-lime-400/10" : "hover:bg-zinc-800"}`}>
                <span className="w-10 h-10 rounded-full shrink-0 overflow-hidden flex items-center justify-center text-sm font-bold text-zinc-950" style={{ background: c.avatarUrl ? undefined : c.color }}>
                  {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="w-full h-full object-cover" /> : c.name.charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 min-w-0 font-semibold truncate">{c.name}</span>
                {multi && <span className={`w-6 h-6 rounded-lg shrink-0 flex items-center justify-center ${on ? "bg-lime-400 text-zinc-950" : "border-2 border-zinc-600"}`}>{on && <Check size={16} strokeWidth={3} />}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </ModalShell>
  );
}
