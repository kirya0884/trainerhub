import { BarChart3, BookOpen, CalendarCheck, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clipboard, ClipboardList, ClipboardPaste, FileStack, Flame, HeartPulse, History, Layers, MessageSquare, Pencil, Play, Plus, Printer, Repeat, RotateCcw, Trash, Trash2, TrendingUp, User, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
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
import TemplatesModal from "./TemplatesModal";

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
  const { plan, loading, error, updatePlanMeta, addDay, updateDay, deleteDay, reorderDays, addExercise, updateExercise, deleteExercise, reorderExercises, reload } = usePlan(planId);
  const { allNames, customNames, addToLibrary } = useExerciseLibrary(trainerId);
  const { progress, metrics, sessions, deletedSessions, addProgress, updateProgress, deleteProgress, addMetric, deleteMetric, deleteSession, restoreSession, purgeSession, updateSessionReview, logSession } = useProgress(planId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dayClipboard, setDayClipboard] = useState<{ name: string; exercises: Day["exercises"] } | null>(() => {
    try { return JSON.parse(localStorage.getItem("th-day-clip") || "null"); } catch { return null; }
  });
  const copyDay = (day: { name: string; exercises: Day["exercises"] }) => {
    const d = { name: day.name, exercises: day.exercises };
    setDayClipboard(d);
    localStorage.setItem("th-day-clip", JSON.stringify(d));
  };
  const pasteDay = async () => {
    if (!dayClipboard) return;
    await templatesApi.applyDayTemplate(planId, { id: "", name: dayClipboard.name + " (копия)", weekday: null, exercises: dayClipboard.exercises } as Day, (plan?.days.length ?? 0));
    reload();
  };
  const [libFor, setLibFor] = useState<string | null>(null);
  const [sub, setSub] = useState<"workout" | "done" | "progress">("workout");
  const [sessionDay, setSessionDay] = useState<Day | null>(null);
  const [returnedDayIds, setReturnedDayIds] = useState<Set<string>>(new Set());
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [showMembership, setShowMembership] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [showSessionTrash, setShowSessionTrash] = useState(false);
  const [openJournal, setOpenJournal] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showMeso, setShowMeso] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [addingSession, setAddingSession] = useState(false);
  const [clientName, setClientName] = useState("");
  const toggleCollapse = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  const cycleGroup = (dayId: string, exId: string, cur: string, exercises: Day["exercises"]) => {
    const i = GROUP_CYCLE.indexOf(cur || "");
    updateExercise(dayId, exId, { group: GROUP_CYCLE[(i + 1) % GROUP_CYCLE.length] });
  };

  useEffect(() => { fetchClient(clientId).then((c) => { setMembership(c.membership); setClientName(c.name); }); }, [clientId]);

  const finishSession = async (m: Omit<Metric, "id">[], note: string, session: Omit<Session, "id">) => {
    await logSession(m, note, session);
    // ponytail: новая сессия за сегодня — сбрасываем флаг "вернули в Тренировки", чтобы день снова ушёл в Проведенные
    if (sessionDay) {
      setReturnedDayIds((s) => (s.has(sessionDay.id) ? new Set([...s].filter((id) => id !== sessionDay.id)) : s));
      markSessionDone(trainerId, clientId, sessionDay.name, today()); // fire-and-forget: mark calendar booking done
    }
    // Гард двойного списания: если клиент уже залогировал эту же сессию (fromClient=true), тренер не декрементирует повторно.
    const alreadyLoggedByClient = sessions.some((s) => s.dayName === session.dayName && s.date === session.date && s.fromClient);
    if (membership && !alreadyLoggedByClient) setMembership(await decrementMembershipRemaining(clientId, membership));
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
    await deleteSession(deletingSessionId, reason);
    if (reason === "Уважительная" && membership) setMembership(await incrementMembershipRemaining(clientId, membership));
    setDeletingSessionId(null);
  };

  const sortedSessions = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1));
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
              update={(patch) => updateExercise(day.id, ex.id, patch)} remove={() => deleteExercise(day.id, ex.id)} />
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
          <input value={plan.name} onChange={(e) => updatePlanMeta({ name: e.target.value })} className="flex-1 min-w-0 bg-transparent text-xl font-bold outline-none border-b border-transparent focus:border-lime-400/50 pb-1" placeholder="Название плана" />
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => setShowTemplates(true)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-lime-400 transition" title="Шаблоны"><FileStack size={15} /></button>
            <button onClick={() => setShowVersions(true)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-lime-400 transition" title="История версий"><History size={15} /></button>
            <button onClick={() => setShowMeso(true)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-lime-400 transition" title="Генератор мезоцикла"><Repeat size={15} /></button>
            <button onClick={() => setShowPrint(true)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-lime-400 transition" title="Печать / PDF"><Printer size={15} /></button>
          </div>
          {clientName && (
            <span className="flex items-center gap-1.5 text-sm text-zinc-400 shrink-0 max-w-[100px] sm:max-w-none">
              {membership?.type === "sessions" && <RemainingBadge remaining={membership.remaining !== "" ? String(combinedRemaining(membership)) : null} />}
              <User size={14} className="text-zinc-500 shrink-0" />
              <span className="truncate">{clientName}</span>
            </span>
          )}
        </div>
        <input value={plan.note} onChange={(e) => updatePlanMeta({ note: e.target.value })} placeholder="Заметка к плану — напр. прогрессия каждые 2 недели" className="w-full mt-3 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50" />
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
          onApplyPlan={async (days) => { await templatesApi.applyPlanTemplate(plan.id, days, plan.days.length); setShowTemplates(false); reload(); }}
          onApplyDay={async (day) => { await templatesApi.applyDayTemplate(plan.id, day, plan.days.length); setShowTemplates(false); reload(); }}
          onClose={() => setShowTemplates(false)}
        />
      )}
      {showPrint && <PlanPrintView plan={plan} trainerId={trainerId} clientName={clientName} onClose={() => setShowPrint(false)} />}
      {showMeso && <PeriodizationModal days={plan.days} planId={plan.id} onClose={() => setShowMeso(false)} onDone={() => { setShowMeso(false); reload(); }} />}
      {showVersions && <PlanVersionsModal planId={plan.id} onClose={() => setShowVersions(false)} onRestored={() => { setShowVersions(false); reload(); }} />}

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
            <button onClick={() => setOpenJournal((v) => !v)} className="w-full flex items-center justify-between gap-2 p-4">
              <h3 className="font-semibold flex items-center gap-1.5"><MessageSquare size={16} className="text-lime-400" /> Журнал {progress.length > 0 && <span className="text-zinc-500 font-normal">({progress.length})</span>}</h3>
              {openJournal ? <ChevronDown size={18} className="text-zinc-400" /> : <ChevronRight size={18} className="text-zinc-400" />}
            </button>
            {openJournal && (
              <div className="px-4 pb-4 space-y-2">
                <button onClick={addProgress} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-2.5 py-1.5 text-xs hover:bg-lime-300 transition"><Plus size={13} /> Запись</button>
                {progress.length === 0 && <p className="text-sm text-zinc-600 text-center py-4">Записей в журнале пока нет.</p>}
                {progress.map((entry) => (<div key={entry.id} className="flex gap-2 items-start bg-zinc-800/40 rounded-lg p-2.5 flex-wrap sm:flex-nowrap"><input type="date" value={entry.date} onChange={(e) => updateProgress(entry.id, { date: e.target.value })} className="bg-zinc-800 rounded-md px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" /><input value={entry.text} onChange={(e) => updateProgress(entry.id, { text: e.target.value })} autoFocus={entry.text === ""} placeholder="напр. добавили подход, сменили упражнение" className="flex-1 min-w-[140px] bg-zinc-800 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" /><button onClick={() => deleteProgress(entry.id)} className="p-1.5 rounded-md hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={15} /></button></div>))}
              </div>
            )}
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
                    return (
                      <div key={s.id} className="bg-zinc-800/40 rounded-xl p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="min-w-0"><p className="font-semibold text-sm truncate">{s.dayName}</p><p className="text-xs text-zinc-500">{fmtDate(s.date)} · {s.done}/{s.total} упр.</p></div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => setEditingSessionId(editing ? null : s.id)} className={`p-1 rounded transition ${editing ? "bg-cyan-400/20 text-cyan-400" : "hover:bg-zinc-700 text-zinc-500"}`} title="Редактировать отзыв"><Pencil size={14} /></button>
                            <button onClick={() => setDeletingSessionId(s.id)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition"><X size={14} /></button>
                          </div>
                        </div>
                        <div className="flex gap-4 mb-2 text-sm flex-wrap"><span className="text-zinc-400">Самочувствие <span className="text-base">{s.wellbeing ? WELL_EMOJI[s.wellbeing - 1] : "—"}</span></span><span className="text-zinc-400">Настроение <span className="text-base">{s.mood ? MOOD_EMOJI[s.mood - 1] : "—"}</span></span>{!!s.clientRating && <span className="text-zinc-400">Оценка <span className="text-lime-400 font-semibold">{s.clientRating}/5</span></span>}</div>
                        {s.items?.some((i) => i.effort) && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400 mb-2">{s.items.filter((i) => i.effort).map((i, idx) => <span key={idx} className="flex items-center gap-1">{i.name}: {Array.from({ length: i.effort }).map((_, k) => <Flame key={k} size={11} className="text-orange-400 inline" />)}</span>)}</div>}
                        {editing ? (
                          <textarea value={s.review} onChange={(e) => updateSessionReview(s.id, e.target.value)} rows={2} placeholder="Отзыв клиента..." className="w-full text-sm bg-zinc-900/60 rounded-lg p-2 outline-none focus:ring-1 focus:ring-cyan-400/40 resize-none" />
                        ) : (
                          s.review && <div className="text-sm text-zinc-300 bg-zinc-900/60 rounded-lg p-2 flex gap-1.5"><MessageSquare size={14} className="text-lime-400 shrink-0 mt-0.5" /> {s.review}</div>
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
      {plan.days.map((day, di) => {
        if (isDoneToday(day)) return null;
        const isOpen = !collapsed[day.id];
        const lastSession = lastSessionOf(day);
        return (
          <div key={day.id} className="bg-zinc-900 border border-zinc-800 rounded-xl">
            <div className="flex items-center gap-1 px-3 py-2.5 bg-zinc-800/40 border-b border-zinc-800 rounded-t-xl">
              <button onClick={() => toggleCollapse(day.id)} className="p-1 rounded-md hover:bg-zinc-700 text-zinc-400 transition shrink-0">{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button>
              <span className="flex flex-col -my-1 shrink-0">
                <button onClick={() => reorderDays(di, di - 1)} disabled={di === 0} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"><ChevronUp size={14} /></button>
                <button onClick={() => reorderDays(di, di + 1)} disabled={di === plan.days.length - 1} className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"><ChevronDown size={14} /></button>
              </span>
              <input value={day.name} onChange={(e) => updateDay(day.id, { name: e.target.value })} className="flex-1 min-w-0 bg-transparent font-semibold outline-none border-b border-transparent focus:border-lime-400/50 pb-0.5" placeholder="Название дня" />
              {lastSession && <span className="text-[11px] text-zinc-500 shrink-0 hidden sm:inline" title="Дата последнего проведения">{fmtDate(lastSession.date)}</span>}
              <input type="date" value={day.dateOf ?? ""} onChange={(e) => updateDay(day.id, { dateOf: e.target.value || null })} className="bg-zinc-800 rounded-md text-xs px-1.5 py-1 outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0 text-zinc-300 w-36" />
              <button onClick={() => setSessionDay(day)} className="p-1.5 rounded-md hover:bg-lime-400/15 hover:text-lime-400 text-zinc-500 transition shrink-0" title="Провести тренировку"><Play size={15} /></button>
              <button onClick={() => copyDay(day)} className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition shrink-0" title="Копировать день"><Clipboard size={15} /></button>
              <button onClick={() => { if (window.confirm(`Удалить день «${day.name}»?`)) deleteDay(day.id); }} className="p-1.5 rounded-md hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><Trash2 size={15} /></button>
            </div>
            {isOpen && DayBody({ day })}
          </div>
        );
      })}

      <button onClick={addDay} className="w-full flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:border-lime-400/40 rounded-xl py-3 font-medium text-zinc-300 hover:text-lime-400 transition"><Plus size={17} /> Добавить день</button>
      {dayClipboard && (
        <button onClick={pasteDay} className="w-full flex items-center justify-center gap-1.5 bg-zinc-900 border border-cyan-400/30 hover:border-cyan-400/60 rounded-xl py-2.5 text-sm font-medium text-cyan-400 transition"><ClipboardPaste size={15} /> Вставить: {dayClipboard.name}</button>
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

      {sessionDay && <SessionModal day={sessionDay} onFinish={finishSession} onClose={() => setSessionDay(null)} />}
    </div>
  );
}
