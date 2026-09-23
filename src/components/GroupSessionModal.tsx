import { CheckCircle2, Circle, Flame, Layers, MessageSquare, Timer, Users, X } from "lucide-react";
import { useModalA11y } from "../hooks/useModalA11y";
import { buildMeta, buildVals, tonnageOf, useSessionSlot, type ExMeta, type SetVal } from "../hooks/useSessionSlot";
import { useEffect, useState } from "react";
import { GROUP_COLORS, MOOD_EMOJI, WELL_EMOJI } from "../constants";
import { parseNum } from "../lib/format";
import { combinedRemaining } from "../lib/clients";
import type { Day, Exercise } from "../types";
import RemainingBadge from "./RemainingBadge";

// Дублируем мелкие хелперы из SessionModal — так уже принято в проекте (без общего модуля под мелкие функции).
const exLabel = (day: Day, idx: number) => {
  const ex = day.exercises[idx];
  if (!ex.group) return `${idx + 1}`;
  let pos = 0;
  for (let i = 0; i <= idx; i++) if (day.exercises[i].group === ex.group) pos++;
  return `${ex.group}${pos}`;
};
const exSummary = (e: Exercise) => {
  if (e.kind === "functional") return [e.duration, e.weight, e.pulseZone ? `пульс ${e.pulseZone}` : ""].filter(Boolean).join(" · ") || "функциональное";
  if (e.detailed && e.setRows?.length) return e.setRows.map((s, i) => `${i + 1}) ${s.weight || "—"}×${s.reps || "—"}`).join(", ");
  let base = `${e.sets}×${e.reps}`;
  if (e.weight) base += ` · ${e.weight}`;
  return base;
};
const SUPERSET_NAME: Record<number, string> = { 2: "Двусет", 3: "Трисет" };
const supersetName = (n: number) => SUPERSET_NAME[n] || "Суперсет";
// Группирует подряд идущие упражнения с одинаковой меткой группы — для единого визуального блока (суперсет).
const groupBlocks = (exercises: Day["exercises"]) => {
  const blocks: { group: string | null; startIdx: number; items: Day["exercises"] }[] = [];
  exercises.forEach((ex, idx) => {
    const last = blocks[blocks.length - 1];
    if (ex.group && last?.group === ex.group) last.items.push(ex);
    else blocks.push({ group: ex.group || null, startIdx: idx, items: [ex] });
  });
  return blocks;
};
// Тоннаж = сумма (вес × повторы) по всем подходам с заполненными числами.
const fmtTonnage = (kg: number) => `${Math.round(kg).toLocaleString("ru-RU")} кг`;

