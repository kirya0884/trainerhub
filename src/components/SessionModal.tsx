import { AlertTriangle, Check, CheckCircle2, Flame, Layers, MessageSquare, Minimize2, Play, Timer, X } from "lucide-react";
import { readJson, removeKey, touchDraft, writeJson } from "../lib/storage";
import { useModalA11y } from "../hooks/useModalA11y";
import { useEffect, useRef, useState } from "react";
import { GROUP_COLORS, MOOD_EMOJI, WELL_EMOJI } from "../constants";
import { parseNum, parseRest, today } from "../lib/format";
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
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
// Два коротких сигнала. AudioContext создаётся по тапу (иначе браузер его заглушит).
const beep = (ctx: AudioContext) => {
  [0, 0.28].forEach((t) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    const at = ctx.currentTime + t;
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.35, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    o.connect(g).connect(ctx.destination);
    o.start(at); o.stop(at + 0.22);
  });
};

function FlameRate({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => onChange(value === n ? 0 : n)} className="p-1 transition" title={`${n} из 5`}>
          <Flame size={22} className={n <= value ? "text-orange-400" : "text-zinc-700"} fill={n <= value ? "#fb923c" : "none"} />
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
  // А1: роль, ловушка Tab, возврат фокуса, Escape только для верхнего окна.
  // Вызов до любых ранних return — иначе порядок хуков поедет.
  const { panelProps } = useModalA11y(onClose, "Проведение тренировки");
  const SK = `th-tsess-${day.id}`;
  // А3: раньше сбой записи черновика глушился catch {} — тренер терял введённое молча
  const [draftFailed, setDraftFailed] = useState(false);
  const [vals, setVals] = useState<Record<string, SetVal[]>>(() => {
    const saved = readJson<Record<string, SetVal[]> | null>(`${SK}-vals`, null);
    if (saved && typeof saved === "object") return saved;
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
    const saved = readJson<Record<string, ExMeta> | null>(`${SK}-meta`, null);
    if (saved && typeof saved === "object") return saved;
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
    _vt.current = setTimeout(() => {
      if (writeJson(`${SK}-vals`, vals)) touchDraft(SK); else setDraftFailed(true);
    }, 500);
    return () => { if (_vt.current) clearTimeout(_vt.current); };
  }, [vals]); // eslint-disable-line react-hooks/exhaustive-deps
  const _mt = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (_mt.current) clearTimeout(_mt.current);
    _mt.current = setTimeout(() => {
      if (writeJson(`${SK}-meta`, meta)) touchDraft(SK); else setDraftFailed(true);
    }, 500);
    return () => { if (_mt.current) clearTimeout(_mt.current); };
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearPersist = () => { removeKey(`${SK}-vals`); removeKey(`${SK}-meta`); };
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
  // Текущее — первое невыполненное: подсвечиваем, чтобы в зале не искать глазами, где остановились
  const currentId = day.exercises.find((ex) => ex.name && !meta[ex.id]?.done)?.id;
  // Выполненные упражнения сворачиваются в строку; тап раскрывает обратно (поправить вес, заметку)
  const [openDone, setOpenDone] = useState<Record<string, boolean>>({});

  // Таймер отдыха: стартует сам после отметки подхода, если в плане задан отдых.
  // Считаем от момента окончания, а не тиками — после блокировки экрана остаток верный.
  const [rest, setRest] = useState<{ endsAt: number; signaled: boolean } | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => () => { audioRef.current?.close().catch(() => {}); }, []);
  const restLeft = rest ? Math.max(0, Math.ceil((rest.endsAt - now) / 1000)) : 0;
  useEffect(() => {
    if (!rest) return;
    if (!rest.signaled && now >= rest.endsAt) {
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* iOS не поддерживает */ }
      if (audioRef.current) { try { beep(audioRef.current); } catch (e) { console.warn("[SessionModal] beep:", e); } }
      setRest({ ...rest, signaled: true });
    } else if (rest.signaled && now >= rest.endsAt + 6000) setRest(null);
  }, [now, rest]);
  // Неотмеченные подходы по всей тренировке — после самого последнего отдых не нужен
  const openSets = () => day.exercises.reduce((n, ex) =>
    ex.kind === "functional" || !ex.name || meta[ex.id]?.done ? n
      : n + (vals[ex.id] || []).filter((_, i) => !meta[ex.id]?.setsDone?.[i]).length, 0);
  const startRest = (ex: Exercise) => {
    const sec = parseRest(ex.rest);
    if (!sec || openSets() <= 1) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!audioRef.current && AC) audioRef.current = new AC();
      audioRef.current?.resume().catch(() => {});
    } catch (e) { console.warn("[SessionModal] audio:", e); }
    const t = Date.now();
    setNow(t);
    setRest({ endsAt: t + sec * 1000, signaled: false });
  };
  // Отметка подхода + запуск отдыха (снятие отметки отдых не запускает)
  const tapSet = (ex: Exercise, i: number, total: number) => {
    const was = meta[ex.id]?.setsDone?.[i] ?? false;
    toggleSetDone(ex.id, i, total);
    if (!was) startRest(ex);
  };
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
      const rest = parseRest(ex.rest);
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
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-3 bg-zinc-900 text-zinc-100 border-t border-zinc-700 px-4 py-3 text-left hover:bg-zinc-800 transition">
        <Play size={15} className="text-lime-400 shrink-0" />
        <span className="flex-1 font-semibold truncate text-sm">{day.name}</span>
        {restLeft > 0 && <span className="font-mono text-sm shrink-0 text-zinc-300">отдых {fmtClock(restLeft)}</span>}
        <span className="font-mono text-lime-400 text-sm shrink-0">{timer}</span>
        <span className="text-xs text-zinc-500 shrink-0">{doneEx}/{day.exercises.length} упр.</span>
      </button>
    );
  }

  // Д3/фикс: цвет текста задаётся здесь, а не наследуется. Модал рендерится из App
  // вне общего контейнера с text-zinc-100 — без своего цвета текст падал
  // на умолчание браузера и становился чёрным на тёмном фоне.
  return (
    <div {...panelProps} className="fixed inset-0 z-50 bg-zinc-950 text-zinc-100 flex flex-col outline-none">
      {draftFailed && (
        <div className="shrink-0 flex items-start gap-2 bg-orange-400/10 border-b border-orange-400/25 px-4 py-2 text-[13px] text-orange-300">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>Черновик не сохраняется — в хранилище браузера нет места. Не закрывайте экран, пока не завершите тренировку.</span>
        </div>
      )}
      <div className="border-b border-zinc-800 bg-zinc-900 px-4 pt-3 pb-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-bold truncate">{day.name}</h2>
            <p className="text-sm text-zinc-500 mt-0.5"><span className="font-mono font-bold text-base text-lime-400 mr-2">{timer}</span>{doneEx} из {day.exercises.length} упр.</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setMinimized(true)} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-400" title="Свернуть" aria-label="Свернуть"><Minimize2 size={20} /></button>
            <button onClick={() => { if (window.confirm("Прервать тренировку? Отметки будут удалены.")) { clearPersist(); onClose(); } }} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-400" title="Прервать" aria-label="Прервать тренировку"><X size={22} /></button>
          </div>
        </div>
        <div className="h-1 mt-2 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full rounded-full bg-lime-400 transition-[width] duration-300" style={{ width: `${day.exercises.length ? (doneEx / day.exercises.length) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 max-w-2xl w-full mx-auto space-y-3">
        {day.exercises.length === 0 && <p className="text-zinc-600 text-center py-10">В этом дне нет упражнений.</p>}
        {isCircuit ? Array.from({ length: maxRounds }, (_, r) => (
          <div key={r} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-cyan-400/10 text-cyan-400">Круг {r + 1} из {maxRounds}</div>
            <div className="flex items-center gap-2 px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
              <span className="flex-1 min-w-0">Упражнение</span>
              <span className="w-14 text-center shrink-0">повт.</span>
              <span className="w-14 text-center shrink-0">вес, кг</span>
              <span className="w-11 shrink-0" />
            </div>
            <div className="divide-y divide-zinc-800">
              {day.exercises.map((ex) => {
                const rows = vals[ex.id] || [];
                if (r >= rows.length || !ex.name) return null;
                const row = rows[r];
                const md = meta[ex.id] || { done: false, note: "", fires: {}, rpe: 0, setsDone: {} };
                const isDone = md.setsDone?.[r] ?? false;
                return (
                  <div key={ex.id} className="flex items-center gap-2 px-3 py-2">
                    <span className={`flex-1 min-w-0 truncate text-sm font-medium transition ${isDone ? "text-zinc-500" : ""}`}>{ex.name}</span>
                    {ex.kind === "functional" ? (
                      <span className="text-xs text-zinc-400 shrink-0 text-right">{[ex.duration && `⏱ ${ex.duration}`, ex.weight, ex.pulseZone && `пульс ${ex.pulseZone}`].filter(Boolean).join(" · ") || "функц."}</span>
                    ) : (
                      <>
                        <input value={row.reps} onChange={(e) => setVal(ex.id, r, { reps: e.target.value })} inputMode="text" placeholder="повт" className="h-11 w-14 bg-zinc-800 rounded-xl px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 shrink-0" />
                        <input value={row.weight} onChange={(e) => setVal(ex.id, r, { weight: e.target.value })} inputMode="decimal" placeholder="кг" className="h-11 w-14 bg-zinc-800 rounded-xl px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 shrink-0" />
                      </>
                    )}
                    <button onClick={() => tapSet(ex, r, rows.length)} aria-pressed={isDone} aria-label={isDone ? "Снять отметку" : "Отметить выполненным"}
                      className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center transition active:scale-95 ${isDone ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>
                      <Check size={20} strokeWidth={2.5} />
                    </button>
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
            const grouped = block.items.length > 1;
            const isCurrent = ex.id === currentId;
            const shell = grouped
              ? `p-3 transition ${md.done ? "bg-lime-400/5" : ""}`
              : `bg-zinc-900 border rounded-2xl p-3.5 transition ${md.done ? "border-lime-400/40" : isCurrent ? "border-lime-400/70 ring-1 ring-lime-400/40" : "border-zinc-800"}`;
            if (md.done && !openDone[ex.id]) {
              const fact = rows.filter((r) => r.weight || r.reps).map((r) => `${r.reps || "—"}×${r.weight || "—"}`).join(", ");
              return (
                <button key={ex.id} onClick={() => setOpenDone((o) => ({ ...o, [ex.id]: true }))} className={`${shell} w-full flex items-center gap-3 text-left`}>
                  <CheckCircle2 size={20} className="text-lime-400 shrink-0" />
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
                <div className="flex items-start justify-between gap-2 mb-2"><div className="min-w-0 flex-1"><h3 className="font-semibold leading-snug"><span className="text-lime-400 mr-1.5">{exLabel(day, idx)}</span>{ex.name || "—"}</h3>{tonnage > 0 && <p className="text-xs text-zinc-500 mt-0.5">тоннаж: <span className="text-orange-400">{fmtTonnage(tonnage)}</span></p>}{md.done && <button onClick={() => setMetaFor(ex.id, { done: false })} className="text-xs text-zinc-500 underline underline-offset-2 py-1 hover:text-zinc-300 transition">Снять отметку</button>}</div><div className="flex items-center gap-1 shrink-0"><button onClick={() => { if (!md.done) setMetaFor(ex.id, { done: true }); setOpenDone((o) => ({ ...o, [ex.id]: false })); }} className={`text-sm px-3 h-9 rounded-xl font-medium transition ${md.done ? "bg-lime-400/20 text-lime-400" : "bg-zinc-800 text-zinc-300 hover:text-zinc-100"}`}>{md.done ? "Свернуть" : "Готово"}</button></div></div>
                {ex.rest && <p className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1"><Timer size={12} className="text-cyan-400" /> отдых между подходами: {ex.rest}</p>}
                {ex.kind === "functional" ? (
                <div className="text-sm text-zinc-300 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {ex.duration && <span className="flex items-center gap-1"><Timer size={13} className="text-orange-400" /> {ex.duration}</span>}
                  {ex.weight && <span>вес: {ex.weight}</span>}
                  {ex.pulseZone && <span className="text-cyan-400">пульс: {ex.pulseZone}</span>}
                  {!ex.duration && !ex.weight && !ex.pulseZone && <span className="text-zinc-600">функциональное упражнение</span>}
                </div>
                ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1.5rem_1fr_1fr_3rem] gap-2 text-xs text-zinc-500 text-center">
                    <span>#</span><span>Повторы</span><span>Вес, кг</span><span />
                  </div>
                  {rows.map((r, i) => {
                    const isDone = md.setsDone?.[i] ?? false;
                    return (
                      <div key={i}>
                        <div className="grid grid-cols-[1.5rem_1fr_1fr_3rem] gap-2 items-center">
                          <span className="text-sm font-semibold text-zinc-500 text-center">{i + 1}</span>
                          <input value={r.reps} onChange={(e) => setVal(ex.id, i, { reps: e.target.value })} inputMode="text" placeholder="повт" className={`h-12 w-full min-w-0 bg-zinc-800 rounded-xl px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                          <input value={r.weight} onChange={(e) => setVal(ex.id, i, { weight: e.target.value })} inputMode="decimal" placeholder="кг" className={`h-12 w-full min-w-0 bg-zinc-800 rounded-xl px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                          <button onClick={() => tapSet(ex, i, rows.length)} aria-pressed={isDone} aria-label={isDone ? `Снять отметку с подхода ${i + 1}` : `Подход ${i + 1} выполнен`}
                            className={`h-12 w-12 rounded-xl flex items-center justify-center transition active:scale-95 ${isDone ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>
                            <Check size={22} strokeWidth={2.5} />
                          </button>
                        </div>
                        {fireIdx.includes(i) && (
                          <div className="flex items-center gap-2 pl-8 mt-1">
                            <span className="text-xs text-zinc-500">Усилие</span>
                            <FlameRate value={md.fires[i] || 0} onChange={(v) => setFire(ex.id, i, v)} />
                          </div>
                        )}
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

      {rest && (
        <div className="shrink-0 px-3 pb-2">
          <div role="status" aria-live="polite" className={`max-w-2xl mx-auto flex items-center gap-3 rounded-2xl pl-4 pr-2 h-14 text-zinc-950 shadow-lg ${restLeft > 0 ? "bg-zinc-100" : "bg-lime-400"}`}>
            <Timer size={20} className="shrink-0" />
            {restLeft > 0
              ? <div className="leading-tight"><p className="text-xs opacity-70">Отдых</p><p className="font-mono text-xl font-bold">{fmtClock(restLeft)}</p></div>
              : <p className="font-bold">Отдых окончен</p>}
            <div className="ml-auto flex gap-1.5">
              {restLeft > 0 && <button onClick={() => setRest((r) => r && { endsAt: Math.max(r.endsAt, Date.now()) + 30000, signaled: false })} className="h-10 px-3 rounded-xl bg-black/10 font-semibold text-sm">+30 с</button>}
              <button onClick={() => setRest(null)} className="h-10 px-3 rounded-xl bg-black/10 font-semibold text-sm">{restLeft > 0 ? "Пропустить" : "Закрыть"}</button>
            </div>
          </div>
        </div>
      )}
      <div className="border-t border-zinc-800 bg-zinc-900 px-3 pt-2.5 shrink-0" style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}><div className="max-w-2xl mx-auto flex items-center gap-3"><span className="text-sm text-zinc-500"><span className="text-lime-400 font-semibold">{doneEx}</span>/{day.exercises.length} упр.{totalTonnage > 0 && <span className="block text-xs text-orange-400 font-semibold">{fmtTonnage(totalTonnage)}</span>}</span><button onClick={finish} disabled={submitting} className="ml-auto h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl px-6 text-base hover:bg-lime-300 transition active:scale-[0.98] disabled:opacity-50 flex items-center gap-2"><CheckCircle2 size={18} /> {submitting ? "Сохранение..." : "Завершить"}</button></div></div>
    </div>
  );
}
