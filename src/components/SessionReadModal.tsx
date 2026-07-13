import { CheckCircle2, ChevronDown, ChevronRight, Circle, Eye, Flame, Layers, X } from "lucide-react";
import { useState } from "react";
import { fmtDate } from "../lib/format";
import { GROUP_COLORS, MOOD_EMOJI, WELL_EMOJI } from "../constants";
import type { Session } from "../types";

const SUPERSET_NAME: Record<number, string> = { 2: "Двусет", 3: "Трисет" };

/** Просмотр пройденной тренировки. Read-only, карточки раскрываются/скрываются. */
export default function SessionReadModal({ session, onClose }: { session: Session; onClose: () => void }) {
  // По умолчанию все раскрыты
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const toggle = (i: number) => setCollapsed((c) => ({ ...c, [i]: !c[i] }));

  const items = session.items ?? [];

  // Группируем подряд идущие упражнения с одинаковой группой (суперсеты)
  // В Session нет group-поля, поэтому каждый item — отдельная карточка
  // (group info не сохраняется в сессии, показываем просто список)

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Eye size={16} className="text-lime-400 shrink-0" />
            <h2 className="font-bold truncate">{session.dayName || "Тренировка"}</h2>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-zinc-500">{fmtDate(session.date)}</span>
            <span className="text-zinc-700 text-xs">·</span>
            <span className="text-xs text-zinc-500">{session.done}/{session.total} упр.</span>
            {session.fromClient && (
              <span className="text-[10px] bg-cyan-400/10 text-cyan-400 rounded-full px-1.5 py-0.5 leading-none">клиент</span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 shrink-0">
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-2xl w-full mx-auto space-y-3">

        {items.length === 0 && (
          <p className="text-zinc-600 text-center py-10">Нет данных об упражнениях.</p>
        )}

        {items.map((item, idx) => {
          const isOpen = !collapsed[idx];
          const hasActual = (item.actualSets?.length ?? 0) > 0;
          const hasPlanned = (item.plannedSets?.length ?? 0) > 0;
          const maxRows = Math.max(item.plannedSets?.length ?? 0, item.actualSets?.length ?? 0);

          // Тоннаж по фактическим подходам
          const tonnage = (item.actualSets ?? []).reduce((sum, r) => {
            const w = parseFloat(r.weight); const rp = parseInt(r.reps);
            return !isNaN(w) && !isNaN(rp) ? sum + w * rp : sum;
          }, 0);

          return (
            <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              {/* Exercise header — клик раскрывает/скрывает */}
              <button
                onClick={() => toggle(idx)}
                className="w-full flex items-center gap-2 px-3 py-2.5 bg-zinc-800/40 text-left"
              >
                {isOpen ? <ChevronDown size={16} className="text-zinc-400 shrink-0" /> : <ChevronRight size={16} className="text-zinc-400 shrink-0" />}
                <span className="text-lime-400 font-semibold text-sm shrink-0">{idx + 1}</span>
                <span className="flex-1 font-semibold text-sm min-w-0 truncate">{item.name || "—"}</span>
                {/* Огонёчки */}
                {item.effort > 0 && (
                  <span className="flex gap-0.5 shrink-0">
                    {Array.from({ length: item.effort }).map((_, k) => (
                      <Flame key={k} size={12} className="text-orange-400" fill="#fb923c" />
                    ))}
                  </span>
                )}
                {item.rpe > 0 && (
                  <span className="text-[10px] bg-cyan-400/10 text-cyan-400 rounded px-1.5 py-0.5 shrink-0">RPE {item.rpe}</span>
                )}
                {tonnage > 0 && (
                  <span className="text-[11px] text-zinc-500 shrink-0">
                    {Math.round(tonnage).toLocaleString("ru-RU")} кг
                  </span>
                )}
              </button>

              {isOpen && (
                <div className="p-3 space-y-1.5">
                  {/* Плановый итог если нет подетальных данных */}
                  {!hasPlanned && !hasActual && item.plannedSummary && (
                    <p className="text-sm text-zinc-400 bg-zinc-800/40 rounded-md px-2.5 py-2">
                      <span className="text-zinc-600 text-xs mr-1.5">план</span>{item.plannedSummary}
                    </p>
                  )}

                  {/* Подходы */}
                  {maxRows > 0 && (
                    <div className="space-y-1.5">
                      {/* Заголовок колонок */}
                      <div className="flex items-center gap-2 text-[10px] text-zinc-600 uppercase tracking-wide px-7">
                        <span className="w-4 text-center">#</span>
                        <span className="w-16 text-center">план</span>
                        <span className="text-zinc-700 px-1">→</span>
                        <span className="w-16 text-center">факт</span>
                      </div>

                      {Array.from({ length: maxRows }).map((_, i) => {
                        const planned = item.plannedSets?.[i];
                        const actual = item.actualSets?.[i];
                        const changed =
                          planned && actual &&
                          (actual.weight !== planned.weight || actual.reps !== planned.reps) &&
                          (actual.weight || actual.reps);

                        return (
                          <div key={i} className="flex items-center gap-2">
                            <CheckCircle2
                              size={16}
                              className={actual?.weight || actual?.reps ? "text-lime-400 shrink-0" : "text-zinc-700 shrink-0"}
                            />
                            <span className="text-xs text-zinc-500 w-4 text-center shrink-0">{i + 1}</span>

                            {/* Плановые */}
                            <div className="w-16 text-center shrink-0">
                              {planned ? (
                                <span className={`text-sm ${changed ? "line-through text-zinc-600" : "text-zinc-300"}`}>
                                  {planned.reps || "—"} × {planned.weight || "—"}
                                </span>
                              ) : (
                                <span className="text-zinc-700 text-sm">—</span>
                              )}
                            </div>

                            <span className="text-zinc-700 text-xs">→</span>

                            {/* Фактические */}
                            <div className="w-16 text-center shrink-0">
                              {actual ? (
                                <span className={`text-sm font-medium ${changed ? "text-cyan-400" : "text-zinc-300"}`}>
                                  {actual.reps || "—"} × {actual.weight || "—"}
                                </span>
                              ) : (
                                <span className="text-zinc-700 text-sm">—</span>
                              )}
                            </div>

                            <span className="text-xs text-zinc-600 shrink-0">кг</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Заметка */}
                  {item.note && (
                    <p className="text-xs text-zinc-400 bg-zinc-800/50 rounded-md px-2.5 py-1.5 mt-1">
                      {item.note}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Итоги тренировки */}
        {(session.mood > 0 || session.wellbeing > 0 || session.review || session.clientRating > 0) && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
            <p className="text-sm font-semibold text-zinc-300">После тренировки</p>
            <div className="flex flex-wrap gap-3 text-sm text-zinc-400">
              {session.mood > 0 && (
                <span>Настроение <span className="text-lg">{MOOD_EMOJI[session.mood - 1]}</span></span>
              )}
              {session.wellbeing > 0 && (
                <span>Самочувствие <span className="text-lg">{WELL_EMOJI[session.wellbeing - 1]}</span></span>
              )}
              {session.clientRating > 0 && (
                <span>Оценка <span className="text-lime-400 font-semibold">{session.clientRating}/5</span></span>
              )}
            </div>
            {session.review && (
              <p className="text-sm text-zinc-300 bg-zinc-800/60 rounded-lg p-2.5 whitespace-pre-wrap">
                {session.review}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
