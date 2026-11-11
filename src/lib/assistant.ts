import { supabase } from "./supabase";
import { addPlan } from "./clients";
import { addBooking } from "./bookings";
import { readJson, writeJson } from "./storage";

// Помощник тренера (этап 2): команды текстом. Сервер (функция assistant) только разбирает
// команду; создаёт тренировку приложение — после «Создать» в карточке, теми же запросами
// и под теми же правами, что и ручное «Добавить день» в плане.

export type AExercise = { name: string; sets: number; reps: string; weight: string; duration: string; note: string; known: boolean };
export type AClientMatch = { status: "ok" | "ambiguous" | "not_found" | "none"; mention: string; candidates: { id: string; name: string }[] };
/** Ответ сервера — разобранная команда */
export type ACommand = {
  action: "create_workout" | "unknown";
  reply: string;
  client: AClientMatch;
  date: string | null;
  time: string;
  dayName: string;
  exercises: AExercise[];
};
export type AUsage = { used: number; limit: number };

export class AssistantError extends Error {
  constructor(message: string, readonly code: "not_connected" | "limit" | "server" | "network") { super(message); }
}

// Подключён ли помощник (на сервере есть ключ Яндекса). Пока нет — функция «в разработке»:
// кнопки с пометкой, экран с объяснением. Ответ запоминаем на телефоне, чтобы пометка на
// «Главной» не требовала запроса при каждом открытии; обновляется при входе в помощника.
const CONNECTED_KEY = "reps-assistant-connected";
export const assistantConnectedCached = () => readJson<boolean>(CONNECTED_KEY, false) === true;
export async function assistantStatus(): Promise<boolean | null> {
  const { data: { session } } = await supabase.auth.getSession();
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ mode: "status" }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data?.connected !== "boolean") return null;
    writeJson(CONNECTED_KEY, data.connected);
    return data.connected;
  } catch (e) {
    console.warn("[assistant] status:", e);
    return null; // нет сети — не знаем; экран решит по сохранённому
  }
}

/** Разобрать команду. previous — прошлая команда и её разбор: тогда text — поправка к ней */
export async function askAssistant(text: string, previous?: { text: string; result: ACommand }): Promise<{ result: ACommand; usage: AUsage }> {
  const { data: { session } } = await supabase.auth.getSession();
  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ mode: "command", text, previous, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    console.warn("[assistant] fetch:", e);
    throw new AssistantError("Нет связи с сервером. Проверь интернет и попробуй ещё раз", "network");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 503) throw new AssistantError("Помощник ещё не подключён", "not_connected");
  if (res.status === 429) throw new AssistantError("На сегодня разборы закончились. Завтра лимит обновится", "limit");
  if (!res.ok || !data?.result) throw new AssistantError(data?.error || "Помощник сейчас недоступен, попробуй через минуту", "server");
  return { result: data.result as ACommand, usage: data.usage as AUsage };
}

/** То, что тренер подтвердил в карточке */
export type WorkoutDraft = {
  clientId: string;
  /** "" — создать новый план «Тренировки» */
  planId: string;
  /** Дописать упражнения в уже существующий день на эту дату вместо нового дня */
  appendToDayId: string;
  date: string;
  dayName: string;
  /** "" — без записи в календарь */
  time: string;
  exercises: AExercise[];
};
export type CreatedWorkout = { planId: string; dayId: string; createdPlan: boolean; createdDay: boolean; exerciseIds: string[]; bookingId: string };

/** День плана на эту дату у клиента: помощник предложит дописать в него, а не плодить второй */
export async function findDayOnDate(planIds: string[], date: string): Promise<{ id: string; name: string; planId: string } | null> {
  if (!planIds.length) return null;
  const { data, error } = await supabase.from("plan_days").select("id,name,plan_id").in("plan_id", planIds).eq("date_of", date).is("archived_at", null).limit(1);
  if (error) throw error;
  const d = data?.[0];
  return d ? { id: d.id, name: d.name, planId: d.plan_id } : null;
}

