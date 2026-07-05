import { CheckCircle2, Flame, Play, Send, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { parseNum, today } from "../lib/format";
import type { Day, Metric, Session } from "../types";

function StarRate({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(value === n ? 0 : n)} title={`${n} из 5`}>
          <Star size={26} style={{ color: n <= value ? "var(--accent)" : "#3f3f46" }} fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

const exLabel = (day: Day, idx: number) => {
  const ex = day.exercises[idx];
  if (!ex.group) return `${idx + 1}`;
  let pos = 0;
  for (let i = 0; i <= idx; i++) if (day.exercises[i].group === ex.group) pos++;
  return `${ex.group}${pos}`;
};
const exSummary = (e: Day["exercises"][number]) => {
  if (e.detailed && e.setRows?.length) return e.setRows.map((s, i) => `${i + 1}) ${s.weight || "—"}×${s.reps || "—"}`).join(", ");
  let base = `${e.sets}×${e.reps}`;
  if (e.weight) base += ` · ${e.weight}`;
  return base;
};

function FlameRate({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(value === n ? 0 : n)} title={`${n} из 5`}>
          <Flame size={18} className={n <= value ? "text-orange-400" : "text-zinc-700"} fill={n <= value ? "#fb923c" : "none"} />
        </button>
      ))}
    </div>
  );
}

type SetVal = { weight: string; reps: string };
type ExMeta = { fires: Record<number, number>; note: string };

