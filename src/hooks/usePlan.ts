import { useEffect, useRef, useState } from "react";
import * as api from "../lib/plans";
import type { Day, Exercise, Mesocycle, Plan, SetRow } from "../types";
import { useDebouncedPersist } from "./useDebouncedPersist";

export function usePlan(planId: string) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const persist = useDebouncedPersist();
  // temp-id → real-id map for optimistic exercise creation
  const tempIdMap = useRef<Map<string, string>>(new Map());

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = () =>
    api.fetchPlan(planId)
      .then((p) => { if (!mountedRef.current) return; setPlan(p); setLoading(false); })
      .catch((e) => { if (!mountedRef.current) return; setError(e.message); setLoading(false); });

  useEffect(() => {
    if (!planId) { setPlan(null); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api.fetchPlan(planId)
      .then((p) => { if (alive) { setPlan(p); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [planId]);

  const updatePlanMeta = (patch: Partial<Pick<Plan, "name" | "note" | "visibleToClient">>) => {
    setPlan((p) => (p ? { ...p, ...patch } : p));
    if ("visibleToClient" in patch) {
      api.updatePlanMeta(planId, patch).catch((e) => console.error("[usePlan] updatePlanMeta (visible):", e));
    } else {
      persist("plan", patch as Record<string, any>, (pp) => api.updatePlanMeta(planId, pp));
    }
  };

  const addDay = async (name: string) => {
    if (!plan || !name.trim()) return;
    // П2: новый день встаёт сверху. Самый свежий блок теперь тоже наверху,
    // то есть с наименьшей позицией — сортировка по возрастанию, не по убыванию.
    const sortedMesos = [...(plan.mesocycles ?? [])].sort((a, b) => a.position - b.position);
    const activeMeso = sortedMesos.find((m) => m.visibleToClient !== false) ?? null;
    const snapshot = plan.days;
    const row = await api.addDay(planId, name.trim(), 0, activeMeso?.id);
    const day: Day = {
      id: row.id, name: row.name, weekday: row.weekday, dateOf: null,
      exercises: [], visibleToClient: true, mesocycleId: activeMeso?.id ?? null, archivedAt: null,
    };
    const next = [day, ...snapshot];
    setPlan((p) => (p ? { ...p, days: next } : p));
    try {
      await api.reorderDays(next.map((d, i) => ({ id: d.id, position: i })));
    } catch (e) {
      // День создан, перенумерация не прошла. Порядок в базе стал неоднозначным, но данные целы —
      // откатывать нечего, поправится при следующем перетаскивании или перезагрузке.
      console.error("[usePlan] addDay renumber:", e);
    }
  };

  const updateDay = (dayId: string, patch: Partial<Pick<Day, "name" | "weekday" | "dateOf" | "visibleToClient" | "mesocycleId" | "method" | "archivedAt">>) => {
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) } : p));
    // Переключатели пишем сразу, без дебаунса: пользователь может уйти с экрана раньше,
    // чем сработает отложенная запись, и «день проведён» потеряется.
    if ("visibleToClient" in patch || "archivedAt" in patch) {
      api.updateDay(dayId, patch as Record<string, any>).catch((e) => console.error("[usePlan] updateDay (flag):", e));
    } else {
      persist(`day:${dayId}`, patch as Record<string, any>, (pp) => api.updateDay(dayId, pp).catch((e) => console.error("[usePlan] updateDay failed:", e)));
    }
  };

  const deleteDay = async (dayId: string) => {
    if (!plan) return;
    const snapshot = plan.days;
    setPlan((p) => (p ? { ...p, days: p.days.filter((d) => d.id !== dayId) } : p));
    try {
      await api.deleteDay(dayId);
    } catch {
      setPlan((p) => (p ? { ...p, days: snapshot } : p));
    }
  };

  const reorderDays = async (from: number, to: number) => {
    if (!plan || from === to) return;
    const snapshot = plan.days;
    const arr = [...plan.days];
    const [m] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(arr.length, to)), 0, m);
    setPlan((p) => (p ? { ...p, days: arr } : p));
    try {
      await api.reorderDays(arr.map((d, i) => ({ id: d.id, position: i })));
    } catch {
      setPlan((p) => (p ? { ...p, days: snapshot } : p));
    }
  };

  const addExercise = async (dayId: string, name = "") => {
    if (!plan) return;
    const day = plan.days.find((d) => d.id === dayId);
    if (!day) return;
    // Optimistic: показываем сразу с temp ID, потом заменяем на реальный
    const tempId = `temp-${crypto.randomUUID()}`;
    // П13: новое упражнение сразу в режиме «разные подходы» — тренер почти всегда
    // включал его вручную. Три пустые строки, как их делает toggleDetailed: без них
    // раскрытый вид был бы пустым. Существующие упражнения не трогаем.
    const setRows = Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), weight: "", reps: "" }));
    const blank: Exercise = {
      id: tempId, name, sets: "", reps: "", weight: "", rest: "",
      note: "", video: "", detailed: true, group: "",
      tempo: "", duration: "", target: "", kind: "", pulseZone: "", setRows,
    };
    setPlan((p) => (p ? { ...p, days: p.days.map((d) =>
      d.id === dayId ? { ...d, exercises: [...d.exercises, blank] } : d
    )} : p));
    try {
      const row = await api.addExercise(dayId, day.exercises.length, name, true);
      tempIdMap.current.set(tempId, row.id);
      // Строки подходов пишем уже по реальному id — по временному они ушли бы в никуда
      api.setSetRows(row.id, setRows).catch((e) => console.error("[usePlan] addExercise setSetRows:", e));
      setPlan((p) => (p ? { ...p, days: p.days.map((d) =>
        d.id === dayId ? { ...d, exercises: d.exercises.map((e) =>
          e.id === tempId ? { ...blank, id: row.id } : e
        )} : d
      )} : p));
    } catch {
      // Rollback optimistic add
      setPlan((p) => (p ? { ...p, days: p.days.map((d) =>
        d.id === dayId ? { ...d, exercises: d.exercises.filter((e) => e.id !== tempId) } : d
      )} : p));
    }
  };

  const updateExercise = (dayId: string, exId: string, patch: Partial<Exercise>) => {
    setPlan((p) =>
      p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: d.exercises.map((e) => (e.id === exId ? { ...e, ...patch } : e)) } : d)) } : p
    );
    // Разрешаем temp ID в реальный в момент срабатывания debounce (не в момент вызова)
    if ("setRows" in patch) persist(`setRows:${exId}`, { r: patch.setRows }, (pp) => {
      const id = tempIdMap.current.get(exId) ?? exId;
      if (!id.startsWith("temp-")) api.setSetRows(id, pp.r as SetRow[]).catch((e) => console.error("[usePlan] setSetRows failed:", e));
    });
    const rest = { ...patch } as Record<string, any>;
    delete rest.setRows;
    if (Object.keys(rest).length) persist(`ex:${exId}`, rest, (pp) => {
      const id = tempIdMap.current.get(exId) ?? exId;
      if (!id.startsWith("temp-")) api.updateExercise(id, pp).catch((e) => console.error("[usePlan] updateExercise failed:", e));
    });
  };

  const deleteExercise = async (dayId: string, exId: string) => {
    // Отменить pending debounce для этого упражнения, иначе update прилетит после delete
    persist.cancel(`ex:${exId}`);
    persist.cancel(`setRows:${exId}`);
    const snapshot = plan?.days.find((d) => d.id === dayId)?.exercises;
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: d.exercises.filter((e) => e.id !== exId) } : d)) } : p));
    const realId = tempIdMap.current.get(exId) ?? exId;
    if (!realId.startsWith("temp-")) {
      try {
        await api.deleteExercise(realId);
      } catch {
        if (snapshot) setPlan((p) => (p ? { ...p, days: p.days.map((d) => d.id === dayId ? { ...d, exercises: snapshot } : d) } : p));
      }
    }
  };

  const reorderExercises = async (dayId: string, from: number, to: number) => {
    if (!plan || from === to) return;
    const day = plan.days.find((d) => d.id === dayId);
    if (!day) return;
    const snapshot = day.exercises;
    const arr = [...day.exercises];
    const [m] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(arr.length, to)), 0, m);
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: arr } : d)) } : p));
    try {
      await api.reorderExercises(arr.map((e, i) => ({ id: e.id, position: i })));
    } catch {
      setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: snapshot } : d)) } : p));
    }
  };

  // ── Мезоциклы ──
  const addMesocycle = async () => {
    if (!plan) return;
    // П2: новый блок сверху. Имя считаем от количества — позиция теперь всегда 0.
    const snapshot = plan.mesocycles ?? [];
    try {
      const meso = await api.addMesocycle(planId, 0, `Блок ${snapshot.length + 1}`);
      const next = [meso, ...snapshot];
      setPlan((p) => (p ? { ...p, mesocycles: next } : p));
      try {
        await api.reorderMesocycles(next.map((m, i) => ({ id: m.id, position: i })));
        setPlan((p) => (p ? { ...p, mesocycles: next.map((m, i) => ({ ...m, position: i })) } : p));
      } catch (e) {
        console.error("[usePlan] addMesocycle renumber:", e);
        setPlan((p) => (p ? { ...p, mesocycles: [...snapshot, meso] } : p));
      }
    } catch (e) { console.error("[usePlan] addMesocycle:", e); }
  };

  const updateMesocycle = (mesoId: string, patch: Partial<Pick<Mesocycle, "name" | "visibleToClient">>) => {
    setPlan((p) => (p ? { ...p, mesocycles: (p.mesocycles ?? []).map((m) => (m.id === mesoId ? { ...m, ...patch } : m)) } : p));
    if ("visibleToClient" in patch) {
      api.updateMesocycle(mesoId, patch).catch((e) => console.error("[usePlan] updateMesocycle (visible):", e));
    } else {
      persist(`meso:${mesoId}`, patch as Record<string, any>, (pp) => api.updateMesocycle(mesoId, pp));
    }
  };

  const deleteMesocycle = async (mesoId: string) => {
    if (!plan) return;
    const snapMesos = plan.mesocycles ?? [];
    const snapDays = plan.days;
    setPlan((p) => (p ? { ...p, mesocycles: (p.mesocycles ?? []).filter((m) => m.id !== mesoId), days: p.days.map((d) => d.mesocycleId === mesoId ? { ...d, mesocycleId: null } : d) } : p));
    try { await api.deleteMesocycle(mesoId); }
    catch (e) { setPlan((p) => (p ? { ...p, mesocycles: snapMesos, days: snapDays } : p)); console.error("[usePlan] deleteMesocycle:", e); }
  };

  return {
    plan, loading, error,
    updatePlanMeta, addDay, updateDay, deleteDay, reorderDays,
    addExercise, updateExercise, deleteExercise, reorderExercises,
    addMesocycle, updateMesocycle, deleteMesocycle,
    reload: load,
  };
}
