import { Check, CheckCircle2, Flame, Layers, MessageSquare, Timer, Users, X } from "lucide-react";
import { useModalA11y } from "../hooks/useModalA11y";
import { loadViewState, saveViewState } from "../lib/viewState";
import { tonnageOf, useSessionSlot } from "../hooks/useSessionSlot";
import { useEffect, useState } from "react";
import { GROUP_COLORS } from "../constants";
import { FeelingScale } from "./FeelingScale";
import { RestBar, useRestTimer } from "./RestTimer";
import { parseRest } from "../lib/format";
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
        <button key={n} onClick={() => onChange(value === n ? 0 : n)} className="p-0.5 transition" title={`${n} из 5`}>
          <Flame size={18} className={n <= value ? "text-orange-400" : "text-zinc-700"} fill={n <= value ? "#fb923c" : "none"} />
        </button>
      ))}
    </div>
  );
}

type Slot = ReturnType<typeof useSessionSlot>;
// Отметка подхода + запуск общего таймера отдыха (если отдых задан и это не последний подход подопечного)
const tapSet = (slot: Slot, ex: Exercise, i: number, total: number, startRest: (sec: number) => void) => {
  const was = slot.meta[ex.id]?.setsDone?.[i] ?? false;
  slot.toggleSetDone(ex.id, i, total);
  const sec = parseRest(ex.rest);
  if (!was && sec && slot.openSets() > 1) startRest(sec);
};
const selectCls = "h-10 bg-zinc-800 border border-zinc-700 rounded-xl px-3 text-sm outline-none focus:border-lime-400/50";

export type SlotClient = { id: string; name: string; color: string; remaining?: string | null };

