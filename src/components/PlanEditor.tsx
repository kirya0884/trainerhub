import { BarChart3, BookOpen, CalendarCheck, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clipboard, ClipboardList, ClipboardPaste, Eye, EyeOff, FileStack, Flame, HeartPulse, History, Layers, MessageSquare, Pencil, Play, Plus, Printer, Repeat, RotateCcw, Trash, Trash2, TrendingUp, User, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GROUP_COLORS, GROUP_CYCLE, MOOD_EMOJI, WELL_EMOJI } from "../constants";
import { usePlan } from "../hooks/usePlan";
import { useExerciseLibrary } from "../hooks/useExerciseLibrary";
import { useProgress } from "../hooks/useProgress";
import { decrementMembershipRemaining, incrementMembershipRemaining, fetchClient, sessionPrice, combinedRemaining, type Membership } from "../lib/clients";
import { fmtDate, today } from "../lib/format";
import type { DeleteReason } from "../lib/progress";
import * as paymentsApi from "../lib/payments";
import { markSessionDone } from "../lib/bookings";
import * as templatesApi from "../lib/templates";
import type { Day, Metric, Session } from "../types";
import DeleteSessionModal from "./DeleteSessionModal";
import RemainingBadge from "./RemainingBadge";
import ExerciseRow from "./ExerciseRow";
import LibraryModal from "./LibraryModal";
import MetricsView from "./MetricsView";
import ModalShell from "./ModalShell";
import PeriodizationModal from "./PeriodizationModal";
import PlanPrintView from "./PlanPrintView";
import PlanVersionsModal from "./PlanVersionsModal";
import SessionModal from "./SessionModal";
import SessionReadModal from "./SessionReadModal";
import TemplatesModal from "./TemplatesModal";
import DayTemplateLibrary from "./DayTemplateLibrary";

const exLabel = (day: Day, idx: number) => {
  const ex = day.exercises[idx];
  if (!ex.group) return `${idx + 1}`;
  let pos = 0;
  for (let i = 0; i <= idx; i++) if (day.exercises[i].group === ex.group) pos++;
  return `${ex.group}${pos}`;
};
const SUPERSET_NAME: Record<number, string> = { 2: "Двусет", 3: "Трисет" };
const supersetName = (n: number) => SUPERSET_NAME[n] || "Суперсет";
// Группирует подряд идущие упражнения с одинаковой меткой группы — чтобы рисовать их единым блоком.
const groupBlocks = (exercises: Day["exercises"]) => {
  const blocks: { group: string | null; startIdx: number; items: Day["exercises"] }[] = [];
  exercises.forEach((ex, idx) => {
    const last = blocks[blocks.length - 1];
    if (ex.group && last?.group === ex.group) last.items.push(ex);
    else blocks.push({ group: ex.group || null, startIdx: idx, items: [ex] });
  });
  return blocks;
};

