import { CheckCircle2, Eye, Flame, X } from "lucide-react";
import { fmtDate } from "../lib/format";
import { MOOD_EMOJI, WELL_EMOJI } from "../constants";
import type { Session } from "../types";

/** Просмотр пройденной тренировки: план (зачёркнут) + факт рядом. Read-only. */
export default function SessionReadModal({ session, onClose }: { session: Session; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
      <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Eye size={16} className="text-lime-400 shrink-0" />
            <h2 className="font-bold truncate">{session.dayName || "Тренировка"}</h2>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{fmtDate(session.date)} · {session.done}/{session.total} упр.{session.fromClient && <span className="ml-1.5 text-cyan-400">клиент</span>}</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 shrink-0"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-2xl w-full mx-auto space-y-3">
        {(session.items ?? []).map((item, idx) => {
          const hasActual = item.actualSets?.length;
          const hasPlanned = item.plannedSets?.length;
          const maxRows = Math.max(item.plannedSets?.length ?? 0, item.actualSets?.length ?? 0);

          return (
            <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-sm">
                  <span className="text-lime-400 mr-1.5">{idx + 1}</span>{item.name}
                </h3>
                {item.effort > 0 && (
                  <div className="flex gap-0.5 shrink-0">
                    {Array.from({ length: item.effort }).map((_, k) => (
                      <Flame key={k} size={13} className="text-orange-400" fill="#fb923c" />
                    ))}
                  </div>
                )}
              </div>

              {/* Заголовки колонок */}
              {(hasPlanned || hasActual) && maxRows > 0 && (
                <div className="flex items-center gap-2 text-[10px] text-zinc-600 uppercase tracking-wide px-0.5">
                  <span className="w-5" />
                  <span className="w-4 text-center">#</span>
                  <span className="flex-1 text-center">план</span>
                  <span className="text-zinc-700">→</span>
                  <span className="flex-1 text-center">факт</span>
                </div>
              )}

              {/* Подходы */}
              {Array.from({ length: maxRows }).map((_, i) => {
                const planned = item.plannedSets?.[i];
                const actual = item.actualSets?.[i];
                const weightChanged = planned && actual && actual.weight && actual.weight !== planned.weight;
                const repsChanged = planned && actual && actual.reps && actual.reps !== planned.reps;

                return (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 size={16} className="text-zinc-700 shrink-0" />
                    <span className="text-xs text-zinc-500 w-4 text-center shrink-0">{i + 1}</span>

                    {/* Плановые значения */}
                    <div className="flex-1 flex items-center justify-center gap-1 text-center">
                      {planned ? (
                        <span className={`text-zinc-500 ${(weightChanged || repsChanged) ? "line-through" : ""}`}>
                          {planned.reps || "—"} × {planned.weight || "—"} кг
                        </span>
                      ) : <span className="text-zinc-700">—</span>}
                    </div>

                    <span className="text-zinc-700 text-xs">→</span>

                    {/* Фактические значения */}
                    <div className="flex-1 flex items-center justify-center gap-1 text-center">
                      {actual ? (
                        <span className={weightChanged || repsChanged ? "text-cyan-400 font-semibold" : "text-zinc-300"}>
                          {actual.reps || "—"} × {actual.weight || "—"} кг
                        </span>
                      ) : <span className="text-zinc-700">—</span>}
                    </div>
                  </div>
                );
              })}

              {/* Если данных по подходам нет — показываем plannedSummary */}
              {!hasPlanned && !hasActual && item.plannedSummary && (
                <p className="text-sm text-zinc-500">{item.plannedSummary}</p>
              )}

              {item.note && <p className="text-xs text-zinc-500 bg-zinc-800/50 rounded-md px-2.5 py-1.5">{item.note}</p>}
            </div>
          );
        })}

        {/* Итоги */}
        {(session.mood > 0 || session.wellbeing > 0 || session.review || session.clientRating > 0) && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
            <p className="text-sm font-semibold text-zinc-300">После тренировки</p>
            {session.mood > 0 && <p className="text-sm text-zinc-400">Настроение: <span className="text-lg">{MOOD_EMOJI[session.mood - 1]}</span></p>}
            {session.wellbeing > 0 && <p className="text-sm text-zinc-400">Самочувствие: <span className="text-lg">{WELL_EMOJI[session.wellbeing - 1]}</span></p>}
            {session.clientRating > 0 && <p className="text-sm text-zinc-400">Оценка: <span className="text-lime-400 font-semibold">{session.clientRating}/5</span></p>}
            {session.review && <p className="text-sm text-zinc-300 bg-zinc-800/60 rounded-lg p-2.5 whitespace-pre-wrap">{session.review}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
