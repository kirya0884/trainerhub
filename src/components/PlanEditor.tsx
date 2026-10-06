import { Archive, ArrowLeft, Check, MoreVertical, BarChart3, BookOpen, GripVertical, CalendarCheck, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clipboard, ClipboardPaste, Eye, EyeOff, FileStack, Flame, HeartPulse, History, Layers, MoreHorizontal, MessageSquare, Pencil, Play, Plus, Printer, Repeat, RotateCcw, Trash, Trash2, Wallet, X, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GROUP_COLORS, GROUP_CYCLE } from "../constants";
import { FeelingBadge } from "./FeelingScale";
import { usePlan } from "../hooks/usePlan";
import { useExerciseLibrary } from "../hooks/useExerciseLibrary";
import { useProgress } from "../hooks/useProgress";
import { decrementMembershipRemaining, incrementMembershipRemaining, fetchClient, sessionPrice, combinedRemaining, type Membership } from "../lib/clients";
import { fmtDate, today } from "../lib/format";
import type { DeleteReason } from "../lib/progress";
import * as paymentsApi from "../lib/payments";
import * as templatesApi from "../lib/templates";
import { onWorkoutFinished } from "../lib/clientsBus";
import { useActiveWorkout } from "../hooks/useActiveWorkout";
import * as plansApi from "../lib/plans";
import type { Day, Metric, Session } from "../types";
import DeleteSessionModal from "./DeleteSessionModal";
import ExerciseRow from "./ExerciseRow";
import ExerciseHistoryModal from "./ExerciseHistoryModal";
import { useDragSort } from "../hooks/useDragSort";
import LibraryModal from "./LibraryModal";
import MetricsView from "./MetricsView";
import ModalShell from "./ModalShell";
import PeriodizationModal from "./PeriodizationModal";
import PlanPrintView from "./PlanPrintView";
import PlanVersionsModal from "./PlanVersionsModal";
import SessionReadModal from "./SessionReadModal";
import TemplatesModal from "./TemplatesModal";
import DayTemplateLibrary from "./DayTemplateLibrary";
import { ScreenSkeleton } from "./Skeleton";

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

