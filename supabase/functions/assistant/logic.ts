// Логика помощника без сети и базы: схема ответа модели, текст задания, разбор дат,
// поиск клиента по имени и очистка ответа. Отдельно от index.ts, чтобы проверять тестами.

export type DateSpec = {
  type: "today" | "tomorrow" | "day_after_tomorrow" | "weekday" | "date" | "in_days" | "none";
  weekday?: number;
  nextWeek?: boolean;
  day?: number;
  month?: number;
  year?: number;
  days?: number;
};

export type ModelExercise = { name?: string; sets?: number; reps?: string; weight?: string; duration?: string; note?: string };

export type ModelCommand = {
  action?: string;
  reply?: string;
  clientMention?: string;
  clientNames?: string[];
  date?: DateSpec;
  time?: string;
  dayName?: string;
  exercises?: ModelExercise[];
};

export type Exercise = { name: string; sets: number; reps: string; weight: string; duration: string; note: string; known: boolean };

export type ClientMatch = {
  status: "ok" | "ambiguous" | "not_found" | "none";
  mention: string;
  candidates: { id: string; name: string }[];
};

export type Command = {
  action: "create_workout" | "unknown";
  reply: string;
  client: ClientMatch;
  date: string | null;
  time: string;
  dayName: string;
  exercises: Exercise[];
};

// Образец ответа для YandexGPT (режим jsonObject). Строгая схема (jsonSchema) у Яндекса требует
// все поля обязательными и заметно путает упражнения — образец в подсказке разбирает точнее.
// Дату модель не вычисляет, а описывает словами-кодами: «в четверг» → weekday 4. Считаем сами —
// языковые модели путают дни недели.
export const COMMAND_TEMPLATE = JSON.stringify({
  action: "create_workout", reply: "", clientMention: "", clientNames: [],
  date: { type: "none", weekday: 0, nextWeek: false, day: 0, month: 0, year: 0, days: 0 },
  time: "", dayName: "",
  exercises: [{ name: "", sets: 0, reps: "", weight: "", duration: "", note: "" }],
});

const WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export const MAX_COMMAND_CHARS = 2000;

// Лимиты запросов по тарифам (reps-redesign/assistant-limits.html). Тариф — действующая подписка
// тренера (my_subscription: выдана из админки или оплачена); нет подписки — «Старт».
export const PLAN_LIMITS = {
  start: { month: 15, day: 3 },
  basic: { month: 100, day: 20 },
  pro: { month: 200, day: 40 },
  studio: { month: 350, day: 60 },
} as const;
export type PlanTier = keyof typeof PLAN_LIMITS;
export const planTier = (t: unknown): PlanTier => (typeof t === "string" && Object.hasOwn(PLAN_LIMITS, t) ? t as PlanTier : "start");
export type Usage = { used: number; limit: number; dayUsed: number; dayLimit: number; resetsOn: string };

// Месяц — календарный: с 1-го числа по московскому дню. resetsOn — когда лимит обновится.
export function usageWindow(day: string): { monthStart: string; resetsOn: string } {
  const [y, m] = day.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { monthStart: `${day.slice(0, 7)}-01`, resetsOn: next };
}

/** Сколько использовано за месяц и за день по строкам assistant_usage (день → число) */
export function countUsage(rows: { day: string; count: number }[], day: string, limits: { month: number; day: number }): Usage {
  const { monthStart, resetsOn } = usageWindow(day);
  let used = 0, dayUsed = 0;
  for (const r of rows) {
    if (r.day < monthStart || r.day > day) continue;
    used += r.count;
    if (r.day === day) dayUsed = r.count;
  }
  return { used, limit: limits.month, dayUsed, dayLimit: limits.day, resetsOn };
}
export const MAX_KNOWN_EXERCISES = 300;

// Сегодняшняя дата в часовом поясе тренера: "2026-11-11"
export function todayIn(tz: string, now: Date = new Date()): string {
  let zone = "Europe/Moscow";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    zone = tz;
  } catch { /* неизвестный пояс — Москва */ }
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const toUTC = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUTC = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
};
// 1 — понедельник … 7 — воскресенье
const weekdayOf = (iso: string) => ((toUTC(iso).getUTCDay() + 6) % 7) + 1;

