import { useEffect, useRef, useState } from "react";
import { readJson, removeKey, touchDraft, writeJson } from "../lib/storage";
import * as clientsApi from "../lib/clients";
import type { Membership, PlanListItem } from "../lib/clients";
import { parseNum, today } from "../lib/format";
import * as plansApi from "../lib/plans";
import { applyLastTime, buildMetrics, lastTimeFor, tonnageOf, type LastTime } from "../lib/sessionUtils";
import { fetchProgress } from "../lib/progress";
import { finishWorkout } from "../lib/finishWorkout";
import { feelingLabel } from "../components/FeelingScale";
import type { Day, Plan, Session } from "../types";

export type SetVal = { weight: string; reps: string };
export type ExMeta = { done: boolean; note: string; fires: Record<number, number>; rpe: number; setsDone?: Record<number, boolean> };

export const buildVals = (day: Day): Record<string, SetVal[]> => {
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

export const buildMeta = (day: Day): Record<string, ExMeta> => {
  const m: Record<string, ExMeta> = {};
  day.exercises.forEach((ex) => { m[ex.id] = { done: false, note: "", fires: {}, rpe: 0, setsDone: {} }; });
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
// Черновик слота совместной тренировки: всё введённое, чтобы пережить перезагрузку,
// сворачивание и переключение «Рядом» ↔ «Вкладки» (там слоты монтируются заново).
type SlotDraft = {
  planId: string; dayId: string; vals: Record<string, SetVal[]>; meta: Record<string, ExMeta>;
  mood: number; wellbeing: number; review: string; clientRating: number; finished: boolean;
};
const draftPrefix = (groupId: string, clientId: string) => `th-gslot-${groupId}-${clientId}`;
export const readSlotDraft = (groupId: string, clientId: string) => readJson<SlotDraft | null>(`${draftPrefix(groupId, clientId)}-vals`, null);
export const clearSlotDrafts = (groupId: string, clientIds: string[]) => clientIds.forEach((id) => removeKey(`${draftPrefix(groupId, id)}-vals`));

export function useSessionSlot(clientId: string, trainerId: string, onFinished: () => void, groupId?: string) {
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

  useEffect(() => {
    clientsApi.fetchClientPlans(clientId).then((list) => {
      setPlans(list);
      const first = (draft && list.find((p) => p.id === draft.planId)) || list.find((p) => !p.archived) || list[0];
      if (first) setPlanId(first.id);
    }).catch((e) => console.error("[useSessionSlot] fetchPlans:", e));
    clientsApi.fetchClient(clientId).then((c) => setMembership(c.membership)).catch((e) => console.error("[useSessionSlot] fetchClient:", e));
  }, [clientId]);

  useEffect(() => {
    if (!planId) { setPlan(null); setDayId(""); return; }
    plansApi.fetchPlan(planId).then((p) => {
      setPlan(p);
      const fromDraft = !restored.current && draft?.planId === planId && p.days.some((d) => d.id === draft.dayId);
      setDayId(fromDraft ? draft!.dayId : p.days[0]?.id || "");
    }).catch((e) => console.error("[useSessionSlot] fetchPlan:", e));
  }, [planId]);

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
    if (!groupId || !dayId || !Object.keys(vals).length) return;
    // Сразу, без задержки: при переключении «Рядом» ↔ «Вкладки» слот размонтируется,
    // и отложенная запись потеряла бы последний ввод
    const p = draftPrefix(groupId, clientId);
    if (writeJson(`${p}-vals`, { planId, dayId, vals, meta, mood, wellbeing, review, clientRating, finished } satisfies SlotDraft)) touchDraft(p);
  }, [groupId, clientId, planId, dayId, vals, meta, mood, wellbeing, review, clientRating, finished]);

  const setVal = (exId: string, i: number, patch: Partial<SetVal>) =>
    setVals((a) => ({ ...a, [exId]: (a[exId] ?? []).map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const setMetaFor = (exId: string, patch: Partial<ExMeta>) => setMeta((m) => ({ ...m, [exId]: { ...m[exId], ...patch } }));
  const setFire = (exId: string, idx: number, v: number) =>
    setMeta((m) => ({ ...m, [exId]: { ...m[exId], fires: { ...m[exId].fires, [idx]: v } } }));
  // Отметка подхода, как в индивидуальной тренировке: все подходы отмечены — упражнение выполнено
  const toggleSetDone = (exId: string, setIdx: number, total: number) =>
    setMeta((m) => {
      const cur = m[exId] || { done: false, note: "", fires: {}, rpe: 0, setsDone: {} };
      const sd = { ...(cur.setsDone || {}), [setIdx]: !cur.setsDone?.[setIdx] };
      const allDone = Array.from({ length: total }, (_, i) => i).every((i) => sd[i]);
      return { ...m, [exId]: { ...cur, setsDone: sd, done: allDone } };
    });
  // Неотмеченные подходы у этого подопечного — после последнего отдых не нужен
  const openSets = () => (day ? day.exercises.reduce((n, ex) =>
    ex.kind === "functional" || !ex.name || meta[ex.id]?.done ? n
      : n + (vals[ex.id] || []).filter((_, i) => !meta[ex.id]?.setsDone?.[i]).length, 0) : 0);

  // «Как в прошлый раз» — последнее проведение выбранного дня этого подопечного
  const [last, setLast] = useState<LastTime | null>(null);
  const [beforeLast, setBeforeLast] = useState<Record<string, SetVal[]> | null>(null);
  useEffect(() => {
    setLast(null); setBeforeLast(null);
    if (!plan || !day) return;
    let alive = true;
    fetchProgress(plan.id).then((d) => { if (alive) setLast(lastTimeFor(d.sessions, day)); }).catch((e) => console.error("[useSessionSlot] прошлый раз:", e));
    return () => { alive = false; };
  }, [plan?.id, day?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyLast = () => { if (!day || !last) return; setBeforeLast(vals); setVals(applyLastTime(day, vals, (id) => meta[id]?.setsDone, last)); };
  const undoLast = () => { if (beforeLast) { setVals(beforeLast); setBeforeLast(null); } };

  const doneEx = day ? day.exercises.filter((ex) => meta[ex.id]?.done).length : 0;
  const totalTonnage = day ? day.exercises.reduce((sum, ex) => sum + (ex.kind === "functional" ? 0 : tonnageOf(vals[ex.id] || [], meta[ex.id]?.setsDone)), 0) : 0;

  const finish = async () => {
    if (!day || !plan || busy) return;
    setBusy(true);
    try {
      const metrics = buildMetrics(day, vals);
      const items = day.exercises.filter((ex) => ex.name).map((ex) => {
        const f = meta[ex.id]?.fires || {};
        const effort = Math.max(0, ...Object.values(f).map((x) => x || 0));
        return { name: ex.name, effort, rpe: meta[ex.id]?.rpe || 0, note: meta[ex.id]?.note || "" };
      });
      const session: Omit<Session, "id"> = {
        date: today(), dayName: day.name, dayId: day.id, mood, wellbeing, review: review.trim(), clientRating,
        done: doneEx, total: day.exercises.length, fromClient: false, items,
      };
      const note = `✅ Проведена: ${day.name} (${doneEx}/${day.exercises.length} упр.)${mood ? ` · настроение: ${feelingLabel("mood", mood).toLowerCase()}` : ""}`;
      // Д3: запись сессии, архивация дня, отметка в календаре и двойной гард
      // списания — всё в одной общей функции, а не копией на каждый экран.
      const res = await finishWorkout({ trainerId, clientId, planId: plan.id, day, metrics, note, session, membership });
      setMembership(res.membership);
      setFinished(true);
      onFinished();
    } catch (e) {
      console.error("[useSessionSlot] finish:", e);
      alert("Не удалось сохранить тренировку. Попробуй ещё раз.");
    } finally { setBusy(false); }
  };

  return {
    plans, planId, setPlanId, plan, dayId, setDayId, day,
    membership, finished, busy,
    vals, meta, setVal, setMetaFor, setFire, toggleSetDone, openSets,
    mood, setMood, wellbeing, setWellbeing, review, setReview, clientRating, setClientRating,
    doneEx, totalTonnage, finish,
    last, lastApplied: !!beforeLast, applyLast, undoLast,
  };
}