export default function PlanEditor({ planId, trainerId, clientId, onBack }: { planId: string; trainerId: string; clientId: string; onBack?: () => void }) {
  const { plan, loading, error, updatePlanMeta, addDay, updateDay, deleteDay, reorderDays, addExercise, updateExercise, deleteExercise, reorderExercises, addMesocycle, updateMesocycle, deleteMesocycle, reorderMesocycles, reload } = usePlan(planId);
  const { allNames, customNames, addToLibrary } = useExerciseLibrary(trainerId);
  const exDrag = useDragSort((dayId, from, to) => reorderExercises(dayId, from, to));
  // Н2: дни переставляются перетаскиванием. Перетаскивание идёт внутри одного контейнера
  // (блок, «без блока» или плоский список), поэтому локальные позиции переводим
  // в сквозные индексы plan.days — их и ждёт reorderDays.
  const dayLists = useRef<Record<string, number[]>>({});
  const dayDrag = useDragSort((key, from, to) => {
    const list = dayLists.current[key];
    if (!list || list[from] == null || list[to] == null) return;
    reorderDays(list[from], list[to]);
  }, "dsday");
  const { progress, metrics, sessions, deletedSessions, reloadProgress, addProgress, updateProgress, deleteProgress, addMetric, deleteMetric, deleteSession, restoreSession, purgeSession, updateSessionReview, logSession } = useProgress(planId);
  // Последний задокументированный результат по каждому упражнению (metrics отсортированы ascending — берём последнее)
  const lastMetrics = useMemo(() => Object.fromEntries(metrics.map((m) => [m.exercise.toLowerCase(), m])), [metrics]);
  // П10: сколько тренировок в истории по каждому названию. Наружу уходит число —
  // объект в props сломал бы мемоизацию ExerciseRow.
  const historyCounts = useMemo(() => {
    const c: Record<string, number> = {};
    const seen = new Set<string>();
    for (const s of sessions) for (const i of s.items ?? []) {
      const k = i.name.trim().toLowerCase();
      if (!k || seen.has(k + s.date)) continue;
      seen.add(k + s.date);
      c[k] = (c[k] ?? 0) + 1;
    }
    for (const m of metrics) {
      const k = m.exercise.trim().toLowerCase();
      if (!k || seen.has(k + m.date)) continue;
      seen.add(k + m.date);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [sessions, metrics]);
  const openExHistory = useCallback((name: string) => setHistoryFor(name), []);
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
  // П11: одна защита на все пути добавления. На телефоне вставка + перенумерация
  // занимают секунду-две, кнопка всё это время выглядела нерабочей — и её жали ещё раз.
  const [addBusy, setAddBusy] = useState(false);

  const handleCreateDay = async () => {
    if (!newDayName?.trim() || addBusy) return;
    setAddBusy(true);
    try {
      await addDay(newDayName.trim());
      setNewDayName(null);
    } catch (e) {
      console.error("[PlanEditor] handleCreateDay:", e);
      alert("Не удалось добавить день. Попробуй ещё раз.");
    } finally { setAddBusy(false); }
  };

  const handleAddMesocycle = async () => {
    if (addBusy) return;
    setAddBusy(true);
    try { await addMesocycle(); } finally { setAddBusy(false); }
  };

  /** Общая обёртка для применения шаблонов: один и тот же замок, одно и то же сообщение. */
  const runAdd = async (fn: () => Promise<void>, failMsg: string) => {
    if (addBusy) return;
    setAddBusy(true);
    try { await fn(); reload(); }
    catch (e) { console.error("[PlanEditor] runAdd:", e); alert(failMsg); }
    finally { setAddBusy(false); }
  };
  // B06: дублировать день — один клик с автоименем. Копирование в буфер оставлено:
  // оно нужно, чтобы перенести день в ДРУГОЙ план, а дубликат работает внутри текущего.
  const [dupBusy, setDupBusy] = useState<string | null>(null);
  const duplicateDay = async (day: Day) => {
    if (dupBusy) return;
    setDupBusy(day.id);
    try {
      await templatesApi.applyDayTemplate(planId, { ...day, name: `${day.name} (копия)` }, plan?.days.length ?? 0);
      reload();
    } catch (e) { console.error("[PlanEditor] duplicateDay:", e); showToast("Не удалось дублировать день"); }
    finally { setDupBusy(null); }
  };
  const duplicateMeso = async (mesoId: string) => {
    if (dupBusy) return;
    setDupBusy(mesoId);
    try {
      await plansApi.duplicateMesocycle(planId, mesoId);
      reload();
    } catch (e) { console.error("[PlanEditor] duplicateMeso:", e); showToast("Не удалось дублировать блок"); }
    finally { setDupBusy(null); }
  };

  const handlePasteDay = async () => {
    if (!dayClipboard || !pasteInput?.trim() || addBusy) return;
    setAddBusy(true);
    try {
      await templatesApi.applyDayTemplate(planId, { id: "", name: pasteInput.trim(), weekday: null, exercises: dayClipboard.exercises } as Day, (plan?.days.length ?? 0));
      reload();
      setPasteInput(null);
    } catch (e) {
      console.error("Paste day failed:", e);
      showToast("Ошибка при вставке дня");
    } finally { setAddBusy(false); }
  };
  const [libFor, setLibFor] = useState<string | null>(null);
  const [sub, setSub] = useState<"workout" | "done" | "progress">("workout");
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
  // Д3: тренировка живёт на уровне приложения, поэтому запускаем её через контекст,
  // а прогресс перечитываем по сигналу — к моменту завершения этот экран мог быть закрыт.
  const workout = useActiveWorkout();
  useEffect(() => onWorkoutFinished((pid) => { if (pid === planId) reloadProgress(); }), [planId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showPlanMenu, setShowPlanMenu] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [addingSession, setAddingSession] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientColor, setClientColor] = useState("");
  // Шапка и меню дней/блоков: одно открытое меню за раз
  const [editingName, setEditingName] = useState(false);
  const [dayMenu, setDayMenu] = useState<string | null>(null);
  const [mesoMenu, setMesoMenu] = useState<string | null>(null);
  const [renamingDay, setRenamingDay] = useState<string | null>(null);
  // Ссылка должна быть стабильной: она уходит в мемоизированный ExerciseRow.
  const toggleCollapse = useCallback((id: string) => setCollapsed((c) => {
    const next = { ...c, [id]: !c[id] };
    localStorage.setItem(`trainerhub-collapsed-${planId}`, JSON.stringify(next));
    return next;
  }), [planId]);
  const toggleExOpen = useCallback((id: string) => toggleCollapse(`x:${id}`), [toggleCollapse]);
  const cycleGroup = (dayId: string, exId: string, cur: string, exercises: Day["exercises"]) => {
    const i = GROUP_CYCLE.indexOf(cur || "");
    markSaving(); updateExercise(dayId, exId, { group: GROUP_CYCLE[(i + 1) % GROUP_CYCLE.length] });
  };

  // Закрытие меню плана по Escape — клик мимо ловит подложка
  useEffect(() => {
    if (!showPlanMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowPlanMenu(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPlanMenu]);

  useEffect(() => {
    let alive = true;
    fetchClient(clientId)
      .then((c) => { if (alive) { setMembership(c.membership); setClientName(c.name); setClientColor(c.color); } })
      .catch((e) => console.error("[PlanEditor] fetchClient:", e));
    return () => { alive = false; };
  }, [clientId]);


  // ponytail: ручное добавление разовой тренировки к остатку — платная пишется в журнал платежей (учитывается в статистике заработка), бесплатная — только +1 к остатку
  const addSingleSession = async (paid: boolean) => {
    if (!membership || addingSession) return;

    // П5: раньше при неподходящем абонементе кнопка молча ничего не делала —
    // тренер не понимал, сломалось или он что-то не так делает.
    if (membership.type === "subscription") {
      alert("У подопечного подписка — разовые тренировки к ней не добавляются, оплата помесячная.");
      return;
    }

    // Цена берётся из пакета. У клиента без пакета её нет, поэтому спрашиваем —
    // иначе платёж ушёл бы в журнал на нулевую сумму.
    let amount = sessionPrice(membership);
    if (paid && amount <= 0) {
      const v = window.prompt("Цена разового занятия, ₽:", "");
      if (v == null) return;
      amount = Number(String(v).replace(",", ".").trim()) || 0;
      if (amount <= 0) { alert("Нужна сумма больше нуля."); return; }
    }

    setAddingSession(true);
    try {
      const next = await incrementMembershipRemaining(clientId, membership);
      if (paid) await paymentsApi.addPayment(clientId, { date: today(), amount, type: "single", note: "Разовая тренировка" }, 1);
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
  // П3: день скрыт из «Тренировок», только если он помечен проведённым явно.
  const isArchived = (day: Day) => !!day.archivedAt;
  // Сосед ищется среди неархивных: обмен со скрытым днём выглядел бы как «кнопка не работает».
  const visibleNeighbour = (days: Day[], di: number, dir: -1 | 1) => {
    for (let i = di + dir; i >= 0 && i < days.length; i += dir) if (!isArchived(days[i])) return i;
    return -1;
  };

  if (loading) return <div className="p-4"><ScreenSkeleton /></div>;
  if (error) return <div className="text-red-400 text-sm p-4">Ошибка: {error}</div>;
  if (!plan) return null;

  // ponytail: тело дня (упражнения) — общий рендер для инлайн-режима во вкладке «Тренировки» и для модалки редактирования из «Проведенные»
  const DayBody = ({ day }: { day: Day }) => (
    <div className="px-2 pb-2 pt-1 space-y-1 border-t border-zinc-800" {...exDrag.rootProps(day.id)}>
      {groupBlocks(day.exercises).map((block, bi) => {
        const rows = block.items.map((ex, k) => {
          const ei = block.startIdx + k;
          return (
            <ExerciseRow key={ex.id} ex={ex} label={exLabel(day, ei)} groupColor={ex.group ? GROUP_COLORS[ex.group] : null} suggestions={allNames} addToLibrary={addToLibrary}
              index={ei} collapsed={!collapsed[`x:${ex.id}`]} onToggleCollapse={toggleExOpen}
              dragging={exDrag.drag?.key === day.id && exDrag.drag.from === ei}
              dropBefore={exDrag.drag?.key === day.id && exDrag.drag.over === ei && exDrag.drag.from !== ei}
              dropAfter={exDrag.drag?.key === day.id && exDrag.drag.over === day.exercises.length && ei === day.exercises.length - 1 && exDrag.drag.from !== ei}
              canMoveUp={ei > 0} canMoveDown={ei < day.exercises.length - 1}
              onMoveUp={() => reorderExercises(day.id, ei, ei - 1)} onMoveDown={() => reorderExercises(day.id, ei, ei + 1)}
              cycleGroup={() => cycleGroup(day.id, ex.id, ex.group, day.exercises)}
              update={(patch) => { markSaving(); updateExercise(day.id, ex.id, patch); }} remove={() => deleteExercise(day.id, ex.id)}
              lastMetric={lastMetrics[ex.name.toLowerCase()]}
              historyCount={historyCounts[ex.name.trim().toLowerCase()] ?? 0} onOpenHistory={openExHistory} />
          );
        });
        if (block.group && block.items.length > 1) {
          const color = GROUP_COLORS[block.group];
          return (
            <div key={bi} className="rounded-xl overflow-hidden" style={{ background: `${color}12`, boxShadow: `inset 3px 0 0 ${color}` }}>
              <div className="pl-3.5 pr-2.5 pt-2 text-xs font-bold flex items-center gap-1.5" style={{ color }}>
                <Layers size={13} /> {supersetName(block.items.length)} {block.group} · {block.items.length} подряд
              </div>
              <div className="p-1 pl-2 space-y-1">{rows}</div>
            </div>
          );
        }
        return <div key={bi}>{rows}</div>;
      })}
      <div className="flex gap-2 pt-1">
        <button onClick={() => setLibFor(day.id)} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-xl h-11 transition"><BookOpen size={15} /> Из библиотеки</button>
        <button onClick={() => addExercise(day.id)} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-zinc-400 hover:text-zinc-100 border-[1.5px] border-dashed border-zinc-700 hover:border-zinc-500 rounded-xl h-11 transition"><Plus size={15} /> Вручную</button>
      </div>
    </div>
  );
  const editingDay = editingDayId ? plan.days.find((d) => d.id === editingDayId) || null : null;

  return (
    <div className="space-y-4">
      {/* Шапка: назад, статус сохранения и меню; ниже — название заголовком, чипы и вкладки */}
      <div>
        <div className="flex items-center gap-1 -ml-2.5">
          {onBack && <button onClick={onBack} aria-label="Назад" title="Назад" className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-zinc-300 hover:bg-zinc-800 transition"><ArrowLeft size={22} /></button>}
          <span className={`ml-auto text-sm transition-opacity duration-300 ${saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}`}>
            {saveStatus === 'saving' ? <span className="text-zinc-500">Сохранение…</span> : <span className="text-zinc-400 flex items-center gap-1"><Check size={14} className="text-lime-400" /> Сохранено</span>}
          </span>
          {/* П4: пять иконок свёрнуты в меню — строка названия перестала быть панелью инструментов */}
          <div className="relative shrink-0">
            <button onClick={() => setShowPlanMenu((v) => !v)} aria-expanded={showPlanMenu} aria-label="Меню плана" title="Меню плана"
              className={`w-11 h-11 flex items-center justify-center rounded-xl transition ${showPlanMenu ? "bg-zinc-800 text-zinc-100" : plan.visibleToClient === false ? "text-orange-400 hover:bg-zinc-800" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}`}>
              <MoreHorizontal size={22} />
            </button>
            {showPlanMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowPlanMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 w-56 shadow-xl">
                  <button onClick={() => { setShowPlanMenu(false); setShowTemplates(true); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 transition">
                    <FileStack size={15} className="text-zinc-500 shrink-0" /> Шаблоны
                  </button>
                  <button onClick={() => { setShowPlanMenu(false); setShowVersions(true); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 transition">
                    <History size={15} className="text-zinc-500 shrink-0" /> История версий
                  </button>
                  <button onClick={() => { setShowPlanMenu(false); setShowMeso(true); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 transition">
                    <Repeat size={15} className="text-zinc-500 shrink-0" /> Генератор мезоцикла
                  </button>
                  <button onClick={() => { setShowPlanMenu(false); setShowPrint(true); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800 transition">
                    <Printer size={15} className="text-zinc-500 shrink-0" /> Печать / PDF
                  </button>
                  <div className="my-1 border-t border-zinc-800" />
                  <button onClick={() => { setShowPlanMenu(false); markSaving(); updatePlanMeta({ visibleToClient: plan.visibleToClient === false ? true : false }); }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-zinc-800 transition ${plan.visibleToClient === false ? "text-orange-400" : "text-zinc-300"}`}>
                    {plan.visibleToClient === false ? <EyeOff size={15} className="shrink-0" /> : <Eye size={15} className="text-zinc-500 shrink-0" />}
                    {plan.visibleToClient === false ? "Показать клиенту" : "Скрыть от клиента"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {editingName ? (
          <input autoFocus value={plan.name} onChange={(e) => { markSaving(); updatePlanMeta({ name: e.target.value }); }} onBlur={() => setEditingName(false)} onKeyDown={(e) => e.key === "Enter" && setEditingName(false)}
            aria-label="Название плана" placeholder="Название плана" className="mt-1 w-full h-12 bg-zinc-900 border border-zinc-700 rounded-xl px-3.5 font-bold outline-none focus:border-lime-400/60" />
        ) : (
          <button onClick={() => setEditingName(true)} title="Изменить название" className="mt-1 group flex items-center gap-2 max-w-full text-left">
            <h2 className="text-2xl font-extrabold tracking-tight break-words min-w-0">{plan.name || "Без названия"}</h2>
            <Pencil size={15} className="shrink-0 text-zinc-600 group-hover:text-zinc-400" />
          </button>
        )}
        {(clientName || membership) && (
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            {clientName && (
              <span className="inline-flex items-center gap-2 h-8 pl-1 pr-3 rounded-full bg-zinc-900 border border-zinc-800 text-sm font-semibold max-w-full">
                <span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-zinc-950" style={{ background: clientColor || "#a3e635" }}>{clientName.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>
                <span className="truncate">{clientName}</span>
              </span>
            )}
            {membership && (
              <button onClick={() => setShowMembership(true)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-zinc-900 border border-zinc-800 text-sm font-semibold hover:border-zinc-700 transition">
                <Wallet size={14} className={membership.type !== "subscription" && combinedRemaining(membership) <= 2 ? "text-orange-400" : "text-zinc-400"} />
                {membership.type === "subscription" ? `Оплата ${fmtDate(membership.nextPaymentDate)}` : `Осталось ${combinedRemaining(membership)}`}
              </button>
            )}
          </div>
        )}
        {plan.visibleToClient === false && (
          <div className="flex items-center gap-2 bg-orange-400/10 border border-orange-400/20 rounded-xl px-3 py-2.5 text-sm text-orange-400 mt-3">
            <EyeOff size={15} className="shrink-0" /> Программа скрыта от клиента — показать можно в меню «⋯»
          </div>
        )}
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 mt-4">
          {([
            { k: "workout" as const, label: "Тренировки" },
            { k: "done" as const, label: "Проведённые" },
            { k: "progress" as const, label: "Прогресс" },
          ]).map((t) => (
            <button key={t.k} onClick={() => setSub(t.k)} aria-pressed={sub === t.k}
              className={`flex-1 min-w-0 h-9 rounded-lg text-sm font-semibold truncate px-1 transition ${sub === t.k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {showTemplates && (
        <TemplatesModal
          trainerId={trainerId}
          currentDays={plan.days}
          onApplyPlan={(days) => runAdd(() => templatesApi.applyPlanTemplate(plan.id, days, plan.days.length), "Не удалось применить шаблон плана.")}
          onApplyDay={(day) => runAdd(() => templatesApi.applyDayTemplate(plan.id, day, plan.days.length), "Не удалось применить шаблон дня.")}
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
            <h3 className="font-semibold flex items-center gap-1.5"><CheckCircle2 size={16} className="text-lime-400" /> Проведённые дни{plan.days.filter(isArchived).length > 0 && <span className="text-zinc-500 font-normal">· {plan.days.filter(isArchived).length}</span>}</h3>
            {plan.days.filter(isArchived).length === 0 && <p className="text-sm text-zinc-600 text-center py-4">Пока пусто. Проведённые дни уходят сюда из «Тренировок» и остаются здесь — их можно посмотреть, скопировать или вернуть обратно.</p>}
            {plan.days.filter(isArchived).map((day) => (
              <div key={day.id} className="flex items-center gap-1.5 bg-zinc-800/40 rounded-xl px-3 py-2.5">
                <span className="flex-1 min-w-0 font-semibold truncate">{day.name}</span>
                <span className="flex items-center gap-1 text-[11px] font-medium text-lime-400 bg-lime-400/10 rounded-full px-2 py-1 shrink-0"><CheckCircle2 size={12} /> {day.archivedAt ? fmtDate(day.archivedAt.slice(0, 10)) : "Проведена"}</span>
                <button onClick={() => setEditingDayId(day.id)} className="p-1.5 rounded-md hover:bg-cyan-400/15 hover:text-cyan-400 text-zinc-500 transition shrink-0" title="Редактировать в отдельном окне"><Pencil size={15} /></button>
                <button onClick={() => updateDay(day.id, { archivedAt: null })} className="p-1.5 rounded-md hover:bg-lime-400/15 hover:text-lime-400 text-zinc-500 transition shrink-0" title="Вернуть в Тренировки"><RotateCcw size={15} /></button>
                <button onClick={() => duplicateDay(day)} disabled={!!dupBusy} title="Дублировать день" className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition shrink-0 disabled:opacity-40"><Copy size={15} /></button>
                <button onClick={() => { if (window.confirm(`Удалить день «${day.name}»?`)) deleteDay(day.id); }} className="p-1.5 rounded-md hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0" title="Удалить"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          {/* Р2: архив блоков — рядом с проведёнными днями, одно место для всего убранного */}
          {(plan.mesocycles ?? []).some((m) => m.archivedAt) && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
              <h3 className="font-semibold flex items-center gap-1.5"><Archive size={16} className="text-cyan-400" /> Архив блоков
                <span className="text-zinc-500 font-normal">· {(plan.mesocycles ?? []).filter((m) => m.archivedAt).length}</span>
              </h3>
              {(plan.mesocycles ?? []).filter((m) => m.archivedAt).sort((a, b) => a.position - b.position).map((meso) => {
                const cnt = plan.days.filter((d) => d.mesocycleId === meso.id).length;
                return (
                  <div key={meso.id} className="flex items-center gap-1.5 bg-zinc-800/40 rounded-xl px-3 py-2.5">
                    <Layers size={14} className="text-cyan-400 shrink-0" />
                    <span className="flex-1 min-w-0 font-semibold truncate">{meso.name}</span>
                    <span className="text-xs text-zinc-500 shrink-0">{cnt} дн.</span>
                    <button onClick={() => { markSaving(); updateMesocycle(meso.id, { archivedAt: null }); }}
                      title="Вернуть блок в Тренировки" aria-label="Вернуть блок в Тренировки"
                      className="p-1.5 rounded-md hover:bg-lime-400/15 hover:text-lime-400 active:text-lime-400 text-zinc-500 transition shrink-0"><RotateCcw size={15} /></button>
                    <button onClick={() => { if (window.confirm(`Удалить блок «${meso.name}»? Дни останутся без блока.`)) deleteMesocycle(meso.id); }}
                      title="Удалить блок" aria-label="Удалить блок"
                      className="p-1.5 rounded-md hover:bg-red-500/20 hover:text-red-400 active:text-red-400 text-zinc-500 transition shrink-0"><X size={15} /></button>
                  </div>
                );
              })}
            </div>
          )}

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
                            {s.wellbeing && <span>Самочувствие <FeelingBadge kind="wellbeing" value={s.wellbeing} /></span>}
                            {s.mood && <span>Настроение <FeelingBadge kind="mood" value={s.mood} /></span>}
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
        const allMesos = [...(plan.mesocycles ?? [])].sort((a, b) => a.position - b.position);
        // Р2: архивный блок уходит из «Тренировок» вместе со своими днями.
        // Сами дни archived_at не получают — вернёте блок, вернётся всё как было.
        const sortedMesos = allMesos.filter((m) => !m.archivedAt);
        const hasMesos = sortedMesos.length > 0;
        const renderDayCard = (day: Day, di: number, li = 0, dkey = "") => {
          const isOpen = !collapsed[day.id];
          const lastSession = lastSessionOf(day);
          const hidden = day.visibleToClient === false;
          return (
            <div key={day.id} data-dsday-idx={li}
              className={`bg-zinc-900 border rounded-2xl transition-shadow ${hidden ? "border-orange-400/25" : "border-zinc-800"} ${
                dayDrag.drag?.key === dkey && dayDrag.drag.from === li ? "opacity-40 ring-2 ring-lime-400" : ""} ${
                dayDrag.drag?.key === dkey && dayDrag.drag.over === li && dayDrag.drag.from !== li ? "shadow-[0_-3px_0_0_var(--accent)]" : ""}`}>
              <div className="flex items-center gap-1 pl-0.5 pr-1.5 py-1.5">
                {/* Н2: ручка вместо двух стрелок по 14 px — в них почти невозможно попасть пальцем.
                    Стрелки клавиатуры остались здесь же: перетаскивание с клавиатуры недоступно. */}
                <button data-dsday-handle type="button"
                  title="Перетащить день. С клавиатуры — стрелки вверх и вниз"
                  aria-label="Перетащить день. Стрелки вверх и вниз меняют порядок"
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp") { const t = visibleNeighbour(plan.days, di, -1); if (t >= 0) { e.preventDefault(); reorderDays(di, t); } }
                    if (e.key === "ArrowDown") { const t = visibleNeighbour(plan.days, di, 1); if (t >= 0) { e.preventDefault(); reorderDays(di, t); } }
                  }}
                  className="shrink-0 w-8 h-11 flex items-center justify-center text-zinc-600 hover:text-zinc-300 active:text-lime-400 cursor-grab active:cursor-grabbing touch-none select-none transition-colors duration-100">
                  <GripVertical size={16} />
                </button>
                {renamingDay === day.id ? (
                  <input autoFocus value={day.name} onChange={(e) => { markSaving(); updateDay(day.id, { name: e.target.value }); }} onBlur={() => setRenamingDay(null)} onKeyDown={(e) => e.key === "Enter" && setRenamingDay(null)}
                    aria-label="Название дня" className="flex-1 min-w-0 h-11 bg-zinc-800 rounded-xl px-3 font-semibold outline-none focus:ring-1 focus:ring-lime-400/40" />
                ) : (
                  <button onClick={() => toggleCollapse(day.id)} aria-expanded={isOpen} title={isOpen ? "Свернуть день" : "Развернуть день"} className="flex-1 min-w-0 text-left py-1">
                    <span className="block font-bold truncate">{day.name || "Без названия"}</span>
                    <span className={`block text-[13px] truncate ${hidden ? "text-orange-400" : "text-zinc-400"}`}>
                      {[hidden ? "Скрыт от клиента" : null, `${day.exercises.length} упр.`, day.method === "circuit" ? "круговая" : null, day.dateOf ? fmtDate(day.dateOf, true) : null, lastSession ? `была ${fmtDate(lastSession.date, true)}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                )}
                <button onClick={() => { if (!workout.start({ day, planId, clientId, clientName })) alert("Одна тренировка уже идёт — заверши или сверни её."); }}
                  className="w-10 h-10 shrink-0 rounded-xl bg-lime-400/15 text-lime-400 flex items-center justify-center hover:bg-lime-400/25 transition" title="Провести тренировку" aria-label="Провести тренировку"><Play size={18} /></button>
                <div className="relative shrink-0">
                  <button onClick={() => setDayMenu(dayMenu === day.id ? null : day.id)} aria-expanded={dayMenu === day.id} aria-label="Меню дня" title="Меню дня"
                    className={`w-10 h-10 flex items-center justify-center rounded-xl transition ${dayMenu === day.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"}`}><MoreVertical size={19} /></button>
                  {dayMenu === day.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setDayMenu(null)} />
                      <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 w-60 shadow-xl">
                        <button onClick={() => { setDayMenu(null); setRenamingDay(day.id); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition"><Pencil size={15} className="text-zinc-500 shrink-0" /> Переименовать</button>
                        <button onClick={() => { setDayMenu(null); markSaving(); updateDay(day.id, { visibleToClient: hidden ? true : false }); }} className={`w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm hover:bg-zinc-800 transition ${hidden ? "text-orange-400" : "text-zinc-200"}`}>
                          {hidden ? <EyeOff size={15} className="shrink-0" /> : <Eye size={15} className="text-zinc-500 shrink-0" />} {hidden ? "Показать клиенту" : "Скрыть от клиента"}
                        </button>
                        <button onClick={() => { setDayMenu(null); markSaving(); updateDay(day.id, { method: day.method === "circuit" ? "" : "circuit" }); }}
                          title="Круговая: подходы идут кругами по всем упражнениям" className={`w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm hover:bg-zinc-800 transition ${day.method === "circuit" ? "text-cyan-400" : "text-zinc-200"}`}>
                          <Repeat size={15} className={`shrink-0 ${day.method === "circuit" ? "" : "text-zinc-500"}`} /> {day.method === "circuit" ? "Сделать обычной" : "Сделать круговой"}
                        </button>
                        <label className="w-full flex items-center gap-2.5 px-2.5 h-11 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition">
                          <CalendarCheck size={15} className="text-zinc-500 shrink-0" /> Дата
                          <input type="date" value={day.dateOf ?? ""} onChange={(e) => { markSaving(); updateDay(day.id, { dateOf: e.target.value || null }); }} className="ml-auto min-w-0 w-[8.5rem] bg-zinc-800 rounded-lg px-2 h-8 outline-none" title="Дата проведения" />
                        </label>
                        {hasMesos && (
                          <label className="w-full flex items-center gap-2.5 px-2.5 h-11 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition">
                            <Layers size={15} className="text-zinc-500 shrink-0" /> Блок
                            <select value={day.mesocycleId ?? ""} onChange={(e) => { markSaving(); updateDay(day.id, { mesocycleId: e.target.value || null }); }} className="ml-auto min-w-0 max-w-[8.5rem] bg-zinc-800 rounded-lg px-2 h-8 outline-none">
                              <option value="">Без блока</option>
                              {sortedMesos.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          </label>
                        )}
                        <button onClick={() => { setDayMenu(null); copyDay(day); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition"><Clipboard size={15} className="text-zinc-500 shrink-0" /> Копировать день</button>
                        <div className="my-1 border-t border-zinc-800" />
                        <button onClick={() => { setDayMenu(null); if (window.confirm(`Удалить день «${day.name}»?`)) deleteDay(day.id); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-red-400 hover:bg-zinc-800 transition"><Trash2 size={15} className="shrink-0" /> Удалить день</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {isOpen && DayBody({ day })}
            </div>
          );
        };

        if (!hasMesos) {
          const flat = plan.days.map((day, di) => ({ day, di })).filter(({ day }) => !isArchived(day));
          dayLists.current["flat"] = flat.map((x) => x.di);
          return (
            <div className="space-y-2" {...dayDrag.rootProps("flat")}>
              {flat.map(({ day, di }, li) => renderDayCard(day, di, li, "flat"))}
            </div>
          );
        }

        return (
          <>
            {sortedMesos.map((meso, mi) => {
              const mesoHidden = meso.visibleToClient === false;
              const mesoDays = plan.days.map((day, di) => ({ day, di })).filter(({ day }) => day.mesocycleId === meso.id);
              return (
                <div key={meso.id} className="space-y-2">
                  <div className={`flex items-center gap-1 mt-3 pl-0.5 ${mesoHidden ? "text-orange-400" : "text-cyan-400"}`}>
                    <button onClick={() => toggleCollapse(meso.id)} title={collapsed[meso.id] ? "Развернуть блок" : "Свернуть блок"}
                      aria-label={collapsed[meso.id] ? "Развернуть блок" : "Свернуть блок"}
                      className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition">
                      {collapsed[meso.id] ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                    </button>
                    <Layers size={15} className="shrink-0" />
                    <input value={meso.name} onChange={(e) => updateMesocycle(meso.id, { name: e.target.value })} aria-label="Название блока"
                      className="flex-1 min-w-0 bg-transparent font-bold outline-none border-b border-transparent focus:border-current pb-0.5 ml-1" placeholder="Название блока" />
                    <span className="text-[13px] text-zinc-500 shrink-0">{mesoDays.length} дн.{mesoHidden && " · скрыт"}</span>
                    <div className="relative shrink-0">
                      <button onClick={() => setMesoMenu(mesoMenu === meso.id ? null : meso.id)} aria-expanded={mesoMenu === meso.id} aria-label="Меню блока" title="Меню блока"
                        className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition"><MoreVertical size={18} /></button>
                      {mesoMenu === meso.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMesoMenu(null)} />
                          <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 w-56 shadow-xl">
                            <button disabled={mi === 0} onClick={() => { setMesoMenu(null); reorderMesocycles(mi, mi - 1); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-40"><ChevronUp size={15} className="text-zinc-500 shrink-0" /> Блок выше</button>
                            <button disabled={mi === sortedMesos.length - 1} onClick={() => { setMesoMenu(null); reorderMesocycles(mi, mi + 1); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-40"><ChevronDown size={15} className="text-zinc-500 shrink-0" /> Блок ниже</button>
                            <button onClick={() => { setMesoMenu(null); markSaving(); updateMesocycle(meso.id, { visibleToClient: mesoHidden ? true : false }); }} className={`w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm hover:bg-zinc-800 transition ${mesoHidden ? "text-orange-400" : "text-zinc-200"}`}>
                              {mesoHidden ? <EyeOff size={15} className="shrink-0" /> : <Eye size={15} className="text-zinc-500 shrink-0" />} {mesoHidden ? "Показать клиенту" : "Скрыть от клиента"}
                            </button>
                            <button onClick={() => { setMesoMenu(null); duplicateMeso(meso.id); }} disabled={!!dupBusy} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-40"><Copy size={15} className="text-zinc-500 shrink-0" /> Дублировать с днями</button>
                            <button onClick={() => { setMesoMenu(null); markSaving(); updateMesocycle(meso.id, { archivedAt: new Date().toISOString() }); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition"><Archive size={15} className="text-zinc-500 shrink-0" /> В архив с днями</button>
                            <div className="my-1 border-t border-zinc-800" />
                            <button onClick={() => { setMesoMenu(null); if (window.confirm(`Удалить блок «${meso.name}»? Дни останутся без блока.`)) deleteMesocycle(meso.id); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-red-400 hover:bg-zinc-800 transition"><Trash2 size={15} className="shrink-0" /> Удалить блок</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {!collapsed[meso.id] && (() => {
                    const vis = mesoDays.filter(({ day }) => !isArchived(day));
                    dayLists.current[meso.id] = vis.map((x) => x.di);
                    return (
                      <div className="space-y-2" {...dayDrag.rootProps(meso.id)}>
                        {vis.map(({ day, di }, li) => renderDayCard(day, di, li, meso.id))}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
            {(() => {
              const loose = plan.days.map((day, di) => ({ day, di })).filter(({ day }) => !day.mesocycleId && !isArchived(day));
              if (!loose.length) return null;
              dayLists.current["loose"] = loose.map((x) => x.di);
              return (
                <div className="space-y-2" {...dayDrag.rootProps("loose")}>
                  {loose.map(({ day, di }, li) => renderDayCard(day, di, li, "loose"))}
                </div>
              );
            })()}
          </>
        );
      })()}

      {newDayName !== null ? (
        <div className="flex gap-2 bg-zinc-900 border border-zinc-800 rounded-xl p-2">
          <input autoFocus value={newDayName} onChange={(e) => setNewDayName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newDayName.trim()) handleCreateDay(); if (e.key === "Escape") setNewDayName(null); }}
            placeholder="Название дня" className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          <button onClick={handleCreateDay} disabled={!newDayName.trim() || addBusy} className="px-3 py-2 text-sm rounded-lg bg-lime-400 text-zinc-950 font-semibold hover:bg-lime-300 transition disabled:opacity-40 whitespace-nowrap">{addBusy ? "Добавляю…" : "Создать"}</button>
          <button onClick={() => setNewDayName(null)} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 transition"><X size={16} /></button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button onClick={() => setNewDayName("")} className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:border-lime-400/40 rounded-xl h-11 text-sm font-semibold text-zinc-200 hover:text-lime-400 transition"><Plus size={16} /> Добавить день</button>
          <button onClick={() => setShowDayLibrary(true)} className="flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:border-cyan-400/40 rounded-xl h-11 px-3 text-sm font-semibold text-zinc-400 hover:text-cyan-400 transition whitespace-nowrap"><BookOpen size={14} /> Шаблоны</button>
          <button onClick={handleAddMesocycle} disabled={addBusy} className="flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 hover:border-cyan-400/40 rounded-xl h-11 px-3 text-sm font-semibold text-zinc-400 hover:text-cyan-400 transition whitespace-nowrap disabled:opacity-40"><Layers size={14} /> Блок</button>
        </div>
      )}
      {pasteInput !== null ? (
        <div className="flex gap-2 bg-zinc-900 border border-cyan-400/30 rounded-xl p-2">
          <input autoFocus value={pasteInput} onChange={(e) => setPasteInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && pasteInput.trim()) handlePasteDay(); if (e.key === "Escape") setPasteInput(null); }}
            placeholder="Название дня" className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40" />
          <button onClick={handlePasteDay} disabled={!pasteInput.trim() || addBusy} className="px-3 py-2 text-sm rounded-lg bg-cyan-400 text-zinc-950 font-semibold hover:bg-cyan-300 transition disabled:opacity-40 whitespace-nowrap">{addBusy ? "Вставляю…" : "Вставить"}</button>
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
      {historyFor !== null && <ExerciseHistoryModal name={historyFor} sessions={sessions} metrics={metrics} onClose={() => setHistoryFor(null)} />}
      {/* П4: заметка внизу — заполняется редко, а сверху занимала строку наравне с названием */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <label htmlFor="plan-note" className="block text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5">Заметка к плану</label>
        <input id="plan-note" value={plan.note} onChange={(e) => { markSaving(); updatePlanMeta({ note: e.target.value }); }}
          placeholder="Напр. прогрессия каждые 2 недели"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50" />
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 text-zinc-100 text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg border border-zinc-700 pointer-events-none">{toast}</div>}
    </div>
  );
}
