import { CheckCircle2, Circle, Flame, Layers, MessageSquare, Play, X } from "lucide-react";
import { useState } from "react";
import { GROUP_COLORS, MOOD_EMOJI, WELL_EMOJI } from "../constants";
import { parseNum, today } from "../lib/format";
import type { Day, Exercise, Metric, Session } from "../types";

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
type ExMeta = { done: boolean; note: string; fires: Record<number, number>; rpe: number; setsDone?: Record<number, boolean> };

export default function SessionModal({ day, onFinish, onClose }: {
  day: Day; onFinish: (metrics: Omit<Metric, "id">[], note: string, session: Omit<Session, "id">) => void; onClose: () => void;
}) {
  const [vals, setVals] = useState<Record<string, SetVal[]>>(() => {
    const init: Record<string, SetVal[]> = {};
    day.exercises.forEach((ex) => {
      if (ex.detailed && ex.setRows?.length) init[ex.id] = ex.setRows.map((s) => ({ weight: s.weight || "", reps: s.reps || "" }));
      else {
        const n = Math.max(1, Math.min(12, parseInt(ex.sets) || 3));
        init[ex.id] = Array.from({ length: n }, () => ({ weight: ex.weight ? String(parseNum(ex.weight) ?? "") : "", reps: ex.reps || "" }));
      }
    });
    return init;
  });
  const [meta, setMeta] = useState<Record<string, ExMeta>>(() => {
    const m: Record<string, ExMeta> = {};
    day.exercises.forEach((ex) => { m[ex.id] = { done: false, note: "", fires: {}, rpe: 0, setsDone: {} }; });
    return m;
  });
  const [mood, setMood] = useState(0);
  const [wellbeing, setWellbeing] = useState(0);
  const [review, setReview] = useState("");
  const [clientRating, setClientRating] = useState(0);

  const setVal = (exId: string, i: number, patch: Partial<SetVal>) =>
    setVals((a) => ({ ...a, [exId]: a[exId].map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const setMetaFor = (exId: string, patch: Partial<ExMeta>) => setMeta((m) => ({ ...m, [exId]: { ...m[exId], ...patch } }));
  const setFire = (exId: string, idx: number, v: number) => setMeta((m) => ({ ...m, [exId]: { ...m[exId], fires: { ...m[exId].fires, [idx]: v } } }));
  const toggleSetDone = (exId: string, setIdx: number, total: number) =>
    setMeta((m) => {
      const cur = m[exId] || { done: false, note: "", fires: {}, rpe: 0, setsDone: {} };
      const sd = { ...(cur.setsDone || {}), [setIdx]: !cur.setsDone?.[setIdx] };
      const allDone = Array.from({ length: total }, (_, i) => i).every((i) => sd[i]);
      return { ...m, [exId]: { ...cur, setsDone: sd, done: allDone } };
    });
  const doneEx = day.exercises.filter((ex) => meta[ex.id]?.done).length;
  const totalTonnage = day.exercises.reduce((sum, ex) => sum + tonnageOf(vals[ex.id] || []), 0);

  const finish = () => {
    const metrics: Omit<Metric, "id">[] = [];
    day.exercises.forEach((ex) => {
      if (!ex.name) return;
      const rows = (vals[ex.id] || []).filter((r) => parseNum(r.weight) != null || (r.reps !== "" && r.reps != null));
      if (!rows.length) return;
      let best: { w: number; reps: string } | null = null;
      rows.forEach((r) => { const w = parseNum(r.weight); if (w != null && (best == null || w > best.w)) best = { w, reps: r.reps }; });
      const rest = parseNum(ex.rest);
      metrics.push({
        date: today(), exercise: ex.name, weight: best ? String(best.w) : "",
        reps: best ? String(parseNum(best.reps) ?? "") : String(parseNum(rows[0].reps) ?? ""),
        rest: rest == null ? "" : String(rest), sets: String(rows.length),
      });
    });
    const items = day.exercises.filter((ex) => ex.name).map((ex) => {
      const f = meta[ex.id]?.fires || {};
      const effort = Math.max(0, ...Object.values(f).map((x) => x || 0));
      return { name: ex.name, effort, rpe: meta[ex.id]?.rpe || 0, note: meta[ex.id]?.note || "" };
    });
    const session: Omit<Session, "id"> = { date: today(), dayName: day.name, mood, wellbeing, review: review.trim(), clientRating, done: doneEx, total: day.exercises.length, fromClient: false, items };
    onFinish(metrics, `✅ Проведена: ${day.name} (${doneEx}/${day.exercises.length} упр.)${mood ? ` · настроение ${MOOD_EMOJI[mood - 1]}` : ""}`, session);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
      <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="min-w-0"><div className="flex items-center gap-2"><Play size={16} className="text-lime-400 shrink-0" /><h2 className="font-bold truncate">{day.name}</h2></div><p className="text-xs text-zinc-500 mt-0.5">Отмечай факт по подходам, ставь огонёчки на последних подходах и примечания</p></div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 shrink-0"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-2xl w-full mx-auto space-y-3">
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
                <div className="flex items-start justify-between gap-2 mb-2"><h3 className="font-semibold min-w-0 leading-snug"><span className="text-lime-400 mr-1.5">{exLabel(day, idx)}</span>{ex.name || "—"}</h3><div className="flex items-center gap-2 shrink-0">{tonnage > 0 && <span className="text-xs text-zinc-500">тоннаж: <span className="text-orange-400">{fmtTonnage(tonnage)}</span></span>}<button onClick={() => setMetaFor(ex.id, { done: !md.done })} className={`text-xs px-2 py-1 rounded-lg font-medium transition ${md.done ? "bg-lime-400/20 text-lime-400" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"}`}>{md.done ? "✓ Готово" : "Готово"}</button></div></div>
                <div className="space-y-1.5">
                  {rows.map((r, i) => {
                    const isDone = md.setsDone?.[i] ?? false;
                    return (
                      <div key={i} className={`flex items-center gap-2 transition ${isDone ? "opacity-50" : ""}`}>
                        <button onClick={() => toggleSetDone(ex.id, i, rows.length)} className="shrink-0 p-0.5">
                          {isDone ? <CheckCircle2 size={18} className="text-lime-400" /> : <Circle size={18} className="text-zinc-600" />}
                        </button>
                        <span className="text-xs text-zinc-400 w-4 text-center shrink-0">{i + 1}</span>
                        <input value={r.weight} onChange={(e) => setVal(ex.id, i, { weight: e.target.value })} inputMode="decimal" placeholder="—" className="h-9 w-16 bg-zinc-800 rounded-md px-1 text-base text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
                        <span className="text-xs text-zinc-500">×</span>
                        <input value={r.reps} onChange={(e) => setVal(ex.id, i, { reps: e.target.value })} inputMode="numeric" placeholder="—" className="h-9 w-16 bg-zinc-800 rounded-md px-1 text-base text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
                        <span className="text-xs text-zinc-500 shrink-0">кг</span>
                        {fireIdx.includes(i) && <FlameRate value={md.fires[i] || 0} onChange={(v) => setFire(ex.id, i, v)} />}
                      </div>
                    );
                  })}
                </div>
                <input value={md.note} onChange={(e) => setMetaFor(ex.id, { note: e.target.value })} placeholder="Примечание по упражнению..." className="w-full mt-2 bg-zinc-800/60 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
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
          <div><p className="text-xs text-zinc-500 mb-1">Отзыв клиента</p><textarea value={review} onChange={(e) => setReview(e.target.value)} rows={2} placeholder="Что сказал клиент: ощущения, пожелания, обратная связь..." className="w-full bg-zinc-800 rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" /></div>
        </div>
      </div>

      <div className="border-t border-zinc-800 bg-zinc-900 px-3 py-2.5 shrink-0"><div className="max-w-2xl mx-auto flex items-center gap-3"><span className="text-xs text-zinc-500"><span className="text-lime-400 font-semibold">{doneEx}</span>/{day.exercises.length} упр.{totalTonnage > 0 && <span className="ml-2 text-orange-400 font-semibold">{fmtTonnage(totalTonnage)}</span>}</span><button onClick={finish} className="ml-auto bg-lime-400 text-zinc-950 font-bold rounded-xl px-5 py-2 text-sm hover:bg-lime-300 transition flex items-center gap-1.5"><CheckCircle2 size={16} /> Завершить</button></div></div>
    </div>
  );
}
