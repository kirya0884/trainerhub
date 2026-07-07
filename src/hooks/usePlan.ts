import { useEffect, useState } from "react";
import * as api from "../lib/plans";
import type { Day, Exercise, Mesocycle, Plan, SetRow } from "../types";
import { useDebouncedPersist } from "./useDebouncedPersist";

export function usePlan(planId: string) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const persist = useDebouncedPersist();

  const load = () =>
    api.fetchPlan(planId)
      .then((p) => { setPlan(p); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.fetchPlan(planId)
      .then((p) => { if (alive) { setPlan(p); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [planId]);

  const updatePlanMeta = (patch: Partial<Pick<Plan, "name" | "note" | "visibleToClient">>) => {
    setPlan((p) => (p ? { ...p, ...patch } : p));
    persist("plan", patch as Record<string, any>, (pp) => api.updatePlanMeta(planId, pp));
  };

  const addDay = async () => {
    if (!plan) return;
    const position = plan.days.length;
    // Авто-назначаем новый день в последний видимый мезоцикл
    const sortedMesos = [...(plan.mesocycles ?? [])].sort((a, b) => b.position - a.position);
    const activeMeso = sortedMesos.find((m) => m.visibleToClient !== false) ?? null;
    const row = await api.addDay(planId, `День ${position + 1}`, position, activeMeso?.id);
    setPlan((p) => (p ? { ...p, days: [...p.days, {
      id: row.id, name: row.name, weekday: row.weekday, dateOf: null,
      exercises: [], visibleToClient: true, mesocycleId: activeMeso?.id ?? null,
    }] } : p));
  };

  const updateDay = (dayId: string, patch: Partial<Pick<Day, "name" | "weekday" | "dateOf" | "visibleToClient" | "mesocycleId">>) => {
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) } : p));
    persist(`day:${dayId}`, patch as Record<string, any>, (pp) => api.updateDay(dayId, pp));
  };

  const deleteDay = async (dayId: string) => {
    setPlan((p) => (p ? { ...p, days: p.days.filter((d) => d.id !== dayId) } : p));
    await api.deleteDay(dayId);
  };

  const reorderDays = async (from: number, to: number) => {
    if (!plan || from === to) return;
    const arr = [...plan.days];
    const [m] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(arr.length, to)), 0, m);
    setPlan((p) => (p ? { ...p, days: arr } : p));
    await api.reorderDays(arr.map((d, i) => ({ id: d.id, position: i })));
  };

  const addExercise = async (dayId: string, name = "") => {
    if (!plan) return;
    const day = plan.days.find((d) => d.id === dayId);
    if (!day) return;
    const row = await api.addExercise(dayId, day.exercises.length, name);
    const ex: Exercise = {
      id: row.id, name: row.name, sets: row.sets, reps: row.reps, weight: row.weight, rest: row.rest,
      note: row.note, video: row.video, detailed: row.detailed, group: row.exercise_group,
      tempo: row.tempo, duration: row.duration, target: row.target, setRows: [],
    };
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: [...d.exercises, ex] } : d)) } : p));
  };

  const updateExercise = (dayId: string, exId: string, patch: Partial<Exercise>) => {
    setPlan((p) =>
      p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: d.exercises.map((e) => (e.id === exId ? { ...e, ...patch } : e)) } : d)) } : p
    );
    if ("setRows" in patch) api.setSetRows(exId, patch.setRows as SetRow[]);
    const rest = { ...patch } as Record<string, any>;
    delete rest.setRows;
    if (Object.keys(rest).length) persist(`ex:${exId}`, rest, (pp) => api.updateExercise(exId, pp));
  };

  const deleteExercise = async (dayId: string, exId: string) => {
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: d.exercises.filter((e) => e.id !== exId) } : d)) } : p));
    await api.deleteExercise(exId);
  };

  const reorderExercises = async (dayId: string, from: number, to: number) => {
    if (!plan || from === to) return;
    const day = plan.days.find((d) => d.id === dayId);
    if (!day) return;
    const arr = [...day.exercises];
    const [m] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(arr.length, to)), 0, m);
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: arr } : d)) } : p));
    await api.reorderExercises(arr.map((e, i) => ({ id: e.id, position: i })));
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
    persist(`meso:${mesoId}`, patch as Record<string, any>, (pp) => api.updateMesocycle(mesoId, pp));
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
