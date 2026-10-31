import { AlertTriangle, Check, CheckCircle2, Minimize2, Play, Send, Timer, X } from "lucide-react";
import { readJson, removeKey, touchDraft, writeJson } from "../lib/storage";
import { useEffect, useRef, useState } from "react";
import { fmtSet, parseRest, today } from "../lib/format";
import { buildMetrics, factSets, itemRpe } from "../lib/sessionUtils";
import { GROUP_COLORS } from "../constants";
import { FeelingScale } from "./FeelingScale";
import { RestBar, fmtClock, useRestTimer } from "./RestTimer";
import { LastTimeBar, PREV_COLS, PrevCell, RpePick, SET_COLS, SupersetRounds, askUnmarked, doneSets, tonnageOf } from "./SessionParts";
import { applyLastTime, type LastFact, type LastTime } from "../lib/sessionUtils";
import type { Day, Metric, Session } from "../types";
import { ask } from "../lib/dialog";
import { useScrollAnchor } from "../hooks/useScrollAnchor";
import { useKeyboardViewport } from "../hooks/useKeyboardViewport";

const exLabel = (day: Day, idx: number) => {
  const ex = day.exercises[idx];
  if (!ex.group) return `${idx + 1}`;
  let pos = 0;
  for (let i = 0; i <= idx; i++) if (day.exercises[i].group === ex.group) pos++;
  return `${ex.group}${pos}`;
};
const exSummary = (e: Day["exercises"][number]) => {
  if (e.kind === "functional") return [e.duration, e.weight, e.pulseZone ? `пульс ${e.pulseZone}` : ""].filter(Boolean).join(" · ") || "функциональное";
  if (e.detailed && e.setRows?.length) return e.setRows.map((s, i) => `${i + 1}) ${fmtSet(s.weight, s.reps)}`).join(", ");
  const parts: string[] = [];
  if (e.sets || e.reps) parts.push(`${e.sets || "?"}×${e.reps || "?"}`);
  if (e.weight) parts.push(e.weight);
  return parts.length ? parts.join(" · ") : "—";
};

const SUPERSET_NAME: Record<number, string> = { 2: "Двусет", 3: "Трисет" };
const supersetName = (n: number) => SUPERSET_NAME[n] || "Суперсет";
const groupBlocks = (exercises: Day["exercises"]) => {
  const blocks: { group: string | null; startIdx: number; items: Day["exercises"] }[] = [];
  exercises.forEach((ex, idx) => {
    const last = blocks[blocks.length - 1];
    if (ex.group && last?.group === ex.group) last.items.push(ex);
    else blocks.push({ group: ex.group || null, startIdx: idx, items: [ex] });
  });
  return blocks;
};
const fmtTonnage = (kg: number) => `${Math.round(kg).toLocaleString("ru-RU")} кг`;


type SetVal = { weight: string; reps: string; rpe?: number };
type ExMeta = { note: string; done: boolean; setsDone?: Record<number, boolean> };

function SessionTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hh = Math.floor(elapsed / 3600), mm = Math.floor((elapsed % 3600) / 60), ss = elapsed % 60;
  return <>{`${hh > 0 ? String(hh).padStart(2, "0") + ":" : ""}${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`}</>;
}

