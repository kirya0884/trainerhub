import type { Session } from "../types";
import { isFact, tonnageOf } from "./sessionUtils";

// Этап 12: экран-итог после тренировки (вместо короткого сообщения). Рисует WorkoutDone,
// подключённый в main.tsx рядом с DialogHost.

export type DoneStats = { title: string; sub: string; sets: number; tonnage: number; exercises: number; total: number; accent?: string };
let current: DoneStats | null = null;
const listeners = new Set<(s: DoneStats | null) => void>();
const emit = () => listeners.forEach((l) => l(current));

export function subscribeCelebrate(l: (s: DoneStats | null) => void) {
  listeners.add(l); l(current);
  return () => { listeners.delete(l); };
}
export function celebrate(s: DoneStats) { current = s; emit(); }
export function closeCelebrate() { current = null; emit(); }

/** Подходы (отмеченные), тоннаж и упражнения из записанной тренировки */
export function statsOf(session: Omit<Session, "id">) {
  const items = session.items ?? [];
  const sets = items.reduce((n, it) => n + (it.actualSets ?? []).filter(isFact).length, 0);
  const tonnage = Math.round(items.reduce((t, it) => t + tonnageOf((it.actualSets ?? []).filter(isFact)), 0));
  return { sets, tonnage, exercises: session.done ?? 0, total: session.total ?? items.length };
}
