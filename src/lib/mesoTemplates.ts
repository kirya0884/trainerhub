import { parseNum } from "./format";
import type { Exercise } from "../types";

// Шаблоны прогрессий мезоцикла по документу агента-тренера
// CloudeCode/Агент-тренер/«Шаблоны прогрессий мезоциклов.md» (Ш1–Ш9; Ш4 — «Волна» в periodization.ts).
// Таблица шаблона — недели по порядку, weeks[0] — неделя 1 (её вводит тренер, она не меняется;
// у повторяющихся шаблонов weeks[0] описывает начало каждого следующего цикла).
// Общие правила (О1–О5 документа): нечисловой вес не трогаем, прибавку заменяет +1 повтор к верхней
// границе (не больше +4); лёгкие (< 20 кг) стоят весом внутри цикла и растут повторами; функциональные —
// только подходы и заметка; вес округляется по снаряду: от 40 кг — 2,5, от 20 — 1, легче — 0,5.

/** +n к верхней границе повторов: «10» → «11», «8-12» → «8-13». Другое («до отказа», «2×20») — как есть. */
export const addReps = (reps: string, n: number) => {
  const m = n ? reps.match(/^(\s*\d+\s*[-–—]\s*)?(\d+)(\s*)$/) : null;
  return m ? `${m[1] ?? ""}${Number(m[2]) + n}${m[3]}` : reps;
};

/** Сдвиг обеих границ: «10» → «12», «8-12» → «5-9»; не ниже min. Другое — как есть. */
export const shiftReps = (reps: string, n: number, min: number) => {
  const m = n ? reps.match(/^(\s*)(?:(\d+)(\s*[-–—]\s*))?(\d+)(\s*)$/) : null;
  if (!m) return reps;
  const hi = Math.max(min, Number(m[4]) + n);
  const lo = m[2] != null ? Math.min(hi, Math.max(min, Number(m[2]) + n)) : null;
  return lo != null && lo !== hi ? `${m[1]}${lo}${m[3]}${hi}${m[5]}` : `${m[1]}${hi}${m[5]}`;
};

export const DELOAD_NOTE = "разгрузка, 4+ повтора в запасе";
/** Двойная прогрессия: повторы растут не больше чем на +4 к исходной верхней границе */
export const MAX_REPS_BONUS = 4;

/** Повторы недели: both — сдвиг обеих границ, top — верхней, target — ступень диапазона L…H
 *  (0 — L, 1 — L+⌈S/3⌉, 2 — L+⌈2S/3⌉, 3 — H; одно число N читается как N…N+4). */
type RepsRule = { both?: number; top?: number; target?: 0 | 1 | 2 | 3; min?: number };
interface WeekSpec {
  tag?: string;
  mult: number;
  /** delta — ±подходы (ifAtMost — только если исходных не больше), mult — умножить; не ниже min (по умолчанию 1) */
  sets?: { delta?: number; mult?: number; min?: number; ifAtMost?: number };
  reps?: RepsRule;
  note: string;
  deload?: boolean;
  /** Повторы, если веса нет или он не число: "keep" — не трогать; правило — вместо общего О1 */
  noWeight?: RepsRule | "keep";
  /** Дописать в заметку, если веса нет */
  noWeightNote?: string;
}
export interface MesoTemplate {
  id: string;
  label: string;
  hint: string;
  weeks: WeekSpec[];
  /** Множитель цикла b (0, 1, …) у повторяющихся шаблонов; без него длина шаблона фиксирована */
  repeat?: (b: number) => number;
  cap?: number;
}

const DELOAD: WeekSpec = { tag: "разгрузка", mult: 0.9, sets: { mult: 0.5 }, note: DELOAD_NOTE, deload: true };
const W1: WeekSpec = { mult: 1, note: "" };
const RIR6 = "(±2% веса за каждые 0,5 RPE мимо цели)";