// Упражнение помощника → строка plan_exercises. «Планка 3 по минуте» — подходы × время;
// «бег 20 мин» без подходов — функциональное упражнение со временем, как в редакторе плана.
export function exerciseRow(e: AExercise, dayId: string, position: number) {
  const timed = !e.sets && !e.reps && !!e.duration;
  return {
    day_id: dayId, position, name: e.name, detailed: false, rest: "", note: e.note,
    sets: e.sets ? String(e.sets) : "",
    reps: e.reps || (e.sets && e.duration ? e.duration : ""),
    weight: e.weight,
    duration: timed ? e.duration : "",
    kind: timed ? "functional" : "",
    pulse_zone: "",
  };
}

/**
 * Создать тренировку по карточке. Транзакций из браузера нет, поэтому при сбое на середине
 * удаляем всё, что успели создать: полдня с половиной упражнений хуже, чем «не получилось».
 */
export async function createWorkout(trainerId: string, d: WorkoutDraft): Promise<CreatedWorkout> {
  const made: CreatedWorkout = { planId: d.planId, dayId: d.appendToDayId, createdPlan: false, createdDay: false, exerciseIds: [], bookingId: "" };
  try {
    if (!made.planId) {
      const plan = await addPlan(trainerId, d.clientId, "Тренировки");
      made.planId = plan.id;
      made.createdPlan = true;
    }
    let position = 0;
    if (made.dayId) {
      const { count, error } = await supabase.from("plan_exercises").select("id", { count: "exact", head: true }).eq("day_id", made.dayId);
      if (error) throw error;
      position = count ?? 0;
    } else {
      const { count, error } = await supabase.from("plan_days").select("id", { count: "exact", head: true }).eq("plan_id", made.planId);
      if (error) throw error;
      const { data, error: dayErr } = await supabase.from("plan_days")
        .insert({ plan_id: made.planId, name: d.dayName, position: count ?? 0, date_of: d.date })
        .select("id").single();
      if (dayErr) throw dayErr;
      made.dayId = data.id;
      made.createdDay = true;
    }
    if (d.exercises.length) {
      const { data, error } = await supabase.from("plan_exercises")
        .insert(d.exercises.map((e, i) => exerciseRow(e, made.dayId, position + i))).select("id");
      if (error) throw error;
      made.exerciseIds = (data ?? []).map((r) => r.id);
    }
    if (d.time) {
      made.bookingId = await addBooking(trainerId, {
        planId: made.planId, dayId: made.dayId, dayName: d.dayName, date: d.date, time: d.time, duration: 60,
        status: "scheduled", note: "", recurring: false, recurUntil: null, exceptions: {},
      }, [d.clientId]);
    }
    return made;
  } catch (e) {
    await undoWorkout(made).catch((u) => console.error("[assistant] откат:", u));
    throw e;
  }
}

/** «Отменить»: убрать запись, новый день (упражнения уйдут каскадом) или дописанные упражнения, новый план */
export async function undoWorkout(w: CreatedWorkout) {
  if (w.bookingId) {
    const { error } = await supabase.from("bookings").delete().eq("id", w.bookingId);
    if (error) throw error;
  }
  if (w.createdPlan && w.planId) {
    const { error } = await supabase.from("plans").delete().eq("id", w.planId);
    if (error) throw error;
  } else if (w.createdDay && w.dayId) {
    const { error } = await supabase.from("plan_days").delete().eq("id", w.dayId);
    if (error) throw error;
  } else if (w.exerciseIds.length) {
    const { error } = await supabase.from("plan_exercises").delete().in("id", w.exerciseIds);
    if (error) throw error;
  }
}

/** Текущий план клиента: самый новый действующий видимый, иначе самый новый действующий */
export function currentPlanId(plans: { id: string; clientId: string; archived: boolean; visibleToClient?: boolean }[], clientId: string): string {
  const mine = plans.filter((p) => p.clientId === clientId && !p.archived);
  return (mine.find((p) => p.visibleToClient !== false) ?? mine[0])?.id ?? "";
}

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
/** «Чт, 12 ноября» */
export function fmtDayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  return `${wd[0].toUpperCase()}${wd.slice(1)}, ${d} ${MONTHS[m - 1]}`;
}

/** «4 × 8 · 100 кг» */
export function fmtExercise(e: AExercise): string {
  const timed = !e.sets && !e.reps && e.duration;
  const main = timed ? e.duration : e.sets ? `${e.sets} × ${e.reps || e.duration || "—"}` : e.reps;
  return [main, e.weight ? `${e.weight} кг` : ""].filter(Boolean).join(" · ");
}
