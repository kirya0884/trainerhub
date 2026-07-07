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
}

export interface Day {
  id: string;
  name: string;
  weekday: number | null;
  dateOf?: string | null;
  exercises: Exercise[];
  visibleToClient?: boolean;
  mesocycleId?: string | null;
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
}

export interface ProgressNote { id: string; date: string; text: string }
export interface Metric { id: string; date: string; exercise: string; weight: string; reps: string; rest: string; sets: string }
export interface SessionItem { name: string; effort: number; rpe: number; note: string; actualSets?: Array<{weight: string; reps: string}>; plannedSummary?: string }
export interface Session {
  id: string; date: string; dayName: string; mood: number; wellbeing: number; clientRating: number;
  review: string; done: number; total: number; fromClient: boolean; items: SessionItem[];
}
