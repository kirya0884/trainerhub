export const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const GOALS = ["Похудение", "Набор массы", "Поддержание", "Сила", "Реабилитация"];
export const CLIENT_COLORS = ["#a3e635", "#22d3ee", "#fb923c", "#f472b6", "#c084fc", "#facc15"];
export const GROUP_COLORS: Record<string, string> = { A: "#a3e635", B: "#22d3ee", C: "#fb923c", D: "#c084fc", E: "#f472b6" };
export const GROUP_CYCLE = ["", "A", "B", "C", "D", "E"];

export const BODY_METRICS = [
  { key: "weight", label: "Вес", unit: "кг", color: "#a3e635" },
  { key: "neck", label: "Шея", unit: "см", color: "#22d3ee" },
  { key: "shoulders", label: "Плечи", unit: "см", color: "#fb923c" },
  { key: "chest", label: "Грудь", unit: "см", color: "#f472b6" },
  { key: "waist", label: "Талия", unit: "см", color: "#c084fc" },
  { key: "glutes", label: "Ягодицы", unit: "см", color: "#facc15" },
  { key: "thigh", label: "Бедро", unit: "см", color: "#22d3ee" },
  { key: "biceps", label: "Бицепс", unit: "см", color: "#fb923c" },
  { key: "bodyfat", label: "% жира", unit: "%", color: "#f472b6" },
  { key: "muscleMass", label: "Мышцы", unit: "кг", color: "#a3e635" },
] as const;

export const EXERCISE_METRICS = [
  { key: "weight", label: "Вес", unit: "кг", color: "#a3e635" },
  { key: "reps", label: "Повторы", unit: "", color: "#22d3ee" },
  { key: "tonnage", label: "Тоннаж", unit: "кг", color: "#f59e0b" },
  { key: "rest", label: "Отдых", unit: "с", color: "#fb923c" },
  { key: "sets", label: "Подходы", unit: "", color: "#c084fc" },
] as const;

export const MOOD_EMOJI = ["😣", "😕", "😐", "🙂", "😄"];
export const WELL_EMOJI = ["🥵", "😮‍💨", "😐", "💪", "⚡"];
