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
  exercises: Exercise[];
}

export interface Plan {
  id: string;
  name: string;
  note: string;
  days: Day[];
}

export interface ProgressNote { id: string; date: string; text: string }
export interface Metric { id: string; date: string; exercise: string; weight: string; reps: string; rest: string; sets: string }
export interface SessionItem { name: string; effort: number; rpe: number; note: string }
export interface Session {
  id: string; date: string; dayName: string; mood: number; wellbeing: number; clientRating: number;
  review: string; done: number; total: number; fromClient: boolean; items: SessionItem[];
}