export default function PlanEditor({ planId, trainerId, clientId }: { planId: string; trainerId: string; clientId: string }) {
  const { plan, loading, error, updatePlanMeta, addDay, updateDay, deleteDay, reorderDays, addExercise, updateExercise, deleteExercise, reorderExercises, addMesocycle, updateMesocycle, deleteMesocycle, reload } = usePlan(planId);
  const { allNames, customNames, addToLibrary } = useExerciseLibrary(trainerId);
  const { progress, metrics, sessions, deletedSessions, addProgress, updateProgress, deleteProgress, addMetric, deleteMetric, deleteSession, restoreSession, purgeSession, updateSessionReview, logSession } = useProgress(planId);
  // Последний задокументированный результат по каждому упражнению (metrics отсортированы ascending — берём последнее)
  const lastMetrics = useMemo(() => Object.fromEntries(metrics.map((m) => [m.exercise.toLowerCase(), m])), [metrics]);
  const COLLAPSED_KEY = `trainerhub-collapsed-${planId}`;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    () => { try { return JSON.parse(localStorage.getItem(`trainerhub-collapsed-${planId}`) || "{}"); } catch { return {}; } }
  );
  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSaving = () => {
    setSaveStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveStatus('saved'), 700);
  };
  const CLIP_KEY = "trainerhub-day-clipboard";
  const CLIP_TTL = 600_000; // 10 min
  const loadClip = (): { name: string; exercises: Day["exercises"] } | null => {
    try {
      const raw = sessionStorage.getItem(CLIP_KEY);
      if (!raw) return null;
      const { day, copiedAt } = JSON.parse(raw);
      if (Date.now() - copiedAt > CLIP_TTL) { sessionStorage.removeItem(CLIP_KEY); return null; }
      return day;
    } catch { return null; }
  };
  const [dayClipboard, setDayClipboard] = useState<{ name: string; exercises: Day["exercises"] } | null>(() => loadClip());
  const copyDay = (day: { name: string; exercises: Day["exercises"] }) => {
    const d = { name: day.name, exercises: day.exercises };
    sessionStorage.setItem(CLIP_KEY, JSON.stringify({ day: d, copiedAt: Date.now() }));
    setDayClipboard(d);
    // Expire UI state after TTL (sessionStorage already has timestamp-based check)
    setTimeout(() => setDayClipboard(loadClip()), CLIP_TTL + 100);
  };
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2000); };
  const copySessionAsDay = (s: Session) => {
    // Полное копирование: факт (actualSets) > план сессии (plannedSets) > упражнение из текущего плана.
    // rest/tempo/видео и пр. подтягиваем из одноимённого упражнения плана — в сессии они не хранятся.
    const planDay = plan?.days.find((d) => d.name === s.dayName);
    const planExByName = (name: string) => planDay?.exercises.find((e) => e.name === name);
    const hasAnySets = s.items?.some((i) => i.actualSets?.length || i.plannedSets?.length);
    if (hasAnySets) {
      const exercises: Day["exercises"] = (s.items ?? []).map((item) => {
        const src = item.actualSets?.length ? item.actualSets : item.plannedSets ?? [];
        const pe = planExByName(item.name);
        return {
          id: crypto.randomUUID(), name: item.name,
          sets: String(src.length || parseInt(pe?.sets || "") || 3),
          reps: src[0]?.reps || pe?.reps || "",
          weight: src[0]?.weight || pe?.weight || "",
          rest: pe?.rest || "", note: item.note || pe?.note || "", video: pe?.video || "", group: pe?.group || "",
          detailed: src.length > 0, tempo: pe?.tempo || "", duration: pe?.duration || "", target: pe?.target || "",
          kind: pe?.kind || "", pulseZone: pe?.pulseZone || "",
          setRows: src.map((r) => ({ id: crypto.randomUUID(), weight: String(r.weight ?? ""), reps: String(r.reps ?? "") })),
        };
      });
      copyDay({ name: s.dayName || "Тренировка", exercises });
      showToast("Скопировано в буфер обмена");
      return;
    }
    if (planDay) { copyDay(planDay); showToast("Скопировано в буфер обмена"); return; }
    // Fallback: только названия упражнений (в сессии нет ни подходов, ни плана)
    const exercises: Day["exercises"] = (s.items ?? []).map((item) => ({
      id: crypto.randomUUID(), name: item.name, sets: "3", reps: "", weight: "",
      rest: "", note: item.note || "", video: "", group: "", detailed: false, tempo: "", duration: "", target: "", kind: "", pulseZone: "", setRows: [],
    }));
    copyDay({ name: s.dayName || "Тренировка", exercises });
    showToast("Скопировано в буфер обмена");
  };
  const handleCreateDay = async () => {
    if (!newDayName?.trim()) return;
    try {
      await addDay(newDayName.trim());
      setNewDayName(null);
    } catch (e) {
      console.error("[PlanEditor] handleCreateDay:", e);
      alert("Не удалось добавить день. Попробуй ещё раз.");
    }
  };
  const handlePasteDay = async () => {
    if (!dayClipboard || !pasteInput?.trim()) return;
    try {
      await templatesApi.applyDayTemplate(planId, { id: "", name: pasteInput.trim(), weekday: null, exercises: dayClipboard.exercises } as Day, (plan?.days.length ?? 0));
      reload();
      setPasteInput(null);
    } catch (e) {
      console.error("Paste day failed:", e);
      showToast("Ошибка при вставке дня");
    }
  };
  const [libFor, setLibFor] = useState<string | null>(null);
  const [sub, setSub] = useState<"workout" | "done" | "progress">("workout");
  const [sessionDay, setSessionDay] = useState<Day | null>(null);
  const [returnedDayIds, setReturnedDayIds] = useState<Set<string>>(new Set());
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [showMembership, setShowMembership] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [viewingSession, setViewingSession] = useState<typeof sessions[0] | null>(null);
  const [showSessionTrash, setShowSessionTrash] = useState(false);
  const [openJournal, setOpenJournal] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showMeso, setShowMeso] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showDayLibrary, setShowDayLibrary] = useState(false);
  const [newDayName, setNewDayName] = useState<string | null>(null);
  const [pasteInput, setPasteInput] = useState<string | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [addingSession, setAddingSession] = useState(false);
  const [clientName, setClientName] = useState("");
  const toggleCollapse = (id: string) => setCollapsed((c) => {
    const next = { ...c, [id]: !c[id] };
    localStorage.setItem(`trainerhub-collapsed-${planId}`, JSON.stringify(next));
    return next;
  });
  const cycleGroup = (dayId: string, exId: string, cur: string, exercises: Day["exercises"]) => {
    const i = GROUP_CYCLE.indexOf(cur || "");
    markSaving(); updateExercise(dayId, exId, { group: GROUP_CYCLE[(i + 1) % GROUP_CYCLE.length] });
  };

  useEffect(() => {
    let alive = true;
    fetchClient(clientId)
      .then((c) => { if (alive) { setMembership(c.membership); setClientName(c.name); } })
      .catch((e) => console.error("[PlanEditor] fetchClient:", e));
    return () => { alive = false; };
  }, [clientId]);

  const finishSession = async (m: Omit<Metric, "id">[], note: string, session: Omit<Session, "id">) => {
    try {
      await logSession(m, note, session);
      // ponytail: новая сессия за сегодня — сбрасываем флаг "вернули в Тренировки", чтобы день снова ушёл в Проведенные
      if (sessionDay) {
        setReturnedDayIds((s) => (s.has(sessionDay.id) ? new Set([...s].filter((id) => id !== sessionDay.id)) : s));
        markSessionDone(trainerId, clientId, sessionDay.name, today()); // fire-and-forget: mark calendar booking done
      }
      // Гард двойного списания: если клиент уже залогировал эту же сессию (fromClient=true), тренер не декрементирует повторно.
      const alreadyLoggedByClient = sessions.some((s) => s.dayName === session.dayName && s.date === session.date && s.fromClient);
      if (membership && !alreadyLoggedByClient) setMembership(await decrementMembershipRemaining(clientId, membership));
    } catch (e: any) {
      console.error("[PlanEditor] finishSession:", e);
      throw e;
    }
  };

  // ponytail: ручное добавление разовой тренировки к остатку — платная пишется в журнал платежей (учитывается в статистике заработка), бесплатная — только +1 к остатку
  const addSingleSession = async (paid: boolean) => {
    if (!membership || addingSession) return;
    setAddingSession(true);
    try {
      const next = await incrementMembershipRemaining(clientId, membership);
      if (paid) await paymentsApi.addPayment(clientId, { date: today(), amount: sessionPrice(membership), type: "single", note: "Разовая тренировка" }, 1);
      setMembership(next);
    } catch (e: any) {
      alert(e.message || "Не удалось добавить тренировку");
    } finally {
      setAddingSession(false);
    }
  };

  const confirmDeleteSession = async (reason: DeleteReason) => {
    if (!deletingSessionId) return;
    try {
      await deleteSession(deletingSessionId, reason);
      if (reason === "Уважительная" && membership) setMembership(await incrementMembershipRemaining(clientId, membership));
    } catch (e: any) {
      console.error("[PlanEditor] confirmDeleteSession:", e);
      alert("Не удалось удалить тренировку. Попробуй ещё раз.");
    } finally {
      setDeletingSessionId(null);
    }
  };

  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1)), [sessions]);
  const lastSessionOf = (day: Day) => sortedSessions.find((s) => s.dayName === day.name);
  const isDoneToday = (day: Day) => lastSessionOf(day)?.date === today() && !returnedDayIds.has(day.id);

  if (loading) return <div className="text-zinc-500 text-sm p-4">Загрузка плана…</div>;
  if (error) return <div className="text-red-400 text-sm p-4">Ошибка: {error}</div>;
  if (!plan) return null;

  // ponytail: тело дня (упражнения) — общий рендер для инлайн-режима во вкладке «Тренировки» и для модалки редактирования из «Проведенные»
  const DayBody = ({ day }: { day: Day }) => (
    <div className="p-3 space-y-2">
      {groupBlocks(day.exercises).map((block, bi) => {
        const rows = block.items.map((ex, k) => {
          const ei = block.startIdx + k;
          return (
            <ExerciseRow key={ex.id} ex={ex} label={exLabel(day, ei)} groupColor={ex.group ? GROUP_COLORS[ex.group] : null} suggestions={allNames} addToLibrary={addToLibrary}
              canMoveUp={ei > 0} canMoveDown={ei < day.exercises.length - 1}
              onMoveUp={() => reorderExercises(day.id, ei, ei - 1)} onMoveDown={() => reorderExercises(day.id, ei, ei + 1)}
              cycleGroup={() => cycleGroup(day.id, ex.id, ex.group, day.exercises)}
              update={(patch) => { markSaving(); updateExercise(day.id, ex.id, patch); }} remove={() => deleteExercise(day.id, ex.id)}
              lastMetric={lastMetrics[ex.name.toLowerCase()]} />
          );
        });
        if (block.group && block.items.length > 1) {
          const color = GROUP_COLORS[block.group];
          return (
            <div key={bi} className="rounded-xl border-2 overflow-hidden" style={{ borderColor: color }}>
              <div className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ background: `${color}26`, color }}>
                <Layers size={12} /> {supersetName(block.items.length)} {block.group} · {block.items.length} упражнения подряд
              </div>
              <div className="p-1.5 space-y-1.5">{rows}</div>
            </div>
          );
        }
        return <div key={bi}>{rows}</div>;
      })}
      <div className="flex gap-2">
        <button onClick={() => setLibFor(day.id)} className="flex-1 flex items-center justify-center gap-1.5 text-sm text-zinc-300 bg-zinc-800/60 hover:bg-zinc-800 rounded-lg py-2 transition"><BookOpen size={15} /> Из библиотеки</button>
        <button onClick={() => addExercise(day.id)} className="flex-1 flex items-center justify-center gap-1.5 text-sm text-zinc-400 hover:text-lime-400 border border-dashed border-zinc-700 hover:border-lime-400/40 rounded-lg py-2 transition"><Plus size={15} /> Вручную</button>
      </div>
    </div>
  );
  const editingDay = editingDayId ? plan.days.find((d) => d.id === editingDayId) || null : null;

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="flex items-center gap-1.5">
          <input value={plan.name} onChange={(e) => { markSaving(); updatePlanMeta({ name: e.target.value }); }} className="flex-1 min-w-0 bg-transparent text-xl font-bold outline-none border-b border-transparent focus:border-lime-400/50 pb-1" placeholder="Название плана" />
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => setShowTemplates(true)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-lime-400 transition" title="Шаблоны"><FileStack size={15} /></button>
            <button onClick={() => setShowVersions(true)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-lime-400 transition" title="История версий"><History size={15} /></button>
            <button onClick={() => setShowMeso(true)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-lime-400 transition" title="Генератор мезоцикла"><Repeat size={15} /></button>
            <button onClick={() => setShowPrint(true)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-lime-400 transition" title="Печать / PDF"><Printer size={15} /></button>
            <button onClick={() => { markSaving(); updatePlanMeta({ visibleToClient: plan.visibleToClient === false ? true : false }); }} className={`p-1.5 rounded-lg hover:bg-zinc-800 transition ${plan.visibleToClient === false ? "text-orange-400" : "text-zinc-400 hover:text-lime-400"}`} title={plan.visibleToClient === false ? "Скрыт от клиента — показать" : "Скрыть от клиента"}>{plan.visibleToClient === false ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </div>
          <span className={`text-xs shrink-0 transition-all duration-300 ${saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}`}>
            {saveStatus === 'saving' ? <span className="text-zinc-500">Сохранение…</span> : <span className="text-lime-400">✓ Сохранено</span>}
          </span>
          {clientName && (
            <span className="flex items-center gap-1.5 text-sm text-zinc-400 shrink-0 max-w-[100px] sm:max-w-none">
              {membership?.type === "sessions" && <RemainingBadge remaining={membership.remaining !== "" ? String(combinedRemaining(membership)) : null} />}
              <User size={14} className="text-zinc-500 shrink-0" />
              <span className="truncate">{clientName}</span>
            </span>
          )}
        </div>
        <input value={plan.note} onChange={(e) => { markSaving(); updatePlanMeta({ note: e.target.value }); }} placeholder="Заметка к плану — напр. прогрессия каждые 2 недели" className="w-full mt-3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50" />
        {plan.visibleToClient === false && (
          <div className="flex items-center gap-2 bg-orange-400/10 border border-orange-400/20 rounded-lg px-3 py-2 text-sm text-orange-400 mt-2">
            <EyeOff size={14} /> Программа скрыта от клиента — нажми глаз выше, чтобы показать
          </div>
        )}
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5 mt-4 overflow-x-auto">
          <button onClick={() => setSub("workout")} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition whitespace-nowrap ${sub === "workout" ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}><ClipboardList size={14} /> Тренировки</button>
          <button onClick={() => setSub("done")} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition whitespace-nowrap ${sub === "done" ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}><CheckCircle2 size={14} /> Проведенные</button>
          <button onClick={() => setSub("progress")} className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition whitespace-nowrap ${sub === "progress" ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}><TrendingUp size={14} /> Прогрессия</button>
        </div>
        {membership && (
          <button onClick={() => setShowMembership(true)} className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 transition mt-2">
            <Wallet size={14} className="text-lime-400 shrink-0" />
            <span className="truncate">{membership.type === "subscription" ? `След. платёж: ${fmtDate(membership.nextPaymentDate)}` : `Абонемент: ${combinedRemaining(membership)} тр.`}</span>
          </button>
        )}
      </div>

      {showTemplates && (
        <TemplatesModal
          trainerId={trainerId}
          currentDays={plan.days}
          onApplyPlan={async (days) => { try { await templatesApi.applyPlanTemplate(plan.id, days, plan.days.length); reload(); } catch (e) { console.error("[PlanEditor] applyPlan:", e); alert("Ошибка применения шаблона. Попробуй ещё раз."); } finally { setShowTemplates(false); } }}
          onApplyDay={async (day) => { try { await templatesApi.applyDayTemplate(plan.id, day, plan.days.length); reload(); } catch (e) { console.error("[PlanEditor] applyDay:", e); alert("Ошибка применения шаблона. Попробуй ещё раз."); } finally { setShowTemplates(false); } }}
          onClose={() => setShowTemplates(false)}
        />
      )}
      {showPrint && <PlanPrintView plan={plan} trainerId={trainerId} clientName={clientName} onClose={() => setShowPrint(false)} />}
      {showMeso && <PeriodizationModal days={plan.days} planId={plan.id} onClose={() => setShowMeso(false)} onDone={() => { setShowMeso(false); reload(); }} />}
      {showVersions && <PlanVersionsModal planId={plan.id} onClose={() => setShowVersions(false)} onRestored={() => { setShowVersions(false); reload(); }} />}
      {showDayLibrary && plan && <DayTemplateLibrary trainerId={trainerId} planId={planId} dayCount={plan.days.length} onInserted={() => { setShowDayLibrary(false); reload(); }} onClose={() => setShowDayLibrary(false)} />}

      {showMembership && membership && (
        <ModalShell title="Абонемент" icon={<Wallet size={17} className="text-lime-400" />} onClose={() => setShowMembership(false)}>
          <div className="p-4 space-y-3 text-sm">
            <p className="text-zinc-400">Тип оплаты: <span className="text-zinc-100 font-medium">{membership.type === "subscription" ? "Подписка" : "По тренировкам"}</span></p>
            {membership.type === "subscription" ? (
              <>
                <p className="text-zinc-400">Дата след. платежа: <span className="text-zinc-100 font-medium">{fmtDate(membership.nextPaymentDate)}</span></p>
                <p className="text-zinc-400">Сумма подписки: <span className="text-zinc-100 font-medium">{membership.pricePerSession || 0} ₽</span></p>
              </>
            ) : (
              <>
                <p className="text-zinc-400">Осталось тренировок: <span className="text-zinc-100 font-medium">{membership.remaining || 0} из {membership.remainingTotal || membership.total || 0}</span></p>
                {Number(membership.extraRemaining) > 0 && (
                  <p className="text-zinc-400">+ доп. блок: <span className="text-cyan-300 font-medium">{membership.extraRemaining} по {Math.round(Number(membership.extraPricePerSession) || 0)} ₽/занятие</span></p>
                )}
                <p className="text-zinc-400">Цена занятия: <span className="text-zinc-100 font-medium">{Math.round(sessionPrice(membership))} ₽</span></p>
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <span className="text-zinc-500 text-xs">Добавить тренировку:</span>
                  <button onClick={() => addSingleSession(true)} disabled={addingSession} className="flex items-center gap-1 text-xs bg-lime-400/15 text-lime-400 hover:bg-lime-400/25 rounded-lg px-2.5 py-1.5 transition disabled:opacity-50"><Plus size={12} /> Платная</button>
                  <button onClick={() => addSingleSession(false)} disabled={addingSession} className="flex items-center gap-1 text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded-lg px-2.5 py-1.5 transition disabled:opacity-50"><Plus size={12} /> Бесплатная</button>
                </div>
              </>
            )}
            {membership.note && <p className="text-zinc-500 text-xs border-t border-zinc-800 pt-2">{membership.note}</p>}
            {sortedSessions.length > 0 && (
              <div className="border-t border-zinc-800 pt-2 space-y-1.5">
                <p className="text-zinc-400 flex items-center gap-1.5"><CalendarCheck size={14} className="text-lime-400" /> Даты тренировок ({sortedSessions.length})</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {sortedSessions.map((s) => (
                    <div key={s.id} className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-2.5 py-1.5 text-xs"><span className="text-zinc-200">{fmtDate(s.date)}</span><span className="text-zinc-500 truncate">{s.dayName}</span></div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-zinc-600 text-xs">Изменить можно во вкладке «Абонемент» в карточке подопечного.</p>
          </div>
        </ModalShell>
      )}

      {deletingSessionId && <DeleteSessionModal onConfirm={confirmDeleteSession} onClose={() => setDeletingSessionId(null)} />}

      {sub === "progress" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <h3 className="font-semibold flex items-center gap-1.5 mb-3"><BarChart3 size={16} className="text-lime-400" /> Прогрессия</h3>
          <MetricsView days={plan.days} metrics={metrics} addMetric={addMetric} deleteMetric={deleteMetric} />
        </div>
      )}

      {sub === "done" && (
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
            <h3 className="font-semibold flex items-center gap-1.5"><CheckCircle2 size={16} className="text-lime-400" /> Проведено сегодня</h3>
            {plan.days.filter(isDoneToday).length === 0 && <p className="text-sm text-zinc-600 text-center py-4">Сегодня тренировок не проведено.</p>}
            {plan.days.filter(isDoneToday).map((day) => (
              <div key={day.id} className="flex items-center gap-1.5 bg-zinc-800/40 rounded-xl px-3 py-2.5">
                <span className="flex-1 min-w-0 font-semibold truncate">{day.name}</span>
                <span className="flex items-center gap-1 text-[11px] font-medium text-lime-400 bg-lime-400/10 rounded-full px-2 py-1 shrink-0"><CheckCircle2 size={12} /> Проведена</span>
                <button onClick={() => setEditingDayId(day.id)} className="p-1.5 rounded-md hover:bg-cyan-400/15 hover:text-cyan-400 text-zinc-500 transition shrink-0" title="Редактировать в отдельном окне"><Pencil size={15} /></button>
                <button onClick={() => setReturnedDayIds((s) => new Set(s).add(day.id))} className="p-1.5 rounded-md hover:bg-lime-400/15 hover:text-lime-400 text-zinc-500 transition shrink-0" title="Вернуть в Тренировки"><RotateCcw size={15} /></button>
                <button onClick={() => { if (window.confirm(`Удалить день «${day.name}»?`)) deleteDay(day.id); }} className="p-1.5 rounded-md hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0" title="Удалить"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl">
            <button onClick={() => setOpenHistory((v) => !v)} className="w-full flex items-center justify-between gap-2 p-4">
              <h3 className="font-semibold flex items-center gap-1.5"><HeartPulse size={16} className="text-lime-400" /> История тренировок {sortedSessions.length > 0 && <span className="text-zinc-500 font-normal">({sortedSessions.length})</span>}</h3>
              {openHistory ? <ChevronDown size={18} className="text-zinc-400" /> : <ChevronRight size={18} className="text-zinc-400" />}
            </button>
            {openHistory && (
              <div className="px-4 pb-4 space-y-3">
                {deletedSessions.length > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); setShowSessionTrash((v) => !v); }} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"><Trash size={13} /> Корзина ({deletedSessions.length})</button>
                )}
                {showSessionTrash && (
                  <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                    {deletedSessions.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 text-xs bg-zinc-800/40 rounded-lg px-2.5 py-1.5">
                        <div className="min-w-0"><p className="text-zinc-300 truncate">{d.dayName || "Тренировка"} · {fmtDate(d.date)}</p><p className="text-zinc-500">Причина: {d.deleteReason} · удалено {fmtDate(d.deletedAt.slice(0, 10))}</p></div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => restoreSession(d.id)} className="p-1 rounded hover:bg-lime-400/20 hover:text-lime-400 text-zinc-500 transition" title="Восстановить"><RotateCcw size={13} /></button>
                          <button onClick={() => window.confirm("Удалить безвозвратно?") && purgeSession(d.id)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition" title="Удалить навсегда"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {sortedSessions.length === 0 && <p className="text-sm text-zinc-600 text-center py-4">Пока нет проведённых тренировок.</p>}
                <div className="space-y-2">
                  {sortedSessions.map((s) => {
                    const editing = editingSessionId === s.id;
                    const hasEmoji = s.wellbeing || s.mood || !!s.clientRating;
                    return (
                      <div key={s.id} className="bg-zinc-800/40 rounded-xl p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-sm leading-snug">{s.dayName || "Тренировка"}</p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className="text-xs text-zinc-500">{fmtDate(s.date)}</span>
                              <span className="text-zinc-700">·</span>
                              <span className="text-xs text-zinc-500">{s.done}/{s.total} упр.</span>
                              {s.fromClient && <span className="text-[10px] bg-cyan-400/10 text-cyan-400 rounded-full px-1.5 py-0.5 leading-none">клиент</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button onClick={() => setViewingSession(s)} className="p-1.5 rounded hover:bg-zinc-700 text-zinc-600 hover:text-lime-400 transition" title="Просмотреть тренировку"><Eye size={13} /></button>
                            <button onClick={() => copySessionAsDay(s)} className="p-1.5 rounded hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition" title="Копировать тренировку как день"><Clipboard size={13} /></button>
                            <button onClick={() => setEditingSessionId(editing ? null : s.id)} className={`p-1.5 rounded transition ${editing ? "bg-cyan-400/20 text-cyan-400" : "hover:bg-zinc-700 text-zinc-500"}`} title="Редактировать отзыв"><Pencil size={13} /></button>
                            <button onClick={() => setDeletingSessionId(s.id)} className="p-1.5 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition"><X size={13} /></button>
                          </div>
                        </div>
                        {hasEmoji && (
                          <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
                            {s.wellbeing && <span>Самочувствие <span className="text-base">{WELL_EMOJI[s.wellbeing - 1]}</span></span>}
                            {s.mood && <span>Настроение <span className="text-base">{MOOD_EMOJI[s.mood - 1]}</span></span>}
                            {!!s.clientRating && <span>Оценка <span className="text-lime-400 font-semibold">{s.clientRating}/5</span></span>}
                          </div>
                        )}
                        {s.items?.some((i) => i.effort) && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                            {s.items.filter((i) => i.effort).map((i, idx) => (
                              <span key={idx} className="flex items-center gap-1">{i.name}: {Array.from({ length: i.effort }).map((_, k) => <Flame key={k} size={11} className="text-orange-400" />)}</span>
                            ))}
                          </div>
                        )}
                        {s.items?.some((i) => i.rpe > 0) && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                            {s.items.filter((i) => i.rpe > 0).map((i, idx) => (
                              <span key={idx} className="flex items-center gap-1 bg-zinc-700/40 rounded px-1.5 py-0.5">
                                <span className="text-zinc-400 truncate max-w-[80px]">{i.name}:</span>
                                <span className="text-cyan-400 font-semibold">RPE {i.rpe}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {editing ? (
                          <textarea value={s.review} onChange={(e) => updateSessionReview(s.id, e.target.value)} rows={2} placeholder="Отзыв клиента..." className="w-full text-sm bg-zinc-900/60 rounded-lg p-2 outline-none focus:ring-1 focus:ring-cyan-400/40 resize-none" />
                        ) : (
                          s.review && <p className="text-sm text-zinc-300 bg-zinc-900/60 rounded-lg p-2.5 whitespace-pre-wrap">{s.review}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {sub === "workout" && <>
      {(() => {
        const sortedMesos = [...(plan.mesocycles ?? [])].sort((a, b) => a.position - b.position);
        const hasMesos = sortedMesos.length > 0;
        const renderDayCard = (day: Day, di: number) => {
          const isOpen = !collapsed[day.id];
          const lastSession = lastSessionOf(day);
          const hidden = day.visibleToClient === false;
          return (
            <div key={day.id} className={`bg-zinc-900 border rounded-xl ${hidden ? "border-orange-400/20 opacity-80" : "border-zinc-800"}`}>
              <div className="flex items-center gap-1 px-3 py-2.5 bg-zinc-800/40 border-b border-zinc-800 rounded-t-xl">
                <button onClick={() => toggleCollapse(day.id)} className="p-1 rounded-md hover:bg-zinc-700 text-zinc-400 transition shrink-0">{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
                <span className="flex flex-col -my-1 shrink-0">
                  <button onClick={() => reorderDays(di, di - 1)} disabled={di === 0} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"><ChevronUp size={14} /></button>
                  <button onClick={() => reorderDays(di, di + 1)} disabled={di === plan.days.length - 1} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"><ChevronDown size={14} /></button>
                </span>
                <input value={day.name} onChange={(e) => { markSaving(); updateDay(day.id, { name: e.target.value }); }} className={`flex-1 min-w-0 bg-transparent font-semibold outline-none border-b border-transparent focus:border-lime-400/50 pb-0.5 ${hidden ? "text-zinc-500" : ""}`} placeholder="Название дня" />
                {hasMesos && (
                  <select value={day.mesocycleId ?? ""} onChange={(e) => { markSaving(); updateDay(day.id, { mesocycleId: e.target.value || null }); }}
                    className="bg-zinc-800 border border-zinc-700 rounded-md text-xs px-1.5 py-1 outline-none focus:border-cyan-400/40 text-zinc-300 shrink-0 max-w-[80px]">
                    <option value="">—</option>
                    {sortedMesos.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}
                <button onClick={() => { markSaving(); updateDay(day.id, { visibleToClient: hidden ? true : false }); }}
                  className={`p-1.5 rounded-md transition shrink-0 ${hidden ? "text-orange-400 hover:bg-orange-400/15" : "text-zinc-500 hover:bg-zinc-700 hover:text-lime-400"}`}
                  title={hidden ? "Скрыт от клиента — показать" : "Скрыть день от клиента"}>
                  {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button onClick={() => { markSaving(); updateDay(day.id, { method: day.method === "circuit" ? "" : "circuit" }); }}
                  className={`p-1.5 rounded-md transition shrink-0 ${day.method === "circuit" ? "text-cyan-400 bg-cyan-400/10" : "text-zinc-500 hover:bg-zinc-700 hover:text-cyan-400"}`}
                  title={day.method === "circuit" ? "Круговая тренировка — переключить на обычную" : "Сделать круговой тренировкой (подходы кругами)"}>
                  <Repeat size={14} />
                </button>
                {lastSession && <span className="text-[11px] text-zinc-500 shrink-0 hidden sm:inline" title="Дата последнего проведения">{fmtDate(lastSession.date, true)}</span>}
                <input type="date" value={day.dateOf ?? ""} onChange={(e) => { markSaving(); updateDay(day.id, { dateOf: e.target.value || null }); }} className="bg-zinc-800 rounded-md text-xs px-1.5 py-1 outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0 text-zinc-300 w-36 hidden sm:block" />
                <button onClick={() => setSessionDay(day)} className="p-1.5 rounded-md hover:bg-lime-400/15 hover:text-lime-400 text-zinc-500 transition shrink-0" title="Провести тренировку"><Play size={15} /></button>
                <button onClick={() => copyDay(day)} className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition shrink-0" title="Копировать день"><Clipboard size={15} /></button>
                <button onClick={() => { if (window.confirm(`Удалить день «${day.name}»?`)) deleteDay(day.id); }} className="p-1.5 rounded-md hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><Trash2 size={15} /></button>
              </div>
              {isOpen && DayBody({ day })}
            </div>
          );
        };

        if (!hasMesos) {
          return plan.days.map((day, di) => isDoneToday(day) ? null : renderDayCard(day, di));
        }

        return (
          <>
            {sortedMesos.map((meso) => {
              const mesoHidden = meso.visibleToClient === false;
              const mesoDays = plan.days.map((day, di) => ({ day, di })).filter(({ day }) => day.mesocycleId === meso.id);
              return (
                <div key={meso.id} className="space-y-2">
                  <div className={`flex items-center gap-2 border rounded-xl px-3 py-2 ${mesoHidden ? "border-orange-400/20 bg-orange-400/5" : "border-cyan-400/20 bg-zinc-900/80"}`}>
                    <Layers size={14} className={`shrink-0 ${mesoHidden ? "text-orange-400" : "text-cyan-400"}`} />
                    <input value={meso.name} onChange={(e) => updateMesocycle(meso.id, { name: e.target.value })}
                      className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none border-b border-transparent focus:border-cyan-400/50 pb-0.5"
                      style={{ color: mesoHidden ? "#fb923c" : "#67e8f9" }} placeholder="Название блока" />
                    <span className="text-xs text-zinc-600 shrink-0">{mesoDays.length} дн.</span>
                    <button onClick={() => { markSaving(); updateMesocycle(meso.id, { visibleToClient: mesoHidden ? true : false }); }}
                      className={`p-1.5 rounded-md transition shrink-0 ${mesoHidden ? "text-orange-400" : "text-zinc-500 hover:text-lime-400"}`}
                      title={mesoHidden ? "Скрыт от клиента — показать" : "Скрыть блок от клиента"}>
                      {mesoHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button onClick={() => { if (window.confirm(`Удалить блок «${meso.name}»? Дни останутся без блока.`)) deleteMesocycle(meso.id); }}
                      className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-600 transition shrink-0"><X size={13} /></button>
                  </div>
                  {mesoDays.filter(({ day }) => !isDoneToday(day)).map(({ day, di }) => renderDayCard(day, di))}
                </div>
              );
            })}
            {plan.days.map((day, di) => ({ day, di })).filter(({ day }) => !day.mesocycleId && !isDoneToday(day)).map(({ day, di }) => renderDayCard(day, di))}
          </>
        );
      })()}

      {newDayName !== null ? (
        <div className="flex gap-2 bg-zinc-900 border border-zinc-800 rounded-xl p-2">
          <input autoFocus value={newDayName} onChange={(e) => setNewDayName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newDayName.trim()) handleCreateDay(); if (e.key === "Escape") setNewDayName(null); }}
            placeholder="Название дня" className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          <button onClick={handleCreateDay} disabled={!newDayName.trim()} className="px-3 py-2 text-sm rounded-lg bg-lime-400 text-zinc-950 font-semibold hover:bg-lime-300 transition disabled:opacity-40">Создать</button>
          <button onClick={() => setNewDayName(null)} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 transition"><X size={16} /></button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button onClick={() => setNewDayName("")} className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:border-lime-400/40 rounded-xl py-2 text-sm font-medium text-zinc-300 hover:text-lime-400 transition"><Plus size={15} /> Добавить день</button>
          <button onClick={() => setShowDayLibrary(true)} className="flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:border-cyan-400/40 rounded-xl py-2 px-3 text-sm font-medium text-zinc-400 hover:text-cyan-400 transition whitespace-nowrap"><BookOpen size={14} /> Шаблоны</button>
          <button onClick={addMesocycle} className="flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:border-cyan-400/40 rounded-xl py-2 px-3 text-sm font-medium text-zinc-400 hover:text-cyan-400 transition whitespace-nowrap"><Layers size={14} /> Блок</button>
        </div>
      )}
      {pasteInput !== null ? (
        <div className="flex gap-2 bg-zinc-900 border border-cyan-400/30 rounded-xl p-2">
          <input autoFocus value={pasteInput} onChange={(e) => setPasteInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && pasteInput.trim()) handlePasteDay(); if (e.key === "Escape") setPasteInput(null); }}
            placeholder="Название дня" className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40" />
          <button onClick={handlePasteDay} disabled={!pasteInput.trim()} className="px-3 py-2 text-sm rounded-lg bg-cyan-400 text-zinc-950 font-semibold hover:bg-cyan-300 transition disabled:opacity-40">Вставить</button>
          <button onClick={() => setPasteInput(null)} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 transition"><X size={16} /></button>
        </div>
      ) : (
        dayClipboard && <button onClick={() => setPasteInput(dayClipboard.name)} className="w-full flex items-center justify-center gap-1.5 bg-zinc-900 border border-cyan-400/30 hover:border-cyan-400/60 rounded-xl py-2.5 text-sm font-medium text-cyan-400 transition"><ClipboardPaste size={15} /> Вставить: {dayClipboard.name}</button>
      )}
      </>}

      {libFor && (
        <LibraryModal trainerId={trainerId} customNames={customNames} addToLibrary={addToLibrary}
          onPick={(name) => { addExercise(libFor, name); setLibFor(null); }}
          onClose={() => setLibFor(null)} />
      )}

      {editingDay && (
        <ModalShell title={editingDay.name || "Тренировка"} icon={<Pencil size={17} className="text-lime-400" />} onClose={() => setEditingDayId(null)} wide>
          <div className="overflow-y-auto flex-1 min-h-0">{DayBody({ day: editingDay })}</div>
        </ModalShell>
      )}

      {viewingSession && <SessionReadModal session={viewingSession} onClose={() => setViewingSession(null)} />}
      {sessionDay && <SessionModal day={sessionDay} onFinish={finishSession} onClose={() => setSessionDay(null)} />}
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 text-zinc-100 text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg border border-zinc-700 pointer-events-none">{toast}</div>}
    </div>
  );
}