function FlameRate({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(value === n ? 0 : n)} className="transition" title={`${n} из 5`}>
          <Flame size={18} className={n <= value ? "text-orange-400" : "text-zinc-700"} fill={n <= value ? "#fb923c" : "none"} />
        </button>
      ))}
    </div>
  );
}
function EmojiScale({ value, onChange, emojis }: { value: number; onChange: (v: number) => void; emojis: string[] }) {
  return (
    <div className="flex gap-1.5">
      {emojis.map((em, i) => (
        <button key={i} onClick={() => onChange(value === i + 1 ? 0 : i + 1)} className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition ${value === i + 1 ? "bg-lime-400/20 ring-2 ring-lime-400" : "bg-zinc-800 hover:bg-zinc-700 grayscale opacity-70"}`}>{em}</button>
      ))}
    </div>
  );
}



export type SlotClient = { id: string; name: string; color: string; remaining?: string | null };

// Один "слот" — полностью независимая тренировка одного подопечного: свой план/день/веса/повторы.
// Слоты не размонтируются при переключении вкладок (см. ниже className="hidden"), поэтому ввод не теряется.
function ClientSlot({ client, trainerId, active, onFinished }: { client: SlotClient; trainerId: string; active: boolean; onFinished: () => void }) {
  // Д1: всё состояние слота живёт в хуке — так родитель может держать сразу двоих
  // и показывать их подходы рядом, а не по вкладкам.
  const s = useSessionSlot(client.id, trainerId, onFinished);
  const { plans, planId, setPlanId, plan, dayId, setDayId, day, membership, finished, busy,
    vals, meta, setVal, setMetaFor, setFire, mood, setMood, wellbeing, setWellbeing,
    review, setReview, clientRating, setClientRating, doneEx, totalTonnage, finish } = s;

  return (
    <div className={active ? "space-y-3" : "hidden"}>
      {!plans ? (
        <p className="text-zinc-500 text-sm text-center py-10">Загрузка...</p>
      ) : plans.length === 0 ? (
        <p className="text-zinc-600 text-sm text-center py-10">У {client.name} нет планов тренировок.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-lime-400/50">
              {plans.map((p) => <option key={p.id} value={p.id} className="bg-zinc-900">{p.name}{p.archived ? " (архив)" : ""}</option>)}
            </select>
            {plan && plan.days.length > 1 && (
              <select value={dayId} onChange={(e) => setDayId(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-lime-400/50">
                {plan.days.map((d) => <option key={d.id} value={d.id} className="bg-zinc-900">{d.name}</option>)}
              </select>
            )}
          </div>

          {finished && (
            <div className="bg-lime-400/10 border border-lime-400/30 rounded-xl p-3 text-sm text-lime-400 flex items-center gap-2"><CheckCircle2 size={16} /> Тренировка записана</div>
          )}

          {!day ? (
            <p className="text-zinc-600 text-sm text-center py-10">Загрузка плана...</p>
          ) : (
            <>
              {day.exercises.length === 0 && <p className="text-zinc-600 text-center py-10">В этом дне нет упражнений.</p>}
              {groupBlocks(day.exercises).map((block, bi) => {
                const cards = block.items.map((ex, k) => {
                  const idx = block.startIdx + k;
                  const rows = vals[ex.id] || [];
                  const n = rows.length;
                  const fireIdx = [n - 2, n - 1].filter((i) => i >= 0);
                  const md = meta[ex.id] || { done: false, note: "", fires: {}, rpe: 0 };
                  const tonnage = tonnageOf(rows);
                  return (
                    <div key={ex.id} className={block.items.length > 1 ? `p-3 transition ${md.done ? "bg-lime-400/5" : ""}` : `bg-zinc-900 border rounded-xl p-3 transition ${md.done ? "border-lime-400/40" : "border-zinc-800"}`}>
                      <div className="flex items-center justify-between gap-2 mb-2"><h3 className="font-semibold min-w-0 truncate"><span className="text-lime-400 mr-1.5">{exLabel(day, idx)}</span>{ex.name || "—"}</h3><span className="text-xs text-zinc-500 shrink-0 text-right">цель: {exSummary(ex)}{tonnage > 0 && <><br />тоннаж: <span className="text-orange-400">{fmtTonnage(tonnage)}</span></>}</span></div>
                      {ex.rest && <p className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1"><Timer size={12} className="text-cyan-400" /> отдых между подходами: {ex.rest}</p>}
                      {ex.kind === "functional" ? (
                      <div className="text-sm text-zinc-300 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {ex.duration && <span className="flex items-center gap-1"><Timer size={13} className="text-orange-400" /> {ex.duration}</span>}
                        {ex.weight && <span>вес: {ex.weight}</span>}
                        {ex.pulseZone && <span className="text-cyan-400">пульс: {ex.pulseZone}</span>}
                        {!ex.duration && !ex.weight && !ex.pulseZone && <span className="text-zinc-600">функциональное упражнение</span>}
                      </div>
                      ) : (
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        <div className="flex flex-col gap-1 shrink-0"><div className="h-5 flex items-center text-[10px] uppercase tracking-wide text-zinc-500">№</div><div className="h-9 flex items-center text-[10px] uppercase tracking-wide text-zinc-500">Вес</div><div className="h-9 flex items-center text-[10px] uppercase tracking-wide text-zinc-500">Повт.</div></div>
                        {rows.map((r, i) => (
                          <div key={i} className="flex flex-col gap-1 shrink-0 w-16">
                            <div className="h-5 flex items-center justify-center text-xs text-zinc-400 font-medium">{i + 1}</div>
                            <input value={r.weight} onChange={(e) => setVal(ex.id, i, { weight: e.target.value })} inputMode="decimal" placeholder="—" className="h-9 w-full bg-zinc-800 rounded-md px-1 text-base text-center outline-none focus:ring-1 focus:ring-lime-400/40" />
                            <input value={r.reps} onChange={(e) => setVal(ex.id, i, { reps: e.target.value })} inputMode="numeric" placeholder="—" className="h-9 w-full bg-zinc-800 rounded-md px-1 text-base text-center outline-none focus:ring-1 focus:ring-lime-400/40" />
                          </div>
                        ))}
                      </div>
                      )}
                      {ex.kind !== "functional" && fireIdx.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Интенсивность (последние подходы)</p>
                          {fireIdx.map((i) => (<div key={i} className="flex items-center gap-2"><span className="text-xs text-zinc-400 w-16 shrink-0">Подход {i + 1}</span><FlameRate value={md.fires[i] || 0} onChange={(v) => setFire(ex.id, i, v)} /></div>))}
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1"><span className="text-[10px] uppercase tracking-wide text-zinc-500 w-16 shrink-0">RPE/RIR</span><div className="flex gap-0.5">{Array.from({ length: 11 }, (_, n) => n).map((n) => (<button key={n} onClick={() => setMetaFor(ex.id, { rpe: n === md.rpe ? 0 : n })} title={`RPE ${n}`} className={`w-6 h-6 rounded text-[10px] font-semibold transition shrink-0 ${n === md.rpe ? "bg-cyan-400 text-zinc-950" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}>{n}</button>))}</div></div>
                      <input value={md.note} onChange={(e) => setMetaFor(ex.id, { note: e.target.value })} placeholder="Примечание по упражнению..." className="w-full mt-2 bg-zinc-800/60 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
                      <button onClick={() => setMetaFor(ex.id, { done: !md.done })} className={`mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition ${md.done ? "bg-lime-400/15 text-lime-400" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"}`}>{md.done ? <CheckCircle2 size={16} /> : <Circle size={16} />} {md.done ? "Упражнение выполнено" : "Отметить выполненным"}</button>
                    </div>
                  );
                });
                if (block.group && block.items.length > 1) {
                  const color = GROUP_COLORS[block.group];
                  return (
                    <div key={bi} className="rounded-xl border-2 overflow-hidden" style={{ borderColor: color }}>
                      <div className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ background: `${color}26`, color }}>
                        <Layers size={12} /> {supersetName(block.items.length)} {block.group}
                      </div>
                      <div className="bg-zinc-900 divide-y divide-zinc-800">{cards}</div>
                    </div>
                  );
                }
                return <div key={bi}>{cards}</div>;
              })}

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-3">
                <h3 className="font-semibold flex items-center gap-1.5"><MessageSquare size={16} className="text-lime-400" /> После тренировки</h3>
                <div><p className="text-xs text-zinc-500 mb-1">Самочувствие</p><EmojiScale value={wellbeing} onChange={setWellbeing} emojis={WELL_EMOJI} /></div>
                <div><p className="text-xs text-zinc-500 mb-1">Настроение</p><EmojiScale value={mood} onChange={setMood} emojis={MOOD_EMOJI} /></div>
                <div><p className="text-xs text-zinc-500 mb-1">Оценка тренировки клиентом</p><div className="flex gap-1.5">{[1, 2, 3, 4, 5].map((n) => (<button key={n} onClick={() => setClientRating(n === clientRating ? 0 : n)} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${n <= clientRating ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}>{n}</button>))}</div></div>
                <div><p className="text-xs text-zinc-500 mb-1">Отзыв клиента</p><textarea value={review} onChange={(e) => setReview(e.target.value)} rows={2} placeholder="Что сказал клиент..." className="w-full bg-zinc-800 rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" /></div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-400 shrink-0">Упр.: <span className="text-lime-400 font-semibold">{doneEx}/{day.exercises.length}</span></span>
                {totalTonnage > 0 && <span className="text-sm text-zinc-400 shrink-0">Тоннаж: <span className="text-orange-400 font-semibold">{fmtTonnage(totalTonnage)}</span></span>}
                {!finished && <button onClick={finish} disabled={busy} className="flex-1 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 hover:bg-lime-300 transition disabled:opacity-50 flex items-center justify-center gap-1.5"><CheckCircle2 size={18} /> Завершить — {membership?.type === "sessions" && <RemainingBadge remaining={membership.remaining !== "" ? String(combinedRemaining(membership)) : null} />} {client.name}</button>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// Тренировка 2-4 подопечных одновременно: вкладки сверху переключают активного,
// но все слоты остаются смонтированными (скрыты через "hidden"), поэтому введённые веса/повторы не теряются.
export default function GroupSessionModal({ clients, trainerId, onClose, onClientFinished }: { clients: SlotClient[]; trainerId: string; onClose: () => void; onClientFinished?: (clientId: string) => void }) {
  // А1: роль, ловушка Tab, возврат фокуса, Escape только для верхнего окна.
  // Вызов до любых ранних return — иначе порядок хуков поедет.
  const { panelProps } = useModalA11y(onClose, "Групповое проведение тренировки");
  const [activeId, setActiveId] = useState(clients[0]?.id || "");
  const [finishedIds, setFinishedIds] = useState<string[]>([]);

  return (
    <div {...panelProps} className="fixed inset-0 z-50 bg-zinc-950 flex flex-col outline-none">
      <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0"><Users size={16} className="text-lime-400 shrink-0" /><h2 className="font-bold truncate">Групповая тренировка</h2></div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 shrink-0"><X size={20} /></button>
      </div>

      <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2 flex gap-1.5 overflow-x-auto shrink-0">
        {clients.map((c) => (
          <button key={c.id} onClick={() => setActiveId(c.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition shrink-0 ${activeId === c.id ? "text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`} style={activeId === c.id ? { background: c.color } : undefined}>
            {finishedIds.includes(c.id) && <CheckCircle2 size={13} />} <RemainingBadge remaining={c.remaining} /> {c.name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-2xl w-full mx-auto">
        {clients.map((c) => (
          <ClientSlot key={c.id} client={c} trainerId={trainerId} active={c.id === activeId} onFinished={() => { setFinishedIds((arr) => (arr.includes(c.id) ? arr : [...arr, c.id])); onClientFinished?.(c.id); }} />
        ))}
      </div>
    </div>
  );
}