export const MESO_TEMPLATES: MesoTemplate[] = [
  {
    id: "novice", label: "Новичок: вес каждую неделю (6 нед.)",
    hint: "Первые 3–6 месяцев силовых, техника стабильна. Вес +2,5% в неделю, запас повторов от 3 до 1–2, плановой разгрузки нет. Неделя 1 — с запасом 3–4 повтора.",
    weeks: [W1,
      { mult: 1.025, note: "RIR 3" },
      { mult: 1.05, note: "RIR 2–3" },
      { mult: 1.075, note: "RIR 2" },
      { mult: 1.1, note: "RIR 1–2" },
      { mult: 1.125, note: "RIR 1–2; 2 тренировки подряд не сделаны все повторы — вес −10% и снова вверх" }],
  },
  {
    id: "double", label: "Двойная прогрессия: повторы, потом вес",
    hint: "Масса; изоляция, тренажёры, гантели. Цикл 4 недели: повторы от низа диапазона к верху, потом вес +5% и снова от низа. Одно число повторов N читается как диапазон N…N+4. Неделя 1 — с запасом 2–3 повтора.",
    weeks: [
      { mult: 1, reps: { target: 0 }, note: "новый вес, низ диапазона, RIR 2–3", noWeightNote: "добавь подход или усложни упражнение" },
      { mult: 1, reps: { target: 1 }, note: "RIR 2" },
      { mult: 1, reps: { target: 2 }, note: "RIR 1–2" },
      { mult: 1, reps: { target: 3 }, note: "RIR 1–2; верх сделан во всех подходах — дальше вес вверх" }],
    repeat: (b) => 1.05 ** b,
    cap: 1.1,
  },
  {
    id: "volume", label: "Накопление объёма: масса (6 нед.)",
    hint: "Масса, средний уровень и выше, хорошее восстановление. Подходы +1, затем +2 (только у упражнений до 4 подходов), вес до +5%, запас от 3 до 0–1, 6-я неделя — разгрузка. Не для новичков и не на дефиците калорий.",
    weeks: [W1,
      { mult: 1, sets: { delta: 1, ifAtMost: 4 }, note: "RIR 2–3" },
      { mult: 1.025, sets: { delta: 1, ifAtMost: 4 }, note: "RIR 2" },
      { mult: 1.025, sets: { delta: 2, ifAtMost: 4 }, note: "RIR 1–2" },
      { mult: 1.05, sets: { delta: 2, ifAtMost: 4 }, note: "RIR 0–1" },
      DELOAD],
  },
  {
    id: "strength", label: "Сила: от объёма к интенсивности (6 нед.)",
    hint: "Рост максимума в базовых, средний уровень и выше, исходные повторы 6–10. Вес до +15% при меньшем числе повторов, 6-я неделя — разгрузка (или затем «Подводка»). Упражнения без веса не меняются, кроме разгрузки.",
    weeks: [W1,
      { mult: 1.025, note: "RIR 2", noWeight: "keep" },
      { mult: 1.075, reps: { both: -2, min: 2 }, note: "RIR 2", noWeight: "keep" },
      { mult: 1.1, reps: { both: -2, min: 2 }, note: "RIR 1–2", noWeight: "keep" },
      { mult: 1.15, sets: { delta: -1, min: 2 }, reps: { both: -4, min: 2 }, note: "RIR 1", noWeight: "keep" },
      DELOAD],
  },
  {
    id: "rir", label: "По самочувствию: вес под RIR (5 нед.)",
    hint: "Тренированным, кто умеет оценивать запас. Вес в плане — ориентир: клиент подбирает вес под целевой RIR, за каждые 0,5 RPE выше цели −2% на следующий подход, ниже — +2%. 5-я неделя — разгрузка. Не для новичков.",
    weeks: [W1,
      { mult: 1.025, note: `подбери вес на RIR 2 ${RIR6}`, noWeight: "keep" },
      { mult: 1.05, note: `подбери вес на RIR 1–2 ${RIR6}`, noWeight: "keep" },
      { mult: 1.075, note: `подбери вес на RIR 1 ${RIR6}`, noWeight: "keep" },
      DELOAD],
  },
  {
    id: "taper", label: "Подводка к старту или тесту 1ПМ (3 нед.)",
    hint: "После силового блока, перед соревнованием или тестом. Неделя 1 — последняя обычная тяжёлая. Дальше подходов меньше (×0,6, затем ×0,5), вес не растёт, повторов чуть меньше. Последние 2–3 дня до старта — без тренировок.",
    weeks: [W1,
      { tag: "подводка", mult: 1, sets: { mult: 0.6 }, reps: { both: -1, min: 1 }, note: "подводка, RIR 2; присед и тяга тяжело — последний раз за 7–10 дней до старта" },
      { tag: "подводка", mult: 0.95, sets: { mult: 0.5 }, reps: { both: -2, min: 1 }, note: "подводка; жим тяжело не позже чем за 5–7 дней; 2–3 дня до старта без тренировок" }],
  },
  {
    id: "return", label: "Возврат после перерыва (4 нед.)",
    hint: "После паузы 2+ недели. Неделю 1 введи на 70–85% прежних весов (чем дольше перерыв, тем ниже) и с запасом 4 повтора. Вес до +15%, но не выше прежних рабочих. После травмы — только с допуском врача.",
    weeks: [W1,
      { mult: 1.05, note: "RIR 3" },
      { mult: 1.1, sets: { delta: 1 }, note: "RIR 2–3" },
      { mult: 1.15, sets: { delta: 1 }, note: "RIR 2; не выше прежних рабочих весов" }],
  },
  {
    id: "maintain", label: "Поддержание (до 60 лет)",
    hint: "Сохранить силу и массу в загруженный период. Подходов втрое меньше, вес не снижается. Число тренировок в неделю сократи сам.",
    weeks: [{ tag: "поддержание", mult: 1, sets: { mult: 1 / 3 }, note: "поддержание: вес не снижать, RIR 1–2" }],
    repeat: () => 1,
  },
  {
    id: "maintain60", label: "Поддержание (60+)",
    hint: "Сохранить силу и массу у пожилых: им нужно больше объёма, чем молодым. Подходов на треть меньше, вес не снижается. Число тренировок в неделю сократи сам.",
    weeks: [{ tag: "поддержание", mult: 1, sets: { mult: 2 / 3 }, note: "поддержание: вес не снижать, RIR 1–2" }],
    repeat: () => 1,
  },
];

