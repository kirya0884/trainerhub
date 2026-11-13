import { useEffect, useRef, useState } from "react";
import { touchDraft, writeJson } from "../lib/storage";
import * as clientsApi from "../lib/clients";
import type { Membership, PlanListItem } from "../lib/clients";
import { fmtDate, today } from "../lib/format";
import * as plansApi from "../lib/plans";
import { applyLastTime, buildMetrics, doneSets, factSets, itemRpe, lastFactsByName, lastTimeFor, nextDayOf, tonnageOf, type LastFact, type LastTime } from "../lib/sessionUtils";
import { fetchProgressCached } from "../lib/progress";
import { cached, onRevalidate, releaseStale, staleAtOf } from "../lib/offlineCache";
import { useActiveWorkout } from "./useActiveWorkout";
import { finishOrQueue, finishSummary } from "../lib/finishWorkout";
import { feelingLabel } from "../components/FeelingScale";
import { addSetRow, askUnmarked, askUntouched, confirmFinish, metaAfterRemove, resolveWorkoutDate } from "../components/SessionParts";
import type { Day, Plan, Session } from "../types";
import { notify } from "../lib/dialog";
import { draftPrefix, readSlotDraft, type SlotDraft } from "../lib/slotDrafts";

export type SetVal = { weight: string; reps: string; rpe?: number };
export type ExMeta = { done: boolean; note: string; setsDone?: Record<number, boolean>; skipped?: boolean };

export const buildVals = (day: Day): Record<string, SetVal[]> => {
  const init: Record<string, SetVal[]> = {};
  day.exercises.forEach((ex) => {
    if (ex.detailed && ex.setRows?.length) init[ex.id] = ex.setRows.map((s) => ({ weight: s.weight || "", reps: s.reps || "" }));
    else {
      const n = Math.max(1, Math.min(12, parseInt(ex.sets) || 3));
      init[ex.id] = Array.from({ length: n }, () => ({ weight: ex.weight || "", reps: ex.reps || "" }));
    }
  });
  return init;
};

export const buildMeta = (day: Day): Record<string, ExMeta> => {
  const m: Record<string, ExMeta> = {};
  day.exercises.forEach((ex) => { m[ex.id] = { done: false, note: "", setsDone: {} }; });
  return m;
};

/**
 * Д1: состояние одного «слота» группового проведения — свой план, день, подходы,
 * заметки и завершение. Раньше всё это жило внутри компонента ClientSlot, поэтому
 * родитель не видел подходы сразу двух подопечных и режим «две колонки» был невозможен.
 *
 * Логика перенесена без изменений, включая двойной гард списания из П12:
 * при ошибке любой из проверок списание пропускается — недосписать безопаснее,
 * чем списать дважды.
 */
// Черновики слотов — в lib/slotDrafts (App пишет их, не загружая этот модуль)
export { readSlotDraft, writeSlotDraft, clearSlotDrafts, type SlotDraft } from "../lib/slotDrafts";

