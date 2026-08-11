export interface SetRow {
  id: string;
  weight: string;
  reps: string;
}

export interface Exercise {
  id: string;
  name: string;
  sets: string;
  reps: string;
  weight: string;
  rest: string;
  note: string;
  video: string;
  detailed: boolean;
  group: string;
  tempo: string;
  duration: string;
  target: string;
  setRows: SetRow[];
  kind: string;      // "" — обычное, "functional" — функциональное (время/пульс вместо подходов)
  pulseZone: string; // пульсовая зона для функциональных, напр. "Z2 (120-140)"
}

export interface Day {
  /** П3: день ушёл в «Проведённые». null — обычный день в списке тренировок. */
  archivedAt?: string | null;
  id: string;
  name: string;
  weekday: number | null;
  dateOf?: string | null;
  exercises: Exercise[];
  visibleToClient?: boolean;
  mesocycleId?: string | null;
  method?: string; // "" — обычная, "circuit" — круговая (подходы кругами по всем упражнениям)
}

export interface Plan {
  id: string;
  name: string;
  note: string;
  days: Day[];
  visibleToClient?: boolean;
  mesocycles?: Mesocycle[];
}

export interface Mesocycle {
  id: string;
  planId: string;
  name: string;
  position: number;
  visibleToClient?: boolean;
  /** Р2: блок убран в архив вместе со своими днями. */
  archivedAt?: string | null;
}

export interface ProgressNote { id: string; date: string; text: string }
export interface Metric { id: string; date: string; exercise: string; weight: string; reps: string; rest: string; sets: string }
export interface SessionItem { name: string; effort: number; rpe: number; note: string; actualSets?: Array<{weight: string; reps: string}>; plannedSets?: Array<{weight: string; reps: string}>; plannedSummary?: string }
export interface Session {
  id: string; date: string; dayName: string; mood: number; wellbeing: number; clientRating: number;
  review: string; done: number; total: number; fromClient: boolean; items: SessionItem[];
  /** П3: связь с днём плана по id. У сессий до миграции пусто — связь была только по имени. */
  dayId?: string | null;
}
