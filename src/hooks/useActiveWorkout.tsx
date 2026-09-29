import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Day } from "../types";

export type ActiveWorkout = { day: Day; planId: string; clientId: string; clientName: string };

type Ctx = {
  active: ActiveWorkout | null;
  /** Возвращает false, если тренировка уже идёт — вторую поверх не открываем. */
  start: (w: ActiveWorkout) => boolean;
  stop: () => void;
};

const WorkoutCtx = createContext<Ctx>({ active: null, start: () => false, stop: () => {} });

/**
 * Д3: активная тренировка живёт на уровне приложения.
 *
 * Раньше SessionModal рендерился внутри PlanEditor, а тот существует только пока
 * открыт экран плана. Тренер сворачивал тренировку, уходил в календарь — компонент
 * размонтировался, и свёрнутая плашка исчезала вместе с таймером. Черновик в
 * хранилище спасал введённые веса, но сам факт «идёт тренировка» терялся.
 *
 * Теперь состояние держит провайдер над всеми экранами, поэтому плашка переживает
 * любую навигацию и открывается откуда угодно.
 */
export function ActiveWorkoutProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveWorkout | null>(null);
  // Проверяем через ref: обновление состояния не синхронное, и по нему нельзя
  // сразу ответить вызывающему, можно ли начинать.
  const ref = useRef<ActiveWorkout | null>(null);

  const start = useCallback((w: ActiveWorkout) => {
    if (ref.current) return false; // одна тренировка за раз
    ref.current = w;
    setActive(w);
    return true;
  }, []);

  const stop = useCallback(() => { ref.current = null; setActive(null); }, []);
  const value = useMemo(() => ({ active, start, stop }), [active, start, stop]);
  return <WorkoutCtx.Provider value={value}>{children}</WorkoutCtx.Provider>;
}

export const useActiveWorkout = () => useContext(WorkoutCtx);