export function commandPrompt(today: string, known: string[]): string {
  const [y, m, d] = today.split("-");
  return [
    "Ты разбираешь команды персонального тренера в приложении Reps. Тренер пишет или диктует голосом, кому и на какую дату создать тренировку и какие упражнения в неё добавить.",
    `Сегодня ${WEEKDAYS[weekdayOf(today) - 1]}, ${d}.${m}.${y}.`,
    "Правила:",
    "- action = create_workout, если просят создать или добавить тренировку либо упражнения клиенту. Иначе action = unknown, а в reply одной фразой скажи, что умеешь создавать тренировки клиентам.",
    "- clientMention — как клиент назван в тексте, дословно. clientNames — его имя (и фамилия, если названа) в именительном падеже; если имя уменьшительное, добавь и полную форму: «Ане» → [\"Аня\", \"Анна\"]. Клиент не назван — пустые значения.",
    "- date.type: today, tomorrow, day_after_tomorrow; weekday — день недели в weekday (1 — понедельник … 7 — воскресенье), nextWeek = true, если сказано «на следующей неделе»; date — число в day и месяц в month, year только если год назван; in_days — «через N дней» в days; none — дата не названа. Сам дату не вычисляй.",
    "- time — время начала в формате ЧЧ:ММ, 24 часа: «в шесть вечера» → 18:00. Не названо — пусто.",
    "- dayName — название тренировки, только если его назвали («назови Грудь и ноги»). Иначе пусто.",
    "- exercises — в порядке упоминания. «4 по 8», «4 на 8», «4х8» → sets 4, reps \"8\". Вес в килограммах числом в weight: «сто килограмм» → \"100\". Упражнения на время: «планка 3 по минуте» → sets 3, duration \"1 мин\". Числа словами пиши цифрами. Название упражнения пиши полностью, с заглавной буквы, без сокращений.",
    "- Если упражнение — одно из известных упражнений тренера ниже, бери название из списка дословно.",
    "- Ничего не выдумывай: чего нет в тексте, оставь пустым или 0.",
    known.length ? `Известные упражнения тренера: ${known.join("; ")}.` : "Известных упражнений у тренера пока нет.",
    `Ответь только JSON такого вида: ${COMMAND_TEMPLATE}`,
  ].join("\n");
}

export function resolveDate(spec: DateSpec | undefined, today: string): string | null {
  if (!spec || typeof spec !== "object") return null;
  switch (spec.type) {
    case "today": return today;
    case "tomorrow": return addDays(today, 1);
    case "day_after_tomorrow": return addDays(today, 2);
    case "in_days": {
      const n = Number(spec.days);
      return Number.isInteger(n) && n >= 0 && n <= 366 ? addDays(today, n) : null;
    }
    case "weekday": {
      const w = Number(spec.weekday);
      if (!Number.isInteger(w) || w < 1 || w > 7) return null;
      const cur = weekdayOf(today);
      if (spec.nextWeek) return addDays(today, 7 - cur + w); // понедельник следующей недели + (w − 1)
      return addDays(today, (w - cur + 7) % 7); // ближайший такой день, сегодня — если совпал
    }
    case "date": {
      const day = Number(spec.day), month = Number(spec.month);
      if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) return null;
      const curYear = Number(today.slice(0, 4));
      let year = Number.isInteger(Number(spec.year)) && Number(spec.year) > 2000 ? Number(spec.year) : curYear;
      const make = (yy: number) => {
        const d = new Date(Date.UTC(yy, month - 1, day));
        return d.getUTCMonth() === month - 1 ? fromUTC(d) : null; // 31 ноября → null
      };
      let iso = make(year);
      // Год не назван и дата давно прошла — это следующий год («5 января», сказанное в ноябре)
      if (iso && !spec.year && toUTC(iso) < toUTC(addDays(today, -60))) iso = make(++year);
      return iso;
    }
    default: return null;
  }
}

export const normName = (s: string) =>
  s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();

const stem = (w: string) => (w.length >= 5 ? w.slice(0, -2) : w.length === 4 ? w.slice(0, -1) : w);

// Слово из команды похоже на слово из имени клиента с учётом падежей: «Анне» ~ «Анна», «Котовой» ~ «Котова»
function wordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const sa = stem(a), sb = stem(b);
  if (Math.min(sa.length, sb.length) < 3) return false;
  return sa.startsWith(sb) || sb.startsWith(sa);
}