// Один "слот" — полностью независимая тренировка одного подопечного: свой план/день/веса/повторы.
// Слоты не размонтируются при переключении вкладок (см. ниже className="hidden"), поэтому ввод не теряется.
function ClientSlot({ client, trainerId, active, onFinished, startRest }: { client: SlotClient; trainerId: string; active: boolean; onFinished: () => void; startRest: (sec: number) => void }) {
  // Д1: всё состояние слота живёт в хуке — так родитель может держать сразу двоих
  // и показывать их подходы рядом, а не по вкладкам.
  const s = useSessionSlot(client.id, trainerId, onFinished);
  const { plans, planId, setPlanId, plan, dayId, setDayId, day, membership, finished, busy,
    vals, meta, setVal, setMetaFor, setFire, mood, setMood, wellbeing, setWellbeing,
    review, setReview, clientRating, setClientRating, doneEx, totalTonnage, finish } = s;
  // Как в индивидуальной: текущее — первое невыполненное, выполненные сворачиваются
  const currentId = day?.exercises.find((ex) => ex.name && !meta[ex.id]?.done)?.id;
  const [openDone, setOpenDone] = useState<Record<string, boolean>>({});

  return (
    <div className={active ? "space-y-2.5" : "hidden"}>
      {!plans ? (
        <p className="text-zinc-500 text-sm text-center py-10">Загрузка планов…</p>
      ) : plans.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-10">У {client.name} нет планов тренировок.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="План" className={`${selectCls} flex-1 min-w-0`}>
              {plans.map((p) => <option key={p.id} value={p.id} className="bg-zinc-900">{p.name}{p.archived ? " (архив)" : ""}</option>)}
            </select>
            {plan && plan.days.length > 1 && (
              <select value={dayId} onChange={(e) => setDayId(e.target.value)} aria-label="День" className={`${selectCls} flex-1 min-w-0`}>
                {plan.days.map((d) => <option key={d.id} value={d.id} className="bg-zinc-900">{d.name}</option>)}
              </select>
            )}
          </div>

          {finished && (
            <div className="bg-lime-400/10 border border-lime-400/30 rounded-xl p-3 text-sm text-lime-400 flex items-center gap-2"><CheckCircle2 size={16} /> Тренировка записана</div>
          )}

          {!day ? (
            <p className="text-zinc-500 text-sm text-center py-10">Загрузка плана…</p>
          ) : (
            <>
              {day.exercises.length > 0 && (
                <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full rounded-full bg-lime-400 transition-[width] duration-300" style={{ width: `${(doneEx / day.exercises.length) * 100}%` }} />
                </div>
              )}
              {day.exercises.length === 0 && <p className="text-zinc-500 text-center py-10">В этом дне нет упражнений.</p>}
              {groupBlocks(day.exercises).map((block, bi) => {
                const cards = block.items.map((ex, k) => {
                  const idx = block.startIdx + k;
                  const rows = vals[ex.id] || [];
                  const n = rows.length;
                  const fireIdx = [n - 2, n - 1].filter((i) => i >= 0);
                  const md = meta[ex.id] || { done: false, note: "", fires: {}, rpe: 0, setsDone: {} };
                  const tonnage = ex.kind === "functional" ? 0 : tonnageOf(rows); // функциональное: вес тут не про подходы, тоннаж не считаем
                  const grouped = block.items.length > 1;
                  const shell = grouped
                    ? `p-3 transition ${md.done ? "bg-lime-400/5" : ""}`
                    : `bg-zinc-900 border rounded-2xl p-3 transition ${md.done ? "border-lime-400/40" : ex.id === currentId ? "border-lime-400/70 ring-1 ring-lime-400/40" : "border-zinc-800"}`;
                  if (md.done && !openDone[ex.id]) {
                    const fact = rows.filter((r) => r.weight || r.reps).map((r) => `${r.weight || "—"}×${r.reps || "—"}`).join(", ");
                    return (
                      <button key={ex.id} onClick={() => setOpenDone((o) => ({ ...o, [ex.id]: true }))} className={`${shell} !py-2 w-full flex items-center gap-2.5 text-left`}>
                        <CheckCircle2 size={18} className="text-lime-400 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold truncate"><span className="text-zinc-500 mr-1.5">{exLabel(day, idx)}</span>{ex.name || "—"}</span>
                          <span className="block text-xs text-zinc-500 truncate">{ex.kind === "functional" ? exSummary(ex) : fact || exSummary(ex)}</span>
                        </span>
                        {tonnage > 0 && <span className="text-xs text-zinc-500 shrink-0">{fmtTonnage(tonnage)}</span>}
                      </button>
                    );
                  }
                  return (
                    <div key={ex.id} className={shell}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold leading-snug"><span className="text-lime-400 mr-1.5">{exLabel(day, idx)}</span>{ex.name || "—"}</h3>
                          <p className="text-xs text-zinc-500 mt-0.5">цель: {exSummary(ex)}{tonnage > 0 && <> · тоннаж <span className="text-orange-400">{fmtTonnage(tonnage)}</span></>}</p>
                          {md.done && <button onClick={() => setMetaFor(ex.id, { done: false })} className="text-xs text-zinc-500 underline underline-offset-2 py-1 hover:text-zinc-300 transition">Снять отметку</button>}
                        </div>
                        <button onClick={() => { if (!md.done) setMetaFor(ex.id, { done: true }); setOpenDone((o) => ({ ...o, [ex.id]: false })); }}
                          className={`shrink-0 text-xs px-2.5 h-8 rounded-lg font-medium transition ${md.done ? "bg-lime-400/20 text-lime-400" : "bg-zinc-800 text-zinc-300 hover:text-zinc-100"}`}>{md.done ? "Свернуть" : "Готово"}</button>
                      </div>
                      {ex.rest && <p className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1"><Timer size={12} className="text-cyan-400" /> отдых между подходами: {ex.rest}</p>}
                      {ex.kind === "functional" ? (
                        <div className="text-sm text-zinc-300 flex flex-wrap items-center gap-x-4 gap-y-1">
                          {ex.duration && <span className="flex items-center gap-1"><Timer size={13} className="text-orange-400" /> {ex.duration}</span>}
                          {ex.weight && <span>вес: {ex.weight}</span>}
                          {ex.pulseZone && <span className="text-cyan-400">пульс: {ex.pulseZone}</span>}
                          {!ex.duration && !ex.weight && !ex.pulseZone && <span className="text-zinc-500">функциональное упражнение</span>}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-[1.25rem_1fr_1fr_2.5rem] gap-1.5 text-[11px] text-zinc-500 text-center">
                            <span>#</span><span>Вес, кг</span><span>Повторы</span><span />
                          </div>
                          {rows.map((r, i) => {
                            const isDone = md.setsDone?.[i] ?? false;
                            return (
                              <div key={i}>
                                <div className="grid grid-cols-[1.25rem_1fr_1fr_2.5rem] gap-1.5 items-center">
                                  <span className="text-sm font-semibold text-zinc-500 text-center">{i + 1}</span>
                                  <input value={r.weight} onChange={(e) => setVal(ex.id, i, { weight: e.target.value })} inputMode="decimal" placeholder="кг" className={`h-10 w-full min-w-0 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                                  <input value={r.reps} onChange={(e) => setVal(ex.id, i, { reps: e.target.value })} inputMode="numeric" placeholder="повт" className={`h-10 w-full min-w-0 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                                  <button onClick={() => tapSet(s, ex, i, rows.length, startRest)} aria-pressed={isDone} aria-label={isDone ? `Снять отметку с подхода ${i + 1}` : `Подход ${i + 1} выполнен`}
                                    className={`h-10 w-10 rounded-lg flex items-center justify-center transition active:scale-95 ${isDone ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>
                                    <Check size={20} strokeWidth={2.5} />
                                  </button>
                                </div>
                                {fireIdx.includes(i) && (
                                  <div className="flex items-center gap-1.5 pl-7">
                                    <span className="text-xs text-zinc-500">Усилие</span>
                                    <FlameRate value={md.fires[i] || 0} onChange={(v) => setFire(ex.id, i, v)} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5">
                        <span className="text-xs text-zinc-500 shrink-0">RPE</span>
                        <div className="flex gap-0.5">{Array.from({ length: 11 }, (_, n) => n).map((n) => (<button key={n} onClick={() => setMetaFor(ex.id, { rpe: n === md.rpe ? 0 : n })} title={`RPE ${n}`} className={`w-7 h-7 rounded-md text-xs font-semibold transition shrink-0 ${n === md.rpe ? "bg-cyan-400 text-zinc-950" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}>{n}</button>))}</div>
                      </div>
                      <input value={md.note} onChange={(e) => setMetaFor(ex.id, { note: e.target.value })} placeholder="Примечание по упражнению..." className="w-full mt-2 bg-zinc-800/60 rounded-lg px-3 h-9 outline-none focus:ring-2 focus:ring-lime-400/60" />
                    </div>
                  );
                });
                if (block.group && block.items.length > 1) {
                  const color = GROUP_COLORS[block.group];
                  return (
                    <div key={bi} className="rounded-2xl border-2 overflow-hidden" style={{ borderColor: color }}>
                      <div className="px-2.5 py-1 text-xs font-bold flex items-center gap-1.5" style={{ background: `${color}26`, color }}>
                        <Layers size={12} /> {supersetName(block.items.length)} {block.group}
                      </div>
                      <div className="bg-zinc-900 divide-y divide-zinc-800">{cards}</div>
                    </div>
                  );
                }
                return <div key={bi}>{cards}</div>;
              })}

              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 space-y-3">
                <h3 className="font-semibold flex items-center gap-1.5"><MessageSquare size={16} className="text-lime-400" /> После тренировки</h3>
                <div><p className="text-xs text-zinc-500 mb-1">Самочувствие</p><FeelingScale kind="wellbeing" value={wellbeing} onChange={setWellbeing} /></div>
                <div><p className="text-xs text-zinc-500 mb-1">Настроение</p><FeelingScale kind="mood" value={mood} onChange={setMood} /></div>
                <div><p className="text-xs text-zinc-500 mb-1">Оценка тренировки клиентом</p><div className="flex gap-1.5">{[1, 2, 3, 4, 5].map((n) => (<button key={n} onClick={() => setClientRating(n === clientRating ? 0 : n)} className={`flex-1 h-10 rounded-lg text-sm font-semibold transition ${n <= clientRating ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"}`}>{n}</button>))}</div></div>
                <div><p className="text-xs text-zinc-500 mb-1">Отзыв клиента</p><textarea value={review} onChange={(e) => setReview(e.target.value)} rows={2} placeholder="Что сказал клиент..." className="w-full bg-zinc-800 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-lime-400/60 resize-none" /></div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-500 shrink-0"><span className="text-lime-400 font-semibold">{doneEx}</span>/{day.exercises.length} упр.{totalTonnage > 0 && <span className="block text-xs text-orange-400 font-semibold">{fmtTonnage(totalTonnage)}</span>}</span>
                {!finished && <button onClick={finish} disabled={busy} className="flex-1 min-w-0 h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-1.5"><CheckCircle2 size={18} className="shrink-0" /> <span className="truncate">Завершить: {client.name}</span> {membership?.type === "sessions" && <RemainingBadge remaining={membership.remaining !== "" ? String(combinedRemaining(membership)) : null} />}</button>}
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
  // Д2: «Рядом» доступен только для пары — хук слота вызывается статично дважды.
  const isPair = clients.length === 2;
  const [side, setSide] = useState(() => isPair && loadViewState<boolean>("group-side-by-side", true));
  useEffect(() => { if (isPair) saveViewState("group-side-by-side", side); }, [side, isPair]);
  // Один таймер отдыха на всю группу — тренер отдыхает между подходами вместе с подопечными
  const restTimer = useRestTimer();
  const markFinished = (id: string) => {
    setFinishedIds((arr) => (arr.includes(id) ? arr : [...arr, id]));
    onClientFinished?.(id);
  };

  return (
    <div {...panelProps} className="fixed inset-0 z-50 bg-zinc-950 text-zinc-100 flex flex-col outline-none">
      <div className="border-b border-zinc-800 bg-zinc-900 px-4 pt-3 pb-2.5 shrink-0 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0"><Users size={18} className="text-lime-400 shrink-0" /><h2 className="font-bold truncate">Групповая тренировка</h2></div>
          <button onClick={onClose} aria-label="Закрыть" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-400 shrink-0"><X size={22} /></button>
        </div>
        {isPair && (
          <div className="flex gap-1 p-1 bg-zinc-800/60 rounded-xl">
            {([[true, "Рядом"], [false, "Вкладки"]] as const).map(([v, label]) => (
              <button key={label} onClick={() => setSide(v)} aria-pressed={side === v}
                className={`flex-1 h-8 rounded-lg text-sm font-semibold transition ${side === v ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className={`gap-1.5 overflow-x-auto ${isPair && side ? "hidden" : "flex"}`}>
          {clients.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)} aria-pressed={activeId === c.id}
              className={`flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-semibold transition shrink-0 ${activeId === c.id ? "text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
              style={activeId === c.id ? { background: c.color } : undefined}>
              {finishedIds.includes(c.id) && <CheckCircle2 size={14} />} <RemainingBadge remaining={c.remaining} /> {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 max-w-2xl w-full mx-auto">
        {isPair && side && <PairSession a={clients[0]} b={clients[1]} trainerId={trainerId} onFinishedOne={markFinished} startRest={restTimer.start} />}
        {!(isPair && side) && clients.map((c) => (
          <ClientSlot key={c.id} client={c} trainerId={trainerId} active={c.id === activeId} onFinished={() => markFinished(c.id)} startRest={restTimer.start} />
        ))}
      </div>
      <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }}><RestBar timer={restTimer} /></div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Д2: режим «Рядом» — ровно два подопечных, один список упражнений, два блока
// ввода. У реальных пар планы разные (проверено по базе: ноль планов с общим
// именем), поэтому списки склеиваются ПО НАЗВАНИЮ упражнения, а не по плану.
//
// Хук вызывается дважды статично — ровно двое, так что правило хуков соблюдено.
// При трёх и более подопечных используется прежний путь со вкладками.
// ───────────────────────────────────────────────────────────────────────────

/** Ряд ввода подходов одного подопечного по одному упражнению: столбик на подход, отметка под ним. */
function SetRowsFor({ name, color, ex, slot, startRest }: {
  name: string; color: string; ex: Exercise | undefined; slot: Slot; startRest: (sec: number) => void;
}) {
  if (!ex) {
    return (
      <div className="flex items-center gap-2 py-2">
        <span className="w-1.5 h-4 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-sm font-medium text-zinc-300 shrink-0">{name}</span>
        <span className="text-xs text-zinc-500">нет в плане</span>
      </div>
    );
  }
  const rows = slot.vals[ex.id] || [];
  const md = slot.meta[ex.id] || { done: false, note: "", fires: {}, rpe: 0, setsDone: {} };
  return (
    <div className="py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-1.5 h-4 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-sm font-semibold text-zinc-200 min-w-0 truncate">{name}</span>
        <button onClick={() => slot.setMetaFor(ex.id, { done: !md.done })}
          className={`ml-auto shrink-0 flex items-center gap-1 rounded-lg px-2.5 h-8 text-xs font-medium transition ${
            md.done ? "bg-lime-400/15 text-lime-400" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>
          {md.done ? <><CheckCircle2 size={14} /> сделано</> : "Готово"}
        </button>
      </div>
      {ex.kind === "functional" ? (
        <p className="text-xs text-zinc-400 pl-3.5">
          {[ex.duration, ex.weight && `вес ${ex.weight}`, ex.pulseZone && `пульс ${ex.pulseZone}`].filter(Boolean).join(" · ") || "функциональное"}
        </p>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-1 pl-3.5">
          {rows.map((r, i) => {
            const isDone = md.setsDone?.[i] ?? false;
            return (
              <div key={i} className="flex flex-col gap-1 shrink-0 w-16">
                <div className="h-4 flex items-center justify-center text-[11px] text-zinc-500">{i + 1}</div>
                <input value={r.weight} onChange={(e) => slot.setVal(ex.id, i, { weight: e.target.value })} inputMode="decimal" placeholder="кг"
                  className={`h-10 w-full bg-zinc-800 rounded-lg text-center font-semibold outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                <input value={r.reps} onChange={(e) => slot.setVal(ex.id, i, { reps: e.target.value })} inputMode="numeric" placeholder="повт"
                  className={`h-10 w-full bg-zinc-800 rounded-lg text-center font-semibold outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                <button onClick={() => tapSet(slot, ex, i, rows.length, startRest)} aria-pressed={isDone} aria-label={`${name}: ${isDone ? "снять отметку с подхода" : "подход выполнен"} ${i + 1}`}
                  className={`h-9 rounded-lg flex items-center justify-center transition active:scale-95 ${isDone ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>
                  <Check size={18} strokeWidth={2.5} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Компактный выбор плана и дня для одного подопечного. */
function PlanPicker({ c, slot }: { c: SlotClient; slot: Slot }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="w-1.5 h-4 rounded-full shrink-0" style={{ background: c.color }} />
      <span className="text-sm font-semibold shrink-0 max-w-[88px] truncate">{c.name}</span>
      {!slot.plans ? <span className="text-xs text-zinc-500">загрузка…</span> : (
        <>
          <select value={slot.planId} onChange={(e) => slot.setPlanId(e.target.value)} aria-label={`План: ${c.name}`}
            className="flex-1 min-w-0 h-9 bg-zinc-800 border border-zinc-700 rounded-lg px-2 text-sm outline-none focus:border-lime-400/50">
            {slot.plans.map((p) => <option key={p.id} value={p.id} className="bg-zinc-900">{p.name}{p.archived ? " (архив)" : ""}</option>)}
          </select>
          {slot.plan && slot.plan.days.length > 1 && (
            <select value={slot.dayId} onChange={(e) => slot.setDayId(e.target.value)} aria-label={`День: ${c.name}`}
              className="flex-1 min-w-0 h-9 bg-zinc-800 border border-zinc-700 rounded-lg px-2 text-sm outline-none focus:border-lime-400/50">
              {slot.plan.days.map((d) => <option key={d.id} value={d.id} className="bg-zinc-900">{d.name}</option>)}
            </select>
          )}
        </>
      )}
    </div>
  );
}

function PairSession({ a, b, trainerId, onFinishedOne, startRest }: {
  a: SlotClient; b: SlotClient; trainerId: string; onFinishedOne: (id: string) => void; startRest: (sec: number) => void;
}) {
  const sa = useSessionSlot(a.id, trainerId, () => onFinishedOne(a.id));
  const sb = useSessionSlot(b.id, trainerId, () => onFinishedOne(b.id));

  // Объединение по названию: порядок по дню первой, недостающие у второй — в конец.
  const merged = (() => {
    const key = (n: string) => n.trim().toLowerCase();
    const out: { title: string; exA?: Exercise; exB?: Exercise }[] = [];
    const seen = new Set<string>();
    for (const ex of sa.day?.exercises ?? []) {
      if (!ex.name.trim()) continue;
      seen.add(key(ex.name));
      out.push({ title: ex.name, exA: ex, exB: sb.day?.exercises.find((x) => key(x.name) === key(ex.name)) });
    }
    for (const ex of sb.day?.exercises ?? []) {
      if (!ex.name.trim() || seen.has(key(ex.name))) continue;
      out.push({ title: ex.name, exA: undefined, exB: ex });
    }
    return out;
  })();

  const bothReady = sa.day && sb.day;

  return (
    <div className="space-y-2.5">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 space-y-2">
        <PlanPicker c={a} slot={sa} />
        <PlanPicker c={b} slot={sb} />
      </div>

      {!bothReady ? (
        <p className="text-zinc-500 text-sm text-center py-10">Выберите план и день у обоих подопечных.</p>
      ) : merged.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-10">В выбранных днях нет упражнений.</p>
      ) : (
        <>
          {merged.map((m, i) => (
            <div key={`${m.title}-${i}`} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-3 pt-3 pb-1">
              <h3 className="font-semibold"><span className="text-lime-400 mr-1.5">{i + 1}</span>{m.title}</h3>
              <div className="divide-y divide-zinc-800">
                <SetRowsFor name={a.name} color={a.color} ex={m.exA} slot={sa} startRest={startRest} />
                <SetRowsFor name={b.name} color={b.color} ex={m.exB} slot={sb} startRest={startRest} />
              </div>
            </div>
          ))}

          {/* Завершение раздельное: у каждой своя сессия, своё списание, свои метрики */}
          <div className="grid grid-cols-2 gap-2">
            {[{ c: a, s: sa }, { c: b, s: sb }].map(({ c, s }) => (
              <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 space-y-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-4 rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="text-sm font-semibold truncate">{c.name}</span>
                </div>
                <p className="text-xs text-zinc-400">
                  Упр.: <span className="text-lime-400 font-semibold">{s.doneEx}/{s.day?.exercises.length ?? 0}</span>
                  {s.totalTonnage > 0 && <> · <span className="text-orange-400 font-semibold">{fmtTonnage(s.totalTonnage)}</span></>}
                </p>
                <div><p className="text-xs text-zinc-500 mb-1">Самочувствие</p><FeelingScale kind="wellbeing" value={s.wellbeing} onChange={s.setWellbeing} compact /></div>
                <div><p className="text-xs text-zinc-500 mb-1">Настроение</p><FeelingScale kind="mood" value={s.mood} onChange={s.setMood} compact /></div>
                {s.finished ? (
                  <div className="flex items-center gap-1.5 text-xs text-lime-400"><CheckCircle2 size={14} /> записана</div>
                ) : (
                  <button onClick={s.finish} disabled={s.busy}
                    className="w-full h-11 bg-lime-400 text-zinc-950 font-bold rounded-xl text-sm hover:bg-lime-300 transition disabled:opacity-50">
                    {s.busy ? "Сохраняю…" : "Завершить"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
