import { useEffect, useState } from "react";
import { fetchClientDoneSessions } from "../lib/bookings";
import * as clientsApi from "../lib/clients";
import type { Membership, PlanListItem } from "../lib/clients";
import { parseNum, today } from "../lib/format";
import * as plansApi from "../lib/plans";
import * as progressApi from "../lib/progress";
import { buildMetrics } from "../lib/sessionUtils";
import { MOOD_EMOJI } from "../constants";
import type { Day, Plan, Session } from "../types";

export type SetVal = { weight: string; reps: string };
export type ExMeta = { done: boolean; note: string; fires: Record<number, number>; rpe: number };

export const tonnageOf = (rows: SetVal[]) =>
  rows.reduce((sum, r) => {
    const w = parseNum(r.weight);
    const rp = parseNum(r.reps);
    return w != null && rp != null ? sum + w * rp : sum;
  }, 0);

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
  day.exercises.forEach((ex) => { m[ex.id] = { done: false, note: "", fires: {}, rpe: 0 }; });
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
export function useSessionSlot(clientId: string, trainerId: string, onFinished: () => void) {
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dayId, setDayId] = useState("");
  const [membership, setMembership] = useState<Membership | null>(null);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vals, setVals] = useState<Record<string, SetVal[]>>({});
  const [meta, setMeta] = useState<Record<string, ExMeta>>({});
  const [mood, setMood] = useState(0);
  const [wellbeing, setWellbeing] = useState(0);
  const [review, setReview] = useState("");
  const [clientRating, setClientRating] = useState(0);

  useEffect(() => {
    clientsApi.fetchClientPlans(clientId).then((list) => {
      setPlans(list);
      const first = list.find((p) => !p.archived) || list[0];
      if (first) setPlanId(first.id);
    }).catch((e) => console.error("[useSessionSlot] fetchPlans:", e));
    clientsApi.fetchClient(clientId).then((c) => setMembership(c.membership)).catch((e) => console.error("[useSessionSlot] fetchClient:", e));
  }, [clientId]);

  useEffect(() => {
    if (!planId) { setPlan(null); setDayId(""); return; }
    plansApi.fetchPlan(planId).then((p) => { setPlan(p); setDayId(p.days[0]?.id || ""); }).catch((e) => console.error("[useSessionSlot] fetchPlan:", e));
  }, [planId]);

  const day = plan?.days.find((d) => d.id === dayId) || null;

  useEffect(() => {
    if (!day) return;
    setVals(buildVals(day));
    setMeta(buildMeta(day));
  }, [day?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setVal = (exId: string, i: number, patch: Partial<SetVal>) =>
    setVals((a) => ({ ...a, [exId]: (a[exId] ?? []).map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const setMetaFor = (exId: string, patch: Partial<ExMeta>) => setMeta((m) => ({ ...m, [exId]: { ...m[exId], ...patch } }));
  const setFire = (exId: string, idx: number, v: number) =>
    setMeta((m) => ({ ...m, [exId]: { ...m[exId], fires: { ...m[exId].fires, [idx]: v } } }));

  const doneEx = day ? day.exercises.filter((ex) => meta[ex.id]?.done).length : 0;
  const totalTonnage = day ? day.exercises.reduce((sum, ex) => sum + tonnageOf(vals[ex.id] || []), 0) : 0;

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
      const note = `✅ Проведена: ${day.name} (${doneEx}/${day.exercises.length} упр.)${mood ? ` · настроение ${MOOD_EMOJI[mood - 1]}` : ""}`;
      await progressApi.logSession(plan.id, metrics, note, session);
      // П3: день уходит в «Проведённые» и из группового проведения тоже
      plansApi.updateDay(day.id, { archivedAt: new Date().toISOString() }).catch((e) => console.error("[useSessionSlot] archive day:", e));
      // П12: двойной гард списания — сессия клиента и отметка в календаре.
      // При ошибке любой проверки списание пропускаем: недосписать безопаснее.
      let skipCharge = false;
      try {
        const { sessions } = await progressApi.fetchProgress(plan.id);
        skipCharge = sessions.some((s) => s.dayName === session.dayName && s.date === session.date && s.fromClient);
      } catch (e) { console.error("[useSessionSlot] проверка сессий:", e); skipCharge = true; }
      if (!skipCharge) {
        try {
          const done = await fetchClientDoneSessions(trainerId, clientId);
          skipCharge = done.some((d) => d.date === session.date);
        } catch (e) { console.error("[useSessionSlot] проверка календаря:", e); skipCharge = true; }
      }
      if (membership && !skipCharge) setMembership(await clientsApi.decrementMembershipRemaining(clientId, membership));
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
    vals, meta, setVal, setMetaFor, setFire,
    mood, setMood, wellbeing, setWellbeing, review, setReview, clientRating, setClientRating,
    doneEx, totalTonnage, finish,
  };
}
