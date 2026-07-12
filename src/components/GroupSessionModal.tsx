import { CheckCircle2, Circle, Flame, Layers, MessageSquare, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { GROUP_COLORS, MOOD_EMOJI, WELL_EMOJI } from "../constants";
import { parseNum, today } from "../lib/format";
import { buildMetrics } from "../lib/sessionUtils";
import * as plansApi from "../lib/plans";
import * as clientsApi from "../lib/clients";
import { combinedRemaining } from "../lib/clients";
import * as progressApi from "../lib/progress";
import type { Membership, PlanListItem } from "../lib/clients";
import type { Day, Exercise, Metric, Plan, Session } from "../types";
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
const tonnageOf = (rows: { weight: string; reps: string }[]) =>
  rows.reduce((sum, r) => { const w = parseNum(r.weight); const rp = parseNum(r.reps); return w != null && rp != null ? sum + w * rp : sum; }, 0);
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

type SetVal = { weight: string; reps: string };
type ExMeta = { done: boolean; note: string; fires: Record<number, number>; rpe: number };

const buildVals = (day: Day): Record<string, SetVal[]> => {
  const init: Record<string, SetVal[]> = {};
  day.exercises.forEach((ex) => {
    if (ex.detailed && ex.setRows?.length) init[ex.id] = ex.setRows.map((s) => ({ weight: s.weight || "", reps: s.reps || "" }));
    else {
      const n = Math.max(1, Math.min(12, parseInt(ex.sets) || 3));
      init[ex.id] = Array.from({ length: n }, () => ({ weight: ex.weight ? String(parseNum(ex.weight) ?? "") : "", reps: ex.reps || "" }));
    }
  });
  return init;
};
const buildMeta = (day: Day): Record<string, ExMeta> => {
  const m: Record<string, ExMeta> = {};
  day.exercises.forEach((ex) => { m[ex.id] = { done: false, note: "", fires: {}, rpe: 0 }; });
  return m;
};

export type SlotClient = { id: string; name: string; color: string; remaining?: string | null };

// Один "слот" — полностью независимая тренировка одного подопечного: свой план/день/веса/повторы.
// Слоты не размонтируются при переключении вкладок (см. ниже className="hidden"), поэтому ввод не теряется.
function ClientSlot({ client, active, onFinished }: { client: SlotClient; active: boolean; onFinished: () => void }) {
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dayId, setDayId] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [finished, setFinished] = useState(false);
  const [vals, setVals] = useState<Record<string, SetVal[]>>({});
  const [meta, setMeta] = useState<Record<string, ExMeta>>({});
  const [mood, setMood] = useState(0);
  const [wellbeing, setWellbeing] = useState(0);
  const [review, setReview] = useState("");
  const [clientRating, setClientRating] = useState(0);

  useEffect(() => {
    clientsApi.fetchClientPlans(client.id).then((list) => {
      setPlans(list);
      const first = list.find((p) => !p.archived) || list[0];
      if (first) setPlanId(first.id);
    });
    clientsApi.fetchClient(client.id).then((c) => setMembership(c.membership));
  }, [client.id]);

  useEffect(() => {
    if (!planId) { setPlan(null); setDayId(""); return; }
    plansApi.fetchPlan(planId).then((p) => { setPlan(p); setDayId(p.days[0]?.id || ""); });
  }, [planId]);

  const day = plan?.days.find((d) => d.id === dayId) || null;

  useEffect(() => {
    if (!day) return;
    setVals(buildVals(day));
    setMeta(buildMeta(day));
  }, [day?.id]);

  const setVal = (exId: string, i: number, patch: Partial<SetVal>) =>
    setVals((a) => ({ ...a, [exId]: a[exId].map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const setMetaFor = (exId: string, patch: Partial<ExMeta>) => setMeta((m) => ({ ...m, [exId]: { ...m[exId], ...patch } }));
  const setFire = (exId: string, idx: number, v: number) => setMeta((m) => ({ ...m, [exId]: { ...m[exId], fires: { ...m[exId].fires, [idx]: v } } }));
  const doneEx = day ? day.exercises.filter((ex) => meta[ex.id]?.done).length : 0;
  const totalTonnage = day ? day.exercises.reduce((sum, ex) => sum + tonnageOf(vals[ex.id] || []), 0) : 0;

  const finish = async () => {
    if (!day || !plan) return;
    const metrics = buildMetrics(day, vals);
    const items = day.exercises.filter((ex) => ex.name).map((ex) => {
      const f = meta[ex.id]?.fires || {};
      const effort = Math.max(0, ...Object.values(f).map((x) => x || 0));
      return { name: ex.name, effort, rpe: meta[ex.id]?.rpe || 0, note: meta[ex.id]?.note || "" };
    });
    const session: Omit<Session, "id"> = { date: today(), dayName: day.name, mood, wellbeing, review: review.trim(), clientRating, done: doneEx, total: day.exercises.length, fromClient: false, items };
    const note = `✅ Проведена: ${day.name} (${doneEx}/${day.exercises.length} упр.)${mood ? ` · настроение ${MOOD_EMOJI[mood - 1]}` : ""}`;
    await progressApi.logSession(plan.id, metrics, note, session);
    if (membership) setMembership(await clientsApi.decrementMembershipRemaining(client.id, membership));
    setFinished(true);
    onFinished();
  };

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
                      {fireIdx.length > 0 && (
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
                {!finished && <button onClick={finish} className="flex-1 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 hover:bg-lime-300 transition flex items-center justify-center gap-1.5"><CheckCircle2 size={18} /> Завершить — {membership?.type === "sessions" && <RemainingBadge remaining={membership.remaining !== "" ? String(combinedRemaining(membership)) : null} />} {client.name}</button>}
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
export default function GroupSessionModal({ clients, onClose, onClientFinished }: { clients: SlotClient[]; onClose: () => void; onClientFinished?: (clientId: string) => void }) {
  const [activeId, setActiveId] = useState(clients[0]?.id || "");
  const [finishedIds, setFinishedIds] = useState<string[]>([]);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
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
          <ClientSlot key={c.id} client={c} active={c.id === activeId} onFinished={() => { setFinishedIds((arr) => (arr.includes(c.id) ? arr : [...arr, c.id])); onClientFinished?.(c.id); }} />
        ))}
      </div>
    </div>
  );
}
