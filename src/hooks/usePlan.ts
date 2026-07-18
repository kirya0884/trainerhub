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
      api.updatePlanMeta(planId, patch); // немедленно — переключатель видимости
    } else {
      persist("plan", patch as Record<string, any>, (pp) => api.updatePlanMeta(planId, pp));
    }
  };

  const addDay = async (name: string) => {
    if (!plan || !name.trim()) return;
    const position = plan.days.length;
    // Авто-назначаем новый день в последний видимый мезоцикл
    const sortedMesos = [...(plan.mesocycles ?? [])].sort((a, b) => b.position - a.position);
    const activeMeso = sortedMesos.find((m) => m.visibleToClient !== false) ?? null;
    const row = await api.addDay(planId, name.trim(), position, activeMeso?.id);
    setPlan((p) => (p ? { ...p, days: [...p.days, {
      id: row.id, name: row.name, weekday: row.weekday, dateOf: null,
      exercises: [], visibleToClient: true, mesocycleId: activeMeso?.id ?? null,
    }] } : p));
  };

  const updateDay = (dayId: string, patch: Partial<Pick<Day, "name" | "weekday" | "dateOf" | "visibleToClient" | "mesocycleId">>) => {
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) } : p));
    if ("visibleToClient" in patch) {
      api.updateDay(dayId, patch as Record<string, any>); // немедленно — переключатель видимости
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
    const blank: Exercise = {
      id: tempId, name, sets: "", reps: "", weight: "", rest: "",
      note: "", video: "", detailed: false, group: "",
      tempo: "", duration: "", target: "", setRows: [],
    };
    setPlan((p) => (p ? { ...p, days: p.days.map((d) =>
      d.id === dayId ? { ...d, exercises: [...d.exercises, blank] } : d
    )} : p));
    try {
      const row = await api.addExercise(dayId, day.exercises.length, name);
      tempIdMap.current.set(tempId, row.id);
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
    const position = (plan.mesocycles ?? []).length;
    const meso = await api.addMesocycle(planId, position);
    setPlan((p) => (p ? { ...p, mesocycles: [...(p.mesocycles ?? []), meso] } : p));
  };

  const updateMesocycle = (mesoId: string, patch: Partial<Pick<Mesocycle, "name" | "visibleToClient">>) => {
    setPlan((p) => (p ? { ...p, mesocycles: (p.mesocycles ?? []).map((m) => (m.id === mesoId ? { ...m, ...patch } : m)) } : p));
    if ("visibleToClient" in patch) {
      api.updateMesocycle(mesoId, patch); // немедленно — переключатель видимости
    } else {
      persist(`meso:${mesoId}`, patch as Record<string, any>, (pp) => api.updateMesocycle(mesoId, pp));
    }
  };

  const deleteMesocycle = async (mesoId: string) => {
    setPlan((p) => {
      if (!p) return p;
      return {
        ...p,
        mesocycles: (p.mesocycles ?? []).filter((m) => m.id !== mesoId),
        days: p.days.map((d) => d.mesocycleId === mesoId ? { ...d, mesocycleId: null } : d),
      };
    });
    await api.deleteMesocycle(mesoId);
  };

  return {
    plan, loading, error,
    updatePlanMeta, addDay, updateDay, deleteDay, reorderDays,
    addExercise, updateExercise, deleteExercise, reorderExercises,
    addMesocycle, updateMesocycle, deleteMesocycle,
    reload: load,
  };
}