export const findTemplate = (id: string) => MESO_TEMPLATES.find((t) => t.id === id);

const specAt = (t: MesoTemplate, i: number) => {
  const L = t.weeks.length, b = Math.floor(i / L), spec = t.weeks[i % L];
  return { b, spec, mult: spec.deload ? spec.mult : spec.mult * (t.repeat?.(b) ?? 1) };
};

export function templateWeekLabel(t: MesoTemplate, i: number) {
  const { spec } = specAt(t, i);
  return spec.tag ? `Нед. ${i + 1} · ${spec.tag}` : `Нед. ${i + 1}`;
}

function applyReps(reps: string, r: RepsRule | undefined) {
  if (!r) return reps;
  if (r.target != null) {
    const m = reps.match(/^\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*$/);
    if (!m) return reps;
    const L = Number(m[1]), H = m[2] != null ? Math.max(L, Number(m[2])) : L + 4, S = H - L;
    return String([L, L + Math.ceil(S / 3), L + Math.ceil((2 * S) / 3), H][r.target]);
  }
  if (r.both) return shiftReps(reps, r.both, r.min ?? 1);
  if (r.top) return addReps(reps, r.top);
  return reps;
}

/** Шаг снаряда по исходному весу (О4 документа) */
const stepOf = (w0: number) => (w0 >= 40 ? 2.5 : w0 >= 20 ? 1 : 0.5);