export function useSessionSlot(clientId: string, trainerId: string, onFinished: () => void, groupId?: string, clientName?: string) {
  // Черновик читаем один раз при монтировании
  const [draft] = useState(() => (groupId ? readSlotDraft(groupId, clientId) : null));
  const restored = useRef(false);
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dayId, setDayId] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [finished, setFinished] = useState(draft?.finished ?? false);
  const [busy, setBusy] = useState(false);
  const [vals, setVals] = useState<Record<string, SetVal[]>>({});
  const [meta, setMeta] = useState<Record<string, ExMeta>>({});
  const [mood, setMood] = useState(draft?.mood ?? 0);
  const [wellbeing, setWellbeing] = useState(draft?.wellbeing ?? 0);
  const [review, setReview] = useState(draft?.review ?? "");
  const [clientRating, setClientRating] = useState(draft?.clientRating ?? 0);

  // Начата из записи календаря — день из записи у того, чей это план (разбор путей 4.7)
  const { active } = useActiveWorkout();
  const [prefer] = useState(() => (active?.kind === "group" ? active.booking : undefined));
  // Разбор путей 4.8: планы и абонемент — с кэшем, без сети открываются сохранённые;
  // не загрузились совсем — ошибка с «Повторить», а не вечная «Загрузка планов…»
  const [plansFailed, setPlansFailed] = useState(false);
  const [planFailed, setPlanFailed] = useState(false);
  const [plansKey, setPlansKey] = useState(0);
  const [planKey, setPlanKey] = useState(0);
  // Повторяем только то, что не загрузилось: иначе сбросился бы выбранный план и день
  const retryLoad = () => {
    if (plansFailed) { setPlansFailed(false); setPlansKey((k) => k + 1); }
    if (planFailed) setPlanKey((k) => k + 1);
  };
  useEffect(() => {
    cached(`client-plans:${clientId}`, () => clientsApi.fetchClientPlans(clientId)).then((list) => {
      setPlans(list);
      // План из записи — только действующий: у старой серии он мог уйти в архив
      const first = (draft && list.find((p) => p.id === draft.planId)) || (prefer?.planId && list.find((p) => p.id === prefer.planId && !p.archived))
        || list.find((p) => !p.archived) || list[0];
      if (first) setPlanId(first.id);
    }).catch((e) => { console.error("[useSessionSlot] fetchPlans:", e); setPlansFailed(true); });
    cached(`client:${clientId}`, () => clientsApi.fetchClient(clientId)).then((c) => setMembership(c.membership)).catch((e) => console.error("[useSessionSlot] fetchClient:", e));
  }, [clientId, plansKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Тренер уже выбрал день или ввёл подходы — «следующий день» по истории его не перебивает
  const touched = useRef(false);
  // Загруженный план: не загрузился новый — возвращаемся к нему, а не пишем тренировку в старый под чужим названием
  const planRef = useRef<Plan | null>(null);
  useEffect(() => {
    if (!planId) { setPlan(null); setDayId(""); return; }
    let alive = true;
    setPlanFailed(false);
    plansApi.fetchPlanCached(planId).then((p) => {
      if (!alive) return;
      // Тот же план (повтор, возврат после сбоя) — выбранный день не трогаем
      if (planRef.current?.id === p.id) { planRef.current = p; setPlan(p); return; }
      const archived = new Set((p.mesocycles ?? []).filter((m) => m.archivedAt).map((m) => m.id));
      const live = p.days.filter((d) => !(d.mesocycleId && archived.has(d.mesocycleId)));
      const fromDraft = !restored.current && draft?.planId === planId && p.days.some((d) => d.id === draft.dayId);
      let id = fromDraft ? draft!.dayId : "";
      if (!id && prefer?.planId === planId && prefer.dayId && live.some((d) => d.id === prefer.dayId)) id = prefer.dayId;
      const guess = !id;
      // План — сразу (из кэша без ожидания сети), следующий день по истории — когда она придёт
      touched.current = false;
      planRef.current = p; setPlan(p); setDayId(id || live[0]?.id || p.days[0]?.id || "");
      if (guess) fetchProgressCached(planId).then((hist) => {
        const next = nextDayOf(live, hist.sessions);
        if (alive && next && !touched.current) setDayId(next.id);
      }).catch(() => {});
    }).catch((e) => {
      console.error("[useSessionSlot] fetchPlan:", e);
      if (!alive) return;
      if (planRef.current) { setPlanId(planRef.current.id); notify("Не удалось загрузить этот план — остался прежний. Проверь интернет."); }
      else setPlanFailed(true);
    });
    return () => { alive = false; };
  }, [planId, planKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickDay = (id: string) => { touched.current = true; setDayId(id); };

  const day = plan?.days.find((d) => d.id === dayId) || null;

  useEffect(() => {
    if (!day) return;
    // Первый раз — из черновика, если он про этот же день
    if (!restored.current && draft && draft.dayId === day.id && draft.vals) {
      restored.current = true;
      setVals(draft.vals); setMeta(draft.meta);
      return;
    }
    restored.current = true;
    setVals(buildVals(day));
    setMeta(buildMeta(day));
  }, [day?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Пустой день (без упражнений): vals пуст, но флаг «записана» всё равно сохраняем,
    // иначе после перемонтирования слота снова появится «Завершить»
    if (!groupId || !dayId || (!Object.keys(vals).length && !finished)) return;
    // Сразу, без задержки: при переключении «Рядом» ↔ «Вкладки» слот размонтируется,
    // и отложенная запись потеряла бы последний ввод
    const p = draftPrefix(groupId, clientId);
    if (writeJson(`${p}-vals`, { planId, dayId, vals, meta, mood, wellbeing, review, clientRating, finished } satisfies SlotDraft)) touchDraft(p);
  }, [groupId, clientId, planId, dayId, vals, meta, mood, wellbeing, review, clientRating, finished]);

  const setVal = (exId: string, i: number, patch: Partial<SetVal>) => {
    touched.current = true;
    setVals((a) => ({ ...a, [exId]: (a[exId] ?? []).map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  };
  const setMetaFor = (exId: string, patch: Partial<ExMeta>) => (touched.current = true) && setMeta((m) => ({ ...m, [exId]: { ...m[exId], ...patch } }));
  // Разбор путей 4.1: подход на ходу — только в этой тренировке, план не меняется
  const addSet = (exId: string) => { touched.current = true; setVals((a) => ({ ...a, [exId]: addSetRow(a[exId] ?? []) })); setMetaFor(exId, { done: false }); };
  const removeSet = (exId: string) => {
    touched.current = true;
    const left = (vals[exId] ?? []).length - 1;
    setVals((a) => ({ ...a, [exId]: (a[exId] ?? []).slice(0, left) }));
    setMeta((m) => ({ ...m, [exId]: metaAfterRemove(m[exId] ?? { done: false, note: "", setsDone: {} }, left) }));
  };
  // Отметка подхода, как в индивидуальной тренировке: все подходы отмечены — упражнение выполнено
  const toggleSetDone = (exId: string, setIdx: number, total: number) => (touched.current = true) &&
    setMeta((m) => {
      const cur = m[exId] || { done: false, note: "", setsDone: {} };
      const sd = { ...(cur.setsDone || {}), [setIdx]: !cur.setsDone?.[setIdx] };
      const allDone = Array.from({ length: total }, (_, i) => i).every((i) => sd[i]);
      return { ...m, [exId]: { ...cur, setsDone: sd, done: allDone, skipped: false } };
    });
  // Неотмеченные подходы у этого подопечного — после последнего отдых не нужен
  const openSets = () => (day ? day.exercises.reduce((n, ex) =>
    ex.kind === "functional" || !ex.name || meta[ex.id]?.done || meta[ex.id]?.skipped ? n
      : n + (vals[ex.id] || []).filter((_, i) => !meta[ex.id]?.setsDone?.[i]).length, 0) : 0);

  // «Как в прошлый раз» — последнее проведение выбранного дня этого подопечного
  const [last, setLast] = useState<LastTime | null>(null);
  // «было» у подходов — прошлый результат каждого упражнения (из любого дня плана)
  const [prevByName, setPrevByName] = useState<Record<string, LastFact>>({});
  const [beforeLast, setBeforeLast] = useState<Record<string, SetVal[]> | null>(null);
  // История плана — ещё и для вопроса о повторе при завершении
  const [sessions, setSessions] = useState<Session[] | null>(null);
  useEffect(() => {
    setLast(null); setBeforeLast(null); setSessions(null);
    if (!plan || !day) return;
    let alive = true;
    // «Было» и история; вернулась сеть — перечитываем (могли быть с телефона)
    const load = () => fetchProgressCached(plan.id).then((d) => { if (alive) { setLast(lastTimeFor(d.sessions, day)); setPrevByName(lastFactsByName(d.sessions)); setSessions(d.sessions); } }).catch((e) => console.error("[useSessionSlot] прошлый раз:", e));
    load();
    const offOnline = onRevalidate(() => { if (staleAtOf(`progress:${plan.id}`) !== null) load(); });
    return () => { alive = false; offOnline(); releaseStale(`progress:${plan.id}`); };
  }, [plan?.id, day?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyLast = () => { if (!day || !last) return; touched.current = true; setBeforeLast(vals); setVals(applyLastTime(day, vals, (id) => meta[id]?.setsDone, last)); };
  const undoLast = () => { if (beforeLast) { touched.current = true; setVals(beforeLast); setBeforeLast(null); } };

  const doneEx = day ? day.exercises.filter((ex) => meta[ex.id]?.done).length : 0;
  const skippedEx = day ? day.exercises.filter((ex) => meta[ex.id]?.skipped).length : 0;
  const totalTonnage = day ? day.exercises.reduce((sum, ex) => sum + (ex.kind === "functional" ? 0 : tonnageOf(doneSets(vals[ex.id] || [], meta[ex.id]))), 0) : 0;

  /** dateChoice: null — сегодня, иначе дата задним числом (общая на всю совместную) */
  const finish = async (dateChoice: string | null) => {
    if (!day || !plan || busy) return;
    const date = resolveWorkoutDate(dateChoice);
    if (!date) { notify("Выбери дату тренировки — не позже сегодняшней."); return; }
    // Флаг — до первого await: повторный тап, пока идёт вопрос или запись, ничего не делает
    setBusy(true);
    try {
      if (!(await confirmFinish(day, date, plan.id, sessions))) return;
      // Есть заполненные, но не отмеченные подходы — спросить; закрыли окно — ничего не пишем
      const m1 = await askUnmarked(day, vals, meta);
      // Упражнения совсем без отметок — отметить «не сделано»?
      const m = m1 && await askUntouched(day, m1);
      if (!m) { if (m1 && m1 !== meta) setMeta(m1); return; }
      if (m !== meta) setMeta(m);
      const done = day.exercises.filter((ex) => m[ex.id]?.done).length;
      const skippedN = day.exercises.filter((ex) => m[ex.id]?.skipped).length;
      const metrics = buildMetrics(day, vals, m, date);
      const items = day.exercises.filter((ex) => ex.name).map((ex) => {
        // План/факт — как в индивидуальной тренировке: без них «Как в прошлый раз»
        // и строка факта в плане не видели совместные тренировки. Все подходы с отметкой done
        const actualSets = factSets(vals[ex.id] ?? [], m[ex.id]);
        const plannedSets = ex.detailed && ex.setRows?.length
          ? ex.setRows.map((r) => ({ weight: r.weight || "", reps: r.reps || "" }))
          : Array.from({ length: parseInt(ex.sets) || 1 }, () => ({ weight: ex.weight || "", reps: ex.reps || "" }));
        // effort (огоньки) больше не собираем: усилие — RPE в каждом подходе
        return { name: ex.name, effort: 0, rpe: itemRpe(actualSets), note: m[ex.id]?.note || "", plannedSets, ...(actualSets.length ? { actualSets } : {}), ...(m[ex.id]?.skipped ? { skipped: true } : {}) };
      });
      const session: Omit<Session, "id"> = {
        date, dayName: day.name, dayId: day.id, mood, wellbeing, review: review.trim(), clientRating,
        done, total: day.exercises.length, fromClient: false, items,
      };
      const note = `✅ Проведена${date !== today() ? ` ${fmtDate(date)}` : ""}: ${day.name} (${done}/${day.exercises.length} упр.${skippedN ? `, не сделано: ${skippedN}` : ""})${mood ? ` · настроение: ${feelingLabel("mood", mood).toLowerCase()}` : ""}`;
      // Д3: запись сессии, архивация дня, отметка в календаре и двойной гард
      // списания — всё в одной общей функции, а не копией на каждый экран.
      const res = await finishOrQueue({ trainerId, clientId, planId: plan.id, day, metrics, note, session, membership, booking: prefer && { id: prefer.id, occDate: prefer.occDate } });
      if (!res.queued) notify(`${clientName ? clientName + ": " : ""}${finishSummary(res)}`, res.skipped === "error" ? "error" : "info");
      setMembership(res.membership);
      setFinished(true);
      onFinished();
    } catch (e) {
      console.error("[useSessionSlot] finish:", e);
      notify("Не удалось сохранить тренировку. Попробуй ещё раз.");
    } finally { setBusy(false); }
  };

  return {
    plans, planId, setPlanId, plan, dayId, setDayId: pickDay, day, plansFailed, planFailed, retryLoad,
    membership, finished, busy,
    vals, meta, setVal, setMetaFor, toggleSetDone, openSets, addSet, removeSet,
    mood, setMood, wellbeing, setWellbeing, review, setReview, clientRating, setClientRating,
    doneEx, skippedEx, totalTonnage, finish,
    last, lastApplied: !!beforeLast, applyLast, undoLast, prevByName,
  };
}