// Ищем клиента у тренера. Список клиентов в Яндекс не уходит — сравнение здесь, на сервере.
export function matchClient(mention: string, names: string[], clients: { id: string; name: string }[]): ClientMatch {
  const forms = [...names, mention].map(normName).filter(Boolean);
  const m = (mention || names[0] || "").trim();
  if (!forms.length) return { status: "none", mention: "", candidates: [] };
  const exact: typeof clients = [];
  const loose: typeof clients = [];
  for (const c of clients) {
    const cw = normName(c.name).split(" ").filter(Boolean);
    const fits = (form: string, eq: boolean) =>
      form.split(" ").every((w) => cw.some((x) => (eq ? x === w : wordMatch(w, x))));
    if (forms.some((f) => fits(f, true))) exact.push(c);
    else if (forms.some((f) => fits(f, false))) loose.push(c);
  }
  // Одно точное совпадение важнее похожих: «Анна» → «Анна Котова», а не «Анжела»
  const found = exact.length === 1 ? exact : [...exact, ...loose];
  if (!found.length) return { status: "not_found", mention: m, candidates: [] };
  const candidates = found.slice(0, 5).map(({ id, name }) => ({ id, name }));
  return { status: found.length === 1 ? "ok" : "ambiguous", mention: m, candidates };
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normTime(t: unknown): string {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(clip(t, 5));
  if (!m) return "";
  const h = Number(m[1]), min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, "0")}:${m[2]}` : "";
}

export function defaultDayName(date: string | null): string {
  if (!date) return "Тренировка";
  const [, m, d] = date.split("-").map(Number);
  return `Тренировка ${d} ${MONTHS_SHORT[m - 1]}`;
}

// Самые частые названия упражнений тренера — для подсказки модели (не больше max)
export function topNames(names: string[], max = MAX_KNOWN_EXERCISES): string[] {
  const count = new Map<string, { name: string; n: number }>();
  for (const raw of names) {
    const name = clip(raw, 80);
    const k = normName(name);
    if (!k) continue;
    const cur = count.get(k);
    if (cur) cur.n++;
    else count.set(k, { name, n: 1 });
  }
  return [...count.values()].sort((a, b) => b.n - a.n).slice(0, max).map((x) => x.name);
}

// Ответ модели → то, что увидит тренер. Всё лишнее отбрасываем, длины и числа ограничиваем.
export function buildCommand(raw: ModelCommand, today: string, clients: { id: string; name: string }[], known: string[]): Command {
  const knownSet = new Set(known.map(normName));
  const exercises: Exercise[] = (Array.isArray(raw?.exercises) ? raw.exercises : [])
    .slice(0, 30)
    .map((e) => {
      const name = clip(e?.name, 80);
      const sets = Number.isInteger(e?.sets) && (e.sets as number) > 0 && (e.sets as number) <= 30 ? (e.sets as number) : 0;
      return {
        name: name ? name[0].toUpperCase() + name.slice(1) : "",
        sets,
        reps: clip(e?.reps, 20),
        weight: clip(e?.weight, 20).replace(",", "."),
        duration: clip(e?.duration, 20),
        note: clip(e?.note, 200),
        known: knownSet.has(normName(name)),
      };
    })
    .filter((e) => e.name);
  const action = raw?.action === "create_workout" ? "create_workout" : "unknown";
  const names = (Array.isArray(raw?.clientNames) ? raw.clientNames : []).map((n) => clip(n, 60)).filter(Boolean).slice(0, 4);
  const date = resolveDate(raw?.date, today);
  return {
    action,
    reply: action === "unknown" ? clip(raw?.reply, 300) || "Я умею создавать тренировки клиентам. Скажи, кому, на какой день и какие упражнения." : "",
    client: matchClient(clip(raw?.clientMention, 60), names, clients),
    date,
    time: normTime(raw?.time),
    dayName: clip(raw?.dayName, 60) || defaultDayName(date),
    exercises,
  };
}

// Модель иногда оборачивает JSON в ``` — снимаем обёртку перед разбором
export function parseModelJson(text: string): ModelCommand | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