/** Вес/повторы/подходы/заметка упражнения на неделях 2..weeks по шаблону */
export function progressByTemplate(ex: Pick<Exercise, "weight" | "reps" | "sets" | "kind" | "note">, weeks: number, t: MesoTemplate) {
  const functional = ex.kind === "functional";
  const w0 = !functional && /^\s*\d+(?:[.,]\d+)?\s*(?:кг)?\s*$/i.test(ex.weight) ? parseNum(ex.weight) : null;
  const light = w0 != null && w0 < 20;
  const step = w0 != null ? stepOf(w0) : 1;
  const round = (w: number) => Math.round(w / step) * step;
  const sets0 = parseInt(ex.sets, 10);
  const out: { weight: string; reps: string; sets: string; note: string }[] = [];
  let prevW = w0, prevMult = 1, blockW = w0, block = 0, bonus = 0;
  for (let i = 1; i < weeks; i++) {
    const { b, spec, mult } = specAt(t, i);
    const s = spec.sets;
    let sets = ex.sets;
    if (Number.isFinite(sets0) && s) {
      if (s.mult != null) sets = String(Math.max(s.min ?? 1, Math.round(sets0 * s.mult)));
      else if (s.delta && (s.ifAtMost == null || sets0 <= s.ifAtMost)) sets = String(Math.max(s.min ?? 1, sets0 + s.delta));
    }
    const grows = !spec.deload && mult > prevMult + 1e-9;
    let w = w0, reps = ex.reps;
    if (!functional) {
      const target = spec.reps?.target != null;
      if (w0 == null) {
        if (spec.noWeight === "keep") reps = ex.reps;
        else if (spec.noWeight) reps = applyReps(ex.reps, spec.noWeight);
        else if (target) reps = applyReps(ex.reps, spec.reps);
        else {
          if (grows) bonus = Math.min(MAX_REPS_BONUS, bonus + 1);
          reps = addReps(ex.reps, bonus);
        }
      } else if (spec.deload) {
        const d = w0 * mult;
        w = d < 20 ? Math.floor(d) : round(d);
        reps = addReps(ex.reps, target ? 0 : bonus);
      } else if (light) {
        // Новый цикл повторяющегося шаблона — шаг весом, повторы к исходным; внутри цикла вес стоит
        if (b > block) {
          block = b;
          const stepW = round(w0 * Math.min(t.repeat?.(b) ?? 1, t.cap ?? Infinity));
          if (stepW > blockW!) { blockW = stepW; bonus = 0; }
        }
        w = blockW;
        if (target) reps = applyReps(ex.reps, spec.reps);
        else {
          if (grows) bonus = Math.min(MAX_REPS_BONUS, bonus + 1);
          reps = addReps(ex.reps, bonus);
        }
      } else {
        const capped = t.cap != null && mult > t.cap;
        const m = capped ? t.cap! : mult;
        w = Math.abs(m - 1) < 1e-9 ? w0 : round(w0 * m); // неделя без прибавки — вес как ввёл тренер
        if (target) reps = applyReps(ex.reps, spec.reps);
        else {
          // Вес упёрся в потолок или не вырос после округления — вместо него +1 повтор
          if (grows && (capped || w <= prevW!)) bonus = Math.min(MAX_REPS_BONUS, bonus + 1);
          reps = addReps(applyReps(ex.reps, spec.reps), bonus);
        }
      }
    }
    if (!spec.deload) { prevMult = mult; prevW = w; }
    const notes = [ex.note, spec.note, w0 == null && !functional ? spec.noWeightNote : ""];
    out.push({
      weight: w != null ? String(w).replace(".", ",") : ex.weight,
      reps,
      sets,
      note: notes.filter(Boolean).join(" · "),
    });
  }
  return out;
}