export default function ClientSessionView({ day, startedAt, onFinish, onCancel, accent = "#a3e635" }: {
  day: Day; startedAt: number;
  onFinish: (metrics: Omit<Metric, "id">[], session: Omit<Session, "id">) => void;
  onCancel: () => void;
  accent?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hh = Math.floor(elapsed / 3600), mm = Math.floor((elapsed % 3600) / 60), ss = elapsed % 60;
  const timer = `${hh > 0 ? String(hh).padStart(2, "0") + ":" : ""}${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;

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
    day.exercises.forEach((ex) => { m[ex.id] = { fires: {}, note: "" }; });
    return m;
  });
  const setVal = (exId: string, i: number, patch: Partial<SetVal>) => setVals((a) => ({ ...a, [exId]: a[exId].map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const setMetaFor = (exId: string, patch: Partial<ExMeta>) => setMeta((m) => ({ ...m, [exId]: { ...m[exId], ...patch } }));
  const setFire = (exId: string, idx: number, v: number) => setMeta((m) => ({ ...m, [exId]: { ...m[exId], fires: { ...m[exId].fires, [idx]: v } } }));

  const [step, setStep] = useState<"training" | "feedback">("training");
  const [draft, setDraft] = useState<{ metrics: Omit<Metric, "id">[]; session: Omit<Session, "id"> } | null>(null);
  const [mood, setMood] = useState(0);
  const [wellbeing, setWellbeing] = useState(0);
  const [review, setReview] = useState("");

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
      return { name: ex.name, effort, rpe: 0, note: meta[ex.id]?.note || "" };
    });
    const session: Omit<Session, "id"> = { date: today(), dayName: day.name, mood: 0, wellbeing: 0, clientRating: 0, review: "", done: day.exercises.length, total: day.exercises.length, fromClient: true, items };
    setDraft({ metrics, session });
    setStep("feedback");
  };

  const sendFeedback = () => {
    if (!draft) return;
    onFinish(draft.metrics, { ...draft.session, mood, wellbeing, clientRating: mood, review });
  };

  const cancel = () => { if (window.confirm("Прервать тренировку? Несохранённые отметки будут потеряны.")) onCancel(); };

  if (step === "feedback") {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
        <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between shrink-0">
          <h2 className="font-bold">Как прошла тренировка?</h2>
          <button onClick={() => setStep("training")} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6 max-w-md w-full mx-auto space-y-5">
          <div>
            <p className="text-sm text-zinc-400 mb-2">Общая оценка тренировки</p>
            <StarRate value={mood} onChange={setMood} />
          </div>
          <div>
            <p className="text-sm text-zinc-400 mb-2">Самочувствие после тренировки</p>
            <StarRate value={wellbeing} onChange={setWellbeing} />
          </div>
          <div>
            <p className="text-sm text-zinc-400 mb-2">Комментарий тренеру (необязательно)</p>
            <textarea value={review} onChange={(e) => setReview(e.target.value)} rows={3} placeholder="Как себя чувствуешь, что было тяжело..." className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40 resize-none" />
          </div>
        </div>
        <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-3 shrink-0">
          <button onClick={sendFeedback} className="w-full max-w-md mx-auto block text-zinc-950 font-semibold rounded-lg py-2.5 transition flex items-center justify-center gap-1.5" style={{ background: "var(--accent)" }}><Send size={17} /> Отправить тренеру</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ "--accent": accent } as React.CSSProperties}>
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
      <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="min-w-0"><div className="flex items-center gap-2"><Play size={16} style={{ color: "var(--accent)" }} className="shrink-0" /><h2 className="font-bold truncate">{day.name}</h2></div><p className="text-xs mt-0.5 font-mono" style={{ color: "var(--accent)" }}>{timer}</p></div>
        <button onClick={cancel} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 shrink-0"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-2xl w-full mx-auto space-y-3">
        {day.exercises.length === 0 && <p className="text-zinc-600 text-center py-10">В этом дне нет упражнений.</p>}
        {day.exercises.map((ex, idx) => {
          const rows = vals[ex.id] || [];
          const n = rows.length;
          const fireIdx = [n - 2, n - 1].filter((i) => i >= 0);
          const md = meta[ex.id] || { fires: {}, note: "" };
          return (
            <div key={ex.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 mb-2"><h3 className="font-semibold min-w-0 truncate"><span className="mr-1.5" style={{ color: "var(--accent)" }}>{exLabel(day, idx)}</span>{ex.name || "—"}</h3><span className="text-xs text-zinc-500 shrink-0">цель: {exSummary(ex)}</span></div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <div className="flex flex-col gap-1 shrink-0"><div className="h-5 flex items-center text-[10px] uppercase tracking-wide text-zinc-500">№</div><div className="h-9 flex items-center text-[10px] uppercase tracking-wide text-zinc-500">Вес</div><div className="h-9 flex items-center text-[10px] uppercase tracking-wide text-zinc-500">Повт.</div></div>
                {rows.map((r, i) => (
                  <div key={i} className="flex flex-col gap-1 shrink-0 w-16">
                    <div className="h-5 flex items-center justify-center text-xs text-zinc-400 font-medium">{i + 1}</div>
                    <input value={r.weight} onChange={(e) => setVal(ex.id, i, { weight: e.target.value })} inputMode="decimal" placeholder="—" className="h-9 w-full bg-zinc-800 rounded-md px-1 text-base text-center outline-none focus:ring-1 focus:ring-cyan-400/40" />
                    <input value={r.reps} onChange={(e) => setVal(ex.id, i, { reps: e.target.value })} inputMode="numeric" placeholder="—" className="h-9 w-full bg-zinc-800 rounded-md px-1 text-base text-center outline-none focus:ring-1 focus:ring-cyan-400/40" />
                  </div>
                ))}
              </div>
              {fireIdx.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Как тяжело дались последние подходы</p>
                  {fireIdx.map((i) => (<div key={i} className="flex items-center gap-2"><span className="text-xs text-zinc-400 w-16 shrink-0">Подход {i + 1}</span><FlameRate value={md.fires[i] || 0} onChange={(v) => setFire(ex.id, i, v)} /></div>))}
                </div>
              )}
              <input value={md.note} onChange={(e) => setMetaFor(ex.id, { note: e.target.value })} placeholder="Отзыв тренеру: как прошло, ощущения..." className="w-full mt-2 bg-zinc-800/60 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40" />
            </div>
          );
        })}
      </div>

      <div className="border-t border-zinc-800 bg-zinc-900 px-3 sm:px-4 py-3 shrink-0">
        <div className="max-w-2xl mx-auto"><button onClick={finish} className="w-full text-zinc-950 font-semibold rounded-lg py-2.5 transition flex items-center justify-center gap-1.5" style={{ background: "var(--accent)" }}><CheckCircle2 size={18} /> Завершить тренировку</button></div>
      </div>
    </div>
    </div>
  );
}
