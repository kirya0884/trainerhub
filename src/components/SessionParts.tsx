import { Check, Flame, Layers } from "lucide-react";
import { tonnageOf } from "../lib/sessionUtils";
import type { Exercise } from "../types";

// Общие куски экранов проведения тренировки: у тренера (SessionModal), у клиента
// (ClientSessionView) и в группе (GroupSessionModal) — чтобы вели себя одинаково.

type SetVal = { weight: string; reps: string };
export { tonnageOf };
// Только то, что читает блок суперсета — у тренера и клиента состояние подхода чуть разное
type ExMeta = { note?: string; fires?: Record<number, number>; setsDone?: Record<number, boolean> };


export function FlameRate({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(value === n ? 0 : n)} className="p-0.5 transition" title={`${n} из 5`}>
          <Flame size={18} className={n <= value ? "text-orange-400" : "text-zinc-700"} fill={n <= value ? "#fb923c" : "none"} />
        </button>
      ))}
    </div>
  );
}

/**
 * Суперсет в проведении тренировки — подходы по очереди: 1-й подход первого
 * упражнения, 1-й второго, затем 2-й первого и т. д. Раньше каждое упражнение
 * показывало все свои подходы подряд, и порядок выполнения не читался.
 */
export function SupersetRounds({ title, color, items, labels, vals, meta, onSetVal, onTapSet, onFire, onNote }: {
  title: string; color: string; items: Exercise[]; labels: string[];
  vals: Record<string, SetVal[]>; meta: Record<string, ExMeta | undefined>;
  onSetVal: (exId: string, i: number, patch: Partial<SetVal>) => void;
  onTapSet: (ex: Exercise, i: number, total: number) => void;
  onFire: (exId: string, i: number, v: number) => void;
  onNote: (exId: string, note: string) => void;
}) {
  const named = items.filter((ex) => ex.name);
  const rounds = Math.max(0, ...named.map((ex) => (vals[ex.id] || []).length));
  // Текущий подход — первый, где есть неотмеченное
  const current = Array.from({ length: rounds }, (_, r) => r)
    .find((r) => named.some((ex) => r < (vals[ex.id] || []).length && !meta[ex.id]?.setsDone?.[r]));
  const tonnage = named.reduce((s, ex) => s + (ex.kind === "functional" ? 0 : tonnageOf(vals[ex.id] || [], meta[ex.id]?.setsDone)), 0);

  return (
    <div className="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
      <div className="pl-4 pr-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color }}>
          <Layers size={13} /> {title}
          {tonnage > 0 && <span className="ml-auto text-zinc-400 font-semibold">{Math.round(tonnage).toLocaleString("ru-RU")} кг</span>}
        </div>
        <p className="text-sm font-semibold mt-1 leading-snug">
          {named.map((ex, k) => <span key={ex.id}>{k > 0 && <span className="text-zinc-600"> · </span>}<span style={{ color }}>{labels[items.indexOf(ex)]}</span> {ex.name}</span>)}
        </p>
      </div>

      {Array.from({ length: rounds }, (_, r) => (
        <div key={r} className={`pl-4 pr-3 py-2 border-t border-zinc-800 ${r === current ? "bg-lime-400/5" : ""}`}>
          <div className="grid grid-cols-[1fr_3.5rem_3.5rem_2.5rem] gap-1.5 items-center text-[11px] text-zinc-500 mb-1">
            <span className={`font-semibold ${r === current ? "text-lime-400" : ""}`}>Подход {r + 1}</span>
            <span className="text-center">Повт.</span><span className="text-center">Кг</span><span />
          </div>
          <div className="space-y-1.5">
            {named.map((ex) => {
              const rows = vals[ex.id] || [];
              if (r >= rows.length) return null;
              const row = rows[r];
              const md = meta[ex.id];
              const isDone = md?.setsDone?.[r] ?? false;
              const showFire = ex.kind !== "functional" && r >= rows.length - 2;
              return (
                <div key={ex.id}>
                  <div className="grid grid-cols-[1fr_3.5rem_3.5rem_2.5rem] gap-1.5 items-center">
                    <span className={`min-w-0 truncate text-sm font-medium ${isDone ? "text-zinc-500" : ""}`}>
                      <span className="font-bold mr-1" style={{ color }}>{labels[items.indexOf(ex)]}</span>{ex.name}
                    </span>
                    {ex.kind === "functional" ? (
                      <span className="col-span-2 text-xs text-zinc-400 text-center truncate">{[ex.duration, ex.weight].filter(Boolean).join(" · ") || "функц."}</span>
                    ) : (
                      <>
                        <input value={row.reps} onChange={(e) => onSetVal(ex.id, r, { reps: e.target.value })} inputMode="text" placeholder="повт" aria-label={`${ex.name}, подход ${r + 1}: повторы`}
                          className={`h-10 w-full min-w-0 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                        <input value={row.weight} onChange={(e) => onSetVal(ex.id, r, { weight: e.target.value })} inputMode="decimal" placeholder="кг" aria-label={`${ex.name}, подход ${r + 1}: вес`}
                          className={`h-10 w-full min-w-0 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                      </>
                    )}
                    <button onClick={() => onTapSet(ex, r, rows.length)} aria-pressed={isDone} aria-label={isDone ? `${ex.name}: снять отметку с подхода ${r + 1}` : `${ex.name}: подход ${r + 1} выполнен`}
                      className={`h-10 w-10 rounded-xl flex items-center justify-center transition active:scale-95 ${isDone ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>
                      <Check size={20} strokeWidth={2.5} />
                    </button>
                  </div>
                  {showFire && (
                    <div className="flex items-center gap-1.5 pl-1">
                      <span className="text-xs text-zinc-500">Усилие</span>
                      <FlameRate value={md?.fires?.[r] || 0} onChange={(v) => onFire(ex.id, r, v)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="pl-4 pr-3 py-2 border-t border-zinc-800 space-y-1.5">
        {named.map((ex) => (
          <input key={ex.id} value={meta[ex.id]?.note || ""} onChange={(e) => onNote(ex.id, e.target.value)} placeholder={`Примечание: ${ex.name}`}
            className="w-full bg-zinc-800/60 rounded-lg px-3 h-9 outline-none focus:ring-2 focus:ring-lime-400/40" />
        ))}
      </div>
    </div>
  );
}
