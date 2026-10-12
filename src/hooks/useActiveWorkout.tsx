import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { Day } from "../types";
import { readJson, removeKey, writeJson } from "../lib/storage";

export type SingleWorkout = { kind?: "single"; day: Day; planId: string; clientId: string; clientName: string };
export type GroupClient = { id: string; name: string; color: string; remaining?: string | null };
/** Совместная тренировка 2+ подопечных. id — метка начала: по ней черновики слотов
 *  отличают эту тренировку от прошлых с теми же людьми. booking — если начата из
 *  записи календаря: когда все завершат, запись отмечается проведённой. */
export type GroupWorkout = {
  kind: "group"; id: string; clients: GroupClient[];
  booking?: { id: string; occDate: string; isOccurrence: boolean; clientIds: string[] };
};
export type ActiveWorkout = SingleWorkout | GroupWorkout;

type Ctx = {
  active: ActiveWorkout | null;
  /** Возвращает false, если тренировка уже идёт — вторую поверх не открываем. */
  start: (w: ActiveWorkout) => boolean;
  stop: () => void;
};

const WorkoutCtx = createContext<Ctx>({ active: null, start: () => false, stop: () => {} });
// Идущая тренировка переживает перезагрузку страницы: введённое лежит в черновиках,
// а без этой записи после перезагрузки не было бы и самой тренировки, куда их вернуть.
const KEY = "th-active-workout-v1";

/**
 * Д3: активная тренировка живёт на уровне приложения.
 *
 * Раньше SessionModal рендерился внутри PlanEditor, а тот существует только пока
 * открыт экран плана. Тренер сворачивал тренировку, уходил в календарь — компонент
 * размонтировался, и свёрнутая плашка исчезала вместе с таймером. Черновик в
 * хранилище спасал введённые веса, но сам факт «идёт тренировка» терялся.
 *
 * Теперь состояние держит провайдер над всеми экранами, поэтому плашка переживает
 * любую навигацию и открывается откуда угодно. Совместная тренировка — так же.
 */
export function ActiveWorkoutProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveWorkout | null>(() => readJson<ActiveWorkout | null>(KEY, null));
  // Проверяем через ref: обновление состояния не синхронное, и по нему нельзя
  // сразу ответить вызывающему, можно ли начинать.
  const ref = useRef<ActiveWorkout | null>(active);

  const start = useCallback((w: ActiveWorkout) => {
    if (ref.current) return false; // одна тренировка за раз
    ref.current = w;
    setActive(w);
    writeJson(KEY, w);
    return true;
  }, []);

  const stop = useCallback(() => { ref.current = null; setActive(null); removeKey(KEY); }, []);
  const value = useMemo(() => ({ active, start, stop }), [active, start, stop]);
  return <WorkoutCtx.Provider value={value}>{children}</WorkoutCtx.Provider>;
}

export const useActiveWorkout = () => useContext(WorkoutCtx);