export default function ClientSessionView({ day, startedAt, onFinish, onCancel, accent = "#c6ff3d", onProgress, minimized = false, onMinimize, onExpand, lastTime = null, prevByName = {} }: {
  day: Day; startedAt: number;
  /** Последнее проведение этого дня — для «Как в прошлый раз» */
  lastTime?: LastTime | null;
  /** «было» у подходов — прошлый результат каждого упражнения */
  prevByName?: Record<string, LastFact>;
  onFinish: (metrics: Omit<Metric, "id">[], session: Omit<Session, "id">) => void;
  onCancel: () => void;
  accent?: string;
  onProgress?: (p: Record<string, { done: boolean; setsDone?: Record<number, boolean>; note?: string }>) => void;
  minimized?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
}) {

  const SK = `th-sess-${day.id}`;
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
        init[ex.id] = Array.from({ length: n }, () => ({ weight: ex.weight || "", reps: ex.reps || "" }));
      }
    });
    return init;
  });
  const [meta, setMeta] = useState<Record<string, ExMeta>>(() => {
    const saved = readJson<Record<string, ExMeta> | null>(`${SK}-meta`, null);
    if (saved && typeof saved === "object") return saved;
    const m: Record<string, ExMeta> = {};
    day.exercises.forEach((ex) => { m[ex.id] = { note: "", done: false, setsDone: {} }; });
    return m;
  });
  const setVal = (exId: string, i: number, patch: Partial<SetVal>) => setVals((a) => ({ ...a, [exId]: a[exId].map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const setMetaFor = (exId: string, patch: Partial<ExMeta>) => setMeta((m) => ({ ...m, [exId]: { ...m[exId], ...patch } }));
  const toggleSetDone = (exId: string, setIdx: number, total: number) =>
    setMeta((m) => {
      const cur = m[exId] || { note: "", done: false, setsDone: {} };
      const sd = { ...(cur.setsDone || {}), [setIdx]: !cur.setsDone?.[setIdx] };
      const allDone = Array.from({ length: total }, (_, i) => i).every((i) => sd[i]);
      return { ...m, [exId]: { ...cur, setsDone: sd, done: allDone } };
    });

  // #7 Save vals/meta to localStorage so progress survives app close
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
  const doneEx = day.exercises.filter((ex) => meta[ex.id]?.done).length;
  // Как у тренера (SessionModal): текущее — первое невыполненное, выполненные сворачиваются
  const currentId = day.exercises.find((ex) => ex.name && !meta[ex.id]?.done)?.id;
  const [openDone, setOpenDone] = useState<Record<string, boolean>>({});
  const { anchor, offscreenAbove } = useScrollAnchor();
  // Только что отмеченное — открыто; выполненные выше сворачиваются, лишь когда целиком
  // ушли за верх экрана (тогда прокрутку можно компенсировать без прыжка)
  const keepOpen = (exId: string) => {
    const open = Object.keys(openDone).filter((k) => openDone[k] && k !== exId);
    const hide = new Set(offscreenAbove(open));
    return Object.fromEntries([[exId, true], ...open.filter((k) => !hide.has(k)).map((k) => [k, true])]) as Record<string, boolean>;
  };
  const [beforeLast, setBeforeLast] = useState<Record<string, SetVal[]> | null>(null);
  const applyLast = () => { if (!lastTime) return; setBeforeLast(vals); setVals(applyLastTime(day, vals, (id) => meta[id]?.setsDone, lastTime)); };
  const undoLast = () => { if (beforeLast) { setVals(beforeLast); setBeforeLast(null); } };
  // Таймер отдыха после отметки подхода, если отдых задан в плане и это не последний подход
  const restTimer = useRestTimer();
  // С открытой клавиатурой экран стоит в видимой над ней области, а панель «Завершить»
  // прячется до закрытия клавиатуры — так поля ввода не перекрыты
  const kb = useKeyboardViewport();
  const openSets = () => day.exercises.reduce((n, ex) =>
    ex.kind === "functional" || !ex.name || meta[ex.id]?.done ? n
      : n + (vals[ex.id] || []).filter((_, i) => !meta[ex.id]?.setsDone?.[i]).length, 0);
  const tapSet = (ex: Day["exercises"][number], i: number, total: number) => {
    const was = meta[ex.id]?.setsDone?.[i] ?? false;
    anchor(); // выполненное выше свернётся — нажатая кнопка остаётся под пальцем
    toggleSetDone(ex.id, i, total);
    setOpenDone(keepOpen(ex.id));
    const sec = parseRest(ex.rest);
    if (!was && sec && openSets() > 1) restTimer.start(sec);
  };

  // Live progress: debounced write so trainer sees exercise status in real time
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!onProgress) return;
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      const p: Record<string, { done: boolean; setsDone?: Record<number, boolean>; note?: string }> = {};
      day.exercises.forEach((ex) => { const m = meta[ex.id]; if (m) p[ex.id] = { done: m.done, setsDone: m.setsDone ?? {}, note: m.note }; });
      onProgress(p);
    }, 1500);
    return () => { if (progressTimer.current) clearTimeout(progressTimer.current); };
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalTonnage = day.exercises.reduce((sum, ex) => sum + (ex.kind === "functional" ? 0 : tonnageOf(doneSets(vals[ex.id] || [], meta[ex.id]))), 0);
  const isCircuit = day.method === "circuit";
  const maxRounds = isCircuit && day.exercises.length ? Math.max(1, ...day.exercises.map((ex) => (vals[ex.id] || []).length)) : 0;
  // Блокируем скролл страницы когда сессия открыта
  useEffect(() => {
    document.body.style.overflow = minimized ? "" : "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [minimized]);
  const [step, setStep] = useState<"training" | "feedback">("training");
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<{ metrics: Omit<Metric, "id">[]; session: Omit<Session, "id"> } | null>(null);
  const [mood, setMood] = useState(0);
  const [wellbeing, setWellbeing] = useState(0);
  const [review, setReview] = useState("");

  // Черновик (подходы и отметки) не стираем здесь: до успешной отправки отзыва он нужен,
  // если отправка не удалась или приложение закрыли на экране отзыва
  // Повторный тап по «Завершить», пока открыт вопрос, ничего не делает
  const finishing = useRef(false);
  const finish = async () => {
    if (finishing.current) return;
    finishing.current = true;
    // Есть заполненные, но не отмеченные подходы — спросить; закрыли окно — остаёмся в тренировке
    const m = await askUnmarked(day, vals, meta, true).finally(() => { finishing.current = false; });
    if (!m) return;
    if (m !== meta) setMeta(m);
    const done = day.exercises.filter((ex) => m[ex.id]?.done).length;
    // Метрики — только по отмеченным подходам (неотмеченные — это план)
    const metrics = buildMetrics(day, vals, m);

    const items = day.exercises.filter((ex) => ex.name).map((ex) => {
      const plannedSummary = exSummary(ex) + (ex.rest ? ` · отдых ${ex.rest}` : "");
      // Все подходы по порядку с отметкой done — индексы совпадают с планом
      const actualSets = factSets(vals[ex.id] || [], m[ex.id]);
      const plannedSets: Array<{weight: string; reps: string}> = ex.detailed && ex.setRows?.length
        ? ex.setRows.map((s) => ({ weight: s.weight || "", reps: s.reps || "" }))
        : Array.from({ length: parseInt(ex.sets) || 1 }, () => ({ weight: ex.weight || "", reps: ex.reps || "" }));
      // effort (огоньки) больше не собираем: усилие — RPE в каждом подходе
      return { name: ex.name, effort: 0, rpe: itemRpe(actualSets), note: m[ex.id]?.note || "", actualSets, plannedSets, plannedSummary };
    });
    const session: Omit<Session, "id"> = { date: today(), dayName: day.name, mood: 0, wellbeing: 0, clientRating: 0, review: "", done, total: day.exercises.length, fromClient: true, items };
    setDraft({ metrics, session });
    setStep("feedback");
  };

  const sendFeedback = async () => {
    if (!draft || submitting) return;
    setSubmitting(true);
    try {
      await Promise.resolve(onFinish(draft.metrics, { ...draft.session, mood, wellbeing, clientRating: mood, review }));
      // Отправлено или надёжно лежит в очереди досылки — черновик больше не нужен
      removeKey(`${SK}-vals`);
      removeKey(`${SK}-meta`);
    } catch {
      /* сообщение об ошибке показал onFinish; черновик остаётся — можно повторить */
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (await ask("Прервать тренировку? Несохранённые отметки будут потеряны.", { danger: true, ok: "Прервать" })) {
      removeKey(`${SK}-vals`);
      removeKey(`${SK}-meta`);
      onCancel();
    }
  };

  if (step === "feedback") {
    return (
      // С клавиатурой экран отзыва стоит в видимой над ней области: поле и «Отправить тренеру» не уходят под неё
      <div data-workout className="fixed inset-0 z-50 bg-zinc-950 text-zinc-100 flex flex-col" style={{ "--accent": accent, ...(kb ? { top: kb.top, bottom: kb.bottom } : {}) } as React.CSSProperties}>
        {draftFailed && (
          <div className="shrink-0 flex items-start gap-2 bg-orange-400/10 border-b border-orange-400/25 px-4 py-2 text-[13px] text-orange-300">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>Черновик не сохраняется — в хранилище браузера нет места. Не закрывай экран, пока не завершишь тренировку.</span>
          </div>
        )}
        <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3 flex items-center justify-between shrink-0">
          <h2 className="font-bold">Как прошла тренировка?</h2>
          <button onClick={() => setStep("training")} className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400" title="Закрыть" aria-label="Закрыть"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6 max-w-md w-full mx-auto space-y-5">
          <div>
            <p className="text-sm text-zinc-400 mb-2">Общая оценка тренировки</p>
            <FeelingScale kind="mood" value={mood} onChange={setMood} />
          </div>
          <div>
            <p className="text-sm text-zinc-400 mb-2">Самочувствие после тренировки</p>
            <FeelingScale kind="wellbeing" value={wellbeing} onChange={setWellbeing} />
          </div>
          <div>
            <p className="text-sm text-zinc-400 mb-2">Комментарий тренеру (необязательно)</p>
            <textarea value={review} onChange={(e) => setReview(e.target.value)} rows={3} placeholder="Как себя чувствуешь, что было тяжело..." className="w-full bg-zinc-800 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40 resize-none" />
          </div>
        </div>
        <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-3 shrink-0">
          <button onClick={sendFeedback} disabled={submitting} className="w-full max-w-md mx-auto block text-zinc-950 font-semibold rounded-xl py-2.5 transition disabled:opacity-60 flex items-center justify-center gap-1.5" style={{ background: "var(--accent)" }}><Send size={17} />{submitting ? "Отправка…" : "Отправить тренеру"}</button>
        </div>
      </div>
    );
  }

  if (minimized) {
    return (
      <button data-workout onClick={() => onExpand?.()}
        style={{ "--accent": accent, bottom: "var(--tabbar-h, 0px)" } as React.CSSProperties}
        className="fixed left-0 right-0 z-50 flex items-center gap-3 bg-zinc-900 border-t border-zinc-700 px-4 py-3 text-left hover:bg-zinc-800 transition">
        <Play size={15} style={{ color: "var(--accent)" }} className="shrink-0" />
        <span className="flex-1 font-semibold truncate text-sm">{day.name}</span>
        {restTimer.left > 0 && <span className="font-mono text-sm shrink-0 text-zinc-300">отдых {fmtClock(restTimer.left)}</span>}
        <span className="font-mono text-sm shrink-0" style={{ color: "var(--accent)" }}><SessionTimer startedAt={startedAt} /></span>
        <span className="text-xs text-zinc-500 shrink-0">{doneEx}/{day.exercises.length} упр.</span>
      </button>
    );
  }

  return (
    <div data-workout style={{ "--accent": accent } as React.CSSProperties}>
    <div className="fixed inset-0 z-50 bg-zinc-950 text-zinc-100 flex flex-col" style={kb ? { top: kb.top, bottom: kb.bottom } : undefined}>
      {draftFailed && (
        <div className="shrink-0 flex items-start gap-2 bg-orange-400/10 border-b border-orange-400/25 px-4 py-2 text-[13px] text-orange-300">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>Черновик не сохраняется — в хранилище браузера нет места. Не закрывай экран, пока не завершишь тренировку.</span>
        </div>
      )}
      {/* Ш3 для клиента: таймер, «N из M упр.» и полоса прогресса, как у тренера */}
      <div className="border-b border-zinc-800 bg-zinc-900 px-4 pt-3 pb-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-bold truncate">{day.name}</h2>
            <p className="text-sm text-zinc-500 mt-0.5"><span className="font-mono font-bold text-base text-lime-400 mr-2"><SessionTimer startedAt={startedAt} /></span>{doneEx} из {day.exercises.length} упр.</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onMinimize?.()} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-400" title="Свернуть" aria-label="Свернуть"><Minimize2 size={20} /></button>
            <button onClick={cancel} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-400" title="Прервать" aria-label="Прервать тренировку"><X size={22} /></button>
          </div>
        </div>
        <div className="h-1 mt-2 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full rounded-full bg-lime-400 transition-[width] duration-300" style={{ width: `${day.exercises.length ? (doneEx / day.exercises.length) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 max-w-2xl w-full mx-auto space-y-2.5">
        <LastTimeBar last={lastTime} applied={!!beforeLast} onApply={applyLast} onUndo={undoLast} />
        {day.exercises.length === 0 && <p className="text-zinc-500 text-center py-10">В этом дне нет упражнений.</p>}
        {isCircuit ? Array.from({ length: maxRounds }, (_, r) => (
          <div key={r} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 text-xs font-bold bg-zinc-800/80 text-lime-400">Круг {r + 1} из {maxRounds}</div>
            <div className="flex items-center gap-2 px-3 py-1 text-xs text-zinc-500 border-b border-zinc-800">
              <span className="flex-1 min-w-0">Упражнение</span>
              <span className="w-14 text-center shrink-0">вес, кг</span>
              <span className="w-14 text-center shrink-0">повт.</span>
              <span className="w-11 text-center shrink-0">RPE</span>
              <span className="w-12 shrink-0" />
            </div>
            <div className="divide-y divide-zinc-800">
              {day.exercises.map((ex) => {
                const rows = vals[ex.id] || [];
                if (r >= rows.length || !ex.name) return null;
                const row = rows[r];
                const md = meta[ex.id] || { note: "", done: false, setsDone: {} };
                const isDone = md.setsDone?.[r] ?? false;
                return (
                  <div key={ex.id} className="flex items-center gap-2 px-3 py-2">
                    <span className={`flex-1 min-w-0 truncate text-sm font-medium transition ${isDone ? "text-zinc-500" : ""}`}>{ex.name}</span>
                    {ex.kind === "functional" ? (
                      <span className="text-xs text-zinc-400 shrink-0 text-right">{[ex.duration && `⏱ ${ex.duration}`, ex.weight, ex.pulseZone && `пульс ${ex.pulseZone}`].filter(Boolean).join(" · ") || "функц."}</span>
                    ) : (
                      <>
                        <input value={row.weight} onChange={(e) => setVal(ex.id, r, { weight: e.target.value })} inputMode="decimal" placeholder="кг" className="h-12 w-14 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 shrink-0" />
                        <input value={row.reps} onChange={(e) => setVal(ex.id, r, { reps: e.target.value })} inputMode="numeric" placeholder="повт" className="h-12 w-14 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 shrink-0" />
                        <span className="w-11 shrink-0"><RpePick value={row.rpe} onChange={(v) => setVal(ex.id, r, { rpe: v })} label={`${ex.name}, круг ${r + 1}: RPE`} /></span>
                      </>
                    )}
                    <button onClick={() => tapSet(ex, r, rows.length)} aria-pressed={isDone} aria-label={isDone ? "Снять отметку" : "Отметить выполненным"}
                      className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center transition active:scale-95 ${isDone ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>
                      <Check size={20} strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )) : groupBlocks(day.exercises).map((block, bi) => {
          if (block.group && block.items.length > 1) return (
            <SupersetRounds key={bi} title={`${supersetName(block.items.length)} ${block.group}`} color={GROUP_COLORS[block.group]}
              prev={prevByName} items={block.items} labels={block.items.map((_, k) => exLabel(day, block.startIdx + k))} vals={vals} meta={meta}
              onSetVal={setVal} onTapSet={tapSet} onNote={(id, note) => setMetaFor(id, { note })} />
          );
          const cards = block.items.map((ex, k) => {
            const idx = block.startIdx + k;
            const rows = vals[ex.id] || [];
            const prevSets = prevByName[ex.name.trim().toLowerCase()]?.sets;
            const md = meta[ex.id] || { note: "", done: false };
            const tonnage = ex.kind === "functional" ? 0 : tonnageOf(doneSets(rows, meta[ex.id])); // функциональное: вес тут не про подходы, тоннаж не считаем
            const isCurrent = ex.id === currentId;
            const shell = `bg-zinc-900 border rounded-2xl p-3 transition ${md.done ? "border-lime-400/40" : isCurrent ? "border-lime-400/70 ring-1 ring-lime-400/40" : "border-zinc-800"}`;
            // Выполненное — строкой с фактическими подходами; тап раскрывает обратно
            if (md.done && !openDone[ex.id]) {
              const fact = rows.filter((r) => r.weight || r.reps).map((r) => fmtSet(r.weight, r.reps)).join(", ");
              return (
                <button key={ex.id} data-exid={ex.id} onClick={() => setOpenDone((o) => ({ ...o, [ex.id]: true }))} className={`${shell} !py-2 w-full flex items-center gap-2.5 text-left`}>
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
              <div key={ex.id} data-exid={ex.id} className={shell}>
                <div className="flex items-start justify-between gap-2 mb-2"><div className="min-w-0 flex-1"><h3 className="font-semibold leading-snug"><span className="text-lime-400 mr-1.5">{exLabel(day, idx)}</span>{ex.name || "—"}</h3>{tonnage > 0 && <p className="text-xs text-zinc-500 mt-0.5">тоннаж: <span className="text-orange-400">{fmtTonnage(tonnage)}</span></p>}{md.done && <button onClick={() => setMetaFor(ex.id, { done: false })} className="text-xs text-zinc-500 underline underline-offset-2 py-1 hover:text-zinc-300 transition">Снять отметку</button>}</div><div className="flex items-center gap-1 shrink-0"><button onClick={() => { if (!md.done) setMetaFor(ex.id, { done: true }); setOpenDone((o) => ({ ...o, [ex.id]: false })); }} className={`text-xs px-3 h-11 rounded-lg font-medium transition ${md.done ? "bg-lime-400/20 text-lime-400" : "bg-zinc-800 text-zinc-300 hover:text-zinc-100"}`}>{md.done ? "Свернуть" : "Готово"}</button></div></div>
                {ex.rest && <p className="text-xs text-zinc-500 mb-1.5 flex items-center gap-1"><Timer size={12} className="text-lime-400" /> отдых между подходами: {ex.rest}</p>}
                {ex.kind === "functional" ? (
                <div className="text-sm text-zinc-300 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {ex.duration && <span className="flex items-center gap-1"><Timer size={13} className="text-lime-400" /> {ex.duration}</span>}
                  {ex.weight && <span>вес: {ex.weight}</span>}
                  {ex.pulseZone && <span className="text-cyan-400">пульс: {ex.pulseZone}</span>}
                  {!ex.duration && !ex.weight && !ex.pulseZone && <span className="text-zinc-500">функциональное упражнение</span>}
                </div>
                ) : (
                <div className="space-y-1.5">
                  <div className={`grid ${prevSets ? PREV_COLS : SET_COLS} gap-1.5 text-[11px] text-zinc-500 text-center`}>
                    <span>#</span>{prevSets && <span>было</span>}<span>Вес, кг</span><span>Повторы</span><span>RPE</span><span />
                  </div>
                  {rows.map((r, i) => {
                    const isDone = md.setsDone?.[i] ?? false;
                    return (
                      <div key={i}>
                        <div className={`grid ${prevSets ? PREV_COLS : SET_COLS} gap-1.5 items-center`}>
                          <span className="text-sm font-semibold text-zinc-500 text-center">{i + 1}</span>
{prevSets && <PrevCell p={prevSets[i]} />}
                          <input value={r.weight} onChange={(e) => setVal(ex.id, i, { weight: e.target.value })} inputMode="decimal" placeholder="кг" className={`h-12 w-full min-w-0 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                          <input value={r.reps} onChange={(e) => setVal(ex.id, i, { reps: e.target.value })} inputMode="numeric" placeholder="повт" className={`h-12 w-full min-w-0 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                          <RpePick value={r.rpe} onChange={(v) => setVal(ex.id, i, { rpe: v })} label={`Подход ${i + 1}: RPE`} />
                          <button onClick={() => tapSet(ex, i, rows.length)} aria-pressed={isDone} aria-label={isDone ? `Снять отметку с подхода ${i + 1}` : `Подход ${i + 1} выполнен`}
                            className={`h-12 w-12 rounded-xl flex items-center justify-center transition active:scale-95 ${isDone ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>
                            <Check size={20} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
                <input value={md.note} onChange={(e) => setMetaFor(ex.id, { note: e.target.value })} placeholder="Примечание: как прошло, ощущения..." className="w-full mt-2 bg-zinc-800/60 rounded-lg px-3 h-9 outline-none focus:ring-2 focus:ring-lime-400/60" />
              </div>
            );
          });
          return <div key={bi}>{cards}</div>;
        })}
      </div>

      <RestBar timer={restTimer} />
      {!kb && <div className="border-t border-zinc-800 bg-zinc-900 px-3 pt-2.5 shrink-0" style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}><div className="max-w-2xl mx-auto flex items-center gap-3"><span className="text-sm text-zinc-500"><span className="text-lime-400 font-semibold">{doneEx}</span>/{day.exercises.length} упр.{totalTonnage > 0 && <span className="block text-xs text-orange-400 font-semibold">{fmtTonnage(totalTonnage)}</span>}</span><button onClick={finish} className="ml-auto h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl px-6 text-base hover:bg-lime-300 transition active:scale-[0.98] flex items-center gap-2"><CheckCircle2 size={18} /> Завершить</button></div></div>}
    </div>
    </div>
  );
}
