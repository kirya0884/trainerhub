import { CheckCircle2, Circle, Flame, Layers, MessageSquare, Minimize2, Play, Timer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  day: Day; onFinish: (metrics: Omit<Metric, "id">[], note: string, session: Omit<Session, "id">) => void | Promise<void>; onClose: () => void;
}) {
  const SK = `th-tsess-${day.id}`;
  const [vals, setVals] = useState<Record<string, SetVal[]>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${SK}-vals`) || "null");
      if (saved && typeof saved === "object") return saved as Record<string, SetVal[]>;
    } catch {}
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
    try {
      const saved = JSON.parse(localStorage.getItem(`${SK}-meta`) || "null");
      if (saved && typeof saved === "object") return saved as Record<string, ExMeta>;
    } catch {}
    const m: Record<string, ExMeta> = {};
    day.exercises.forEach((ex) => { m[ex.id] = { done: false, note: "", fires: {}, rpe: 0, setsDone: {} }; });
    return m;
  });
  const [mood, setMood] = useState(0);
  const [wellbeing, setWellbeing] = useState(0);
  const [review, setReview] = useState("");
  const [clientRating, setClientRating] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Автосейв прогресса тренировки (как у клиента) — переживает перезагрузку страницы
  const _vt = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (_vt.current) clearTimeout(_vt.current);
    _vt.current = setTimeout(() => { try { localStorage.setItem(`${SK}-vals`, JSON.stringify(vals)); } catch {} }, 500);
    return () => { if (_vt.current) clearTimeout(_vt.current); };
  }, [vals]); // eslint-disable-line react-hooks/exhaustive-deps
  const _mt = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (_mt.current) clearTimeout(_mt.current);
    _mt.current = setTimeout(() => { try { localStorage.setItem(`${SK}-meta`, JSON.stringify(meta)); } catch {} }, 500);
    return () => { if (_mt.current) clearTimeout(_mt.current); };
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearPersist = () => { try { localStorage.removeItem(`${SK}-vals`); localStorage.removeItem(`${SK}-meta`); } catch {} };
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hh = Math.floor(elapsed / 3600), mm = Math.floor((elapsed % 3600) / 60), ss = elapsed % 60;
  const timer = `${hh > 0 ? String(hh).padStart(2, "0") + ":" : ""}${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  // Блокируем скролл страницы когда сессия открыта
  useEffect(() => { document.body.style.overflow = minimized ? "" : "hidden"; return () => { document.body.style.overflow = ""; }; }, [minimized]);

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
  const isCircuit = day.method === "circuit";
  const maxRounds = isCircuit && day.exercises.length ? Math.max(1, ...day.exercises.map((ex) => (vals[ex.id] || []).length)) : 0;

  const finish = async () => {
    if (submitting) return;
    setSubmitting(true);
    const metrics: Omit<Metric, "id">[] = [];
    day.exercises.forEach((ex) => {
      if (!ex.name || ex.kind === "functional") return;
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
      const exVals = (vals[ex.id] ?? []).filter((r) => r.weight || r.reps);
      const plannedSets: Array<{weight: string; reps: string}> = ex.detailed && ex.setRows?.length
        ? ex.setRows.map((s) => ({ weight: s.weight || "", reps: s.reps || "" }))
        : Array.from({ length: parseInt(ex.sets) || 1 }, () => ({ weight: ex.weight || "", reps: ex.reps || "" }));
      return { name: ex.name, effort, rpe: meta[ex.id]?.rpe || 0, note: meta[ex.id]?.note || "", plannedSets, ...(exVals.length ? { actualSets: exVals } : {}) };
    });
    const session: Omit<Session, "id"> = { date: today(), dayName: day.name, mood, wellbeing, review: review.trim(), clientRating, done: doneEx, total: day.exercises.length, fromClient: false, items };
    try {
      await Promise.resolve(onFinish(metrics, `✅ Проведена: ${day.name} (${doneEx}/${day.exercises.length} упр.)${mood ? ` · настроение ${MOOD_EMOJI[mood - 1]}` : ""}`, session));
      clearPersist();
      onClose();
    } catch (e) {
      console.error("[SessionModal] finish:", e);
      alert("Не удалось сохранить тренировку. Данные не потеряны — попробуй ещё раз.");
    } finally { setSubmitting(false); }
  };

  if (minimized) {
    return (
      <button onClick={() => setMinimized(false)}
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-3 bg-zinc-900 border-t border-zinc-700 px-4 py-3 text-left hover:bg-zinc-800 transition">
        <Play size={15} className="text-lime-400 shrink-0" />
        <span className="flex-1 font-semibold truncate text-sm">{day.name}</span>
        <span className="font-mono text-lime-400 text-sm shrink-0">{timer}</span>
        <span className="text-xs text-zinc-500 shrink-0">{doneEx}/{day.exercises.length} упр.</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
      <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="min-w-0"><div className="flex items-center gap-2"><Play size={16} className="text-lime-400 shrink-0" /><h2 className="font-bold truncate">{day.name}</h2></div><p className="text-xs text-zinc-500 mt-0.5"><span className="font-mono text-lime-400 mr-2">{timer}</span>Отмечай факт по подходам, ставь огонёчки на последних подходах</p></div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setMinimized(true)} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400" title="Свернуть"><Minimize2 size={18} /></button>
          <button onClick={() => { if (window.confirm("Прервать тренировку? Отметки будут удалены.")) { clearPersist(); onClose(); } }} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400"><X size={20} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-2xl w-full mx-auto space-y-3">
        {day.exercises.length === 0 && <p className="text-zinc-600 text-center py-10">В этом дне нет упражнений.</p>}
        {isCircuit ? Array.from({ length: maxRounds }, (_, r) => (
          <div key={r} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-cyan-400/10 text-cyan-400">Круг {r + 1} из {maxRounds}</div>
            <div className="flex items-center gap-2 px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
              <span className="shrink-0" style={{ width: 26 }} />
              <span className="flex-1 min-w-0">Упражнение</span>
              <span className="w-14 text-center shrink-0">повт.</span>
              <span className="text-xs invisible">×</span>
              <span className="w-14 text-center shrink-0">вес, кг</span>
            </div>
            <div className="divide-y divide-zinc-800">
              {day.exercises.map((ex) => {
                const rows = vals[ex.id] || [];
                if (r >= rows.length || !ex.name) return null;
                const row = rows[r];
                const md = meta[ex.id] || { done: false, note: "", fires: {}, rpe: 0, setsDone: {} };
                const isDone = md.setsDone?.[r] ?? false;
                return (
                  <div key={ex.id} className={`flex items-center gap-2 px-3 py-2 transition ${isDone ? "opacity-50" : ""}`}>
                    <button onClick={() => toggleSetDone(ex.id, r, rows.length)} className="shrink-0 p-0.5">
                      {isDone ? <CheckCircle2 size={18} className="text-lime-400" /> : <Circle size={18} className="text-zinc-600" />}
                    </button>
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{ex.name}</span>
                    {ex.kind === "functional" ? (
                      <span className="text-xs text-zinc-400 shrink-0 text-right">{[ex.duration && `⏱ ${ex.duration}`, ex.weight, ex.pulseZone && `пульс ${ex.pulseZone}`].filter(Boolean).join(" · ") || "функц."}</span>
                    ) : (
                      <>
                        <input value={row.reps} onChange={(e) => setVal(ex.id, r, { reps: e.target.value })} inputMode="text" placeholder="повт" className="h-9 w-14 bg-zinc-800 rounded-md px-1 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
                        <span className="text-xs text-zinc-500">×</span>
                        <input value={row.weight} onChange={(e) => setVal(ex.id, r, { weight: e.target.value })} inputMode="decimal" placeholder="кг" className="h-9 w-14 bg-zinc-800 rounded-md px-1 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )) : groupBlocks(day.exercises).map((block, bi) => {
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
                {ex.rest && <p className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1"><Timer size={12} className="text-cyan-400" /> отдых между подходами: {ex.rest}</p>}
                {ex.kind === "functional" ? (
                <div className="text-sm text-zinc-300 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {ex.duration && <span className="flex items-center gap-1"><Timer size={13} className="text-orange-400" /> {ex.duration}</span>}
                  {ex.weight && <span>вес: {ex.weight}</span>}
                  {ex.pulseZone && <span className="text-cyan-400">пульс: {ex.pulseZone}</span>}
                  {!ex.duration && !ex.weight && !ex.pulseZone && <span className="text-zinc-600">функциональное упражнение</span>}
                </div>
                ) : (
                <div className="space-y-1.5">
                  {rows.map((r, i) => {
                    const isDone = md.setsDone?.[i] ?? false;
                    return (
                      <div key={i} className={`flex items-center gap-2 transition ${isDone ? "opacity-50" : ""}`}>
                        <button onClick={() => toggleSetDone(ex.id, i, rows.length)} className="shrink-0 p-0.5">
                          {isDone ? <CheckCircle2 size={18} className="text-lime-400" /> : <Circle size={18} className="text-zinc-600" />}
                        </button>
                        <span className="text-xs text-zinc-400 w-4 text-center shrink-0">{i + 1}</span>
                        <input value={r.reps} onChange={(e) => setVal(ex.id, i, { reps: e.target.value })} inputMode="text" placeholder="повт" className="h-9 w-16 bg-zinc-800 rounded-md px-1 text-base text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
                        <span className="text-xs text-zinc-500">×</span>
                        <input value={r.weight} onChange={(e) => setVal(ex.id, i, { weight: e.target.value })} inputMode="decimal" placeholder="кг" className="h-9 w-16 bg-zinc-800 rounded-md px-1 text-base text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
                        <span className="text-xs text-zinc-500 shrink-0">кг</span>
                        {fireIdx.includes(i) && <FlameRate value={md.fires[i] || 0} onChange={(v) => setFire(ex.id, i, v)} />}
                      </div>
                    );
                  })}
                </div>
                )}
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

      <div className="border-t border-zinc-800 bg-zinc-900 px-3 py-2.5 shrink-0"><div className="max-w-2xl mx-auto flex items-center gap-3"><span className="text-xs text-zinc-500"><span className="text-lime-400 font-semibold">{doneEx}</span>/{day.exercises.length} упр.{totalTonnage > 0 && <span className="ml-2 text-orange-400 font-semibold">{fmtTonnage(totalTonnage)}</span>}</span><button onClick={finish} disabled={submitting} className="ml-auto bg-lime-400 text-zinc-950 font-bold rounded-xl px-5 py-2 text-sm hover:bg-lime-300 transition disabled:opacity-50 flex items-center gap-1.5"><CheckCircle2 size={16} /> {submitting ? "Сохранение..." : "Завершить"}</button></div></div>
    </div>
  );
}
