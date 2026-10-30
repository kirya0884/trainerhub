import { supabase } from "./supabase";
import { parseNum } from "./format";
import type { Day, Exercise } from "../types";

// Схема не хранится (выбирается в окне генератора), поэтому прежняя «Линейная + разгрузка»
// просто слилась с «Линейной» — разгрузка каждую 4-ю неделю теперь есть в обеих схемах.
export type MesoScheme = "linear" | "wave";
export const MESO_SCHEMES: { value: MesoScheme; label: string }[] = [
  { value: "linear", label: "Линейная: +2,5% в неделю, 4-я — разгрузка" },
  { value: "wave", label: "Волна: база → объём → интенсивность → разгрузка" },
];

/** Потолок: вес не выше +10% к весу из плана — дальше растут повторы */
const CAP = 1.1;

/** Неделя i (0 — введённый план, не меняется). Блоки по 4 недели: k — место в блоке,
 *  B — сдвиг блока (+2,5% за каждый пройденный блок); 4-я неделя блока — разгрузка. */
export function weekModifier(i: number, scheme: MesoScheme): { weightMult: number; setsDelta: number; deload: boolean; label: string } {
  const b = Math.floor(i / 4), k = i % 4, B = 1 + 0.025 * b;
  if (k === 3) return { weightMult: 0.9, setsDelta: 0, deload: true, label: `Нед. ${i + 1} · разгрузка` };
  if (scheme === "wave") {
    if (k === 1) return { weightMult: 0.95 * B, setsDelta: 1, deload: false, label: `Нед. ${i + 1} · объём` };
    if (k === 2) return { weightMult: 1.075 * B, setsDelta: -1, deload: false, label: `Нед. ${i + 1} · интенсивность` };
    return { weightMult: B, setsDelta: 0, deload: false, label: `Нед. ${i + 1} · база` };
  }
  return { weightMult: B * (1 + 0.025 * k), setsDelta: 0, deload: false, label: `Нед. ${i + 1}` };
}

/** +n к верхней границе повторов: «10» → «11», «8-12» → «8-13». Другое («до отказа», «2×20») — как есть. */
const addReps = (reps: string, n: number) => {
  const m = n ? reps.match(/^(\s*\d+\s*[-–—]\s*)?(\d+)(\s*)$/) : null;
  return m ? `${m[1] ?? ""}${Number(m[2]) + n}${m[3]}` : reps;
};

const DELOAD_NOTE = "разгрузка, 4+ повтора в запасе";
/** Двойная прогрессия: повторы растут не больше чем на +4 к исходной верхней границе */
const MAX_REPS_BONUS = 4;

/**
 * Вес/повторы/подходы/заметка одного упражнения на неделях 2..weeks (индексы 1..weeks-1).
 * Недели считаются подряд, потому что двойная прогрессия копится: если вес упёрся в потолок,
 * округлённый вес не вырос против прошлой рабочей недели или вес не простое число (пусто,
 * «-20» гравитрон, «40-50», «2×20») — вместо веса +1 повтор к верхней границе (не больше +4).
 * Лёгкий вес (< 20 кг): внутри блока вес стоит, растут повторы; с новым блоком (после
 * разгрузки) вес делает шаг (+2,5% за блок, до потолка), а повторы возвращаются к исходным —
 * если шаг по округлению не получился, повторы не сбрасываются.
 * Функциональные: вес и повторы не трогаем, только подходы по схеме.
 * Вес пишется с запятой, как его вводят («62,5»).
 */
export function progressExercise(ex: Pick<Exercise, "weight" | "reps" | "sets" | "kind" | "note">, weeks: number, scheme: MesoScheme) {
  const functional = ex.kind === "functional";
  // Вес меняем только у простого числа («60», «62,5 кг»): умножение исказит «-20», «40-50», «2×20»
  const w0 = !functional && /^\s*\d+(?:[.,]\d+)?\s*(?:кг)?\s*$/i.test(ex.weight) ? parseNum(ex.weight) : null;
  const light = w0 != null && w0 < 20;
  const sets0 = parseInt(ex.sets, 10);
  const round = (w: number) => Math.round(w * 2) / 2;
  const out: { weight: string; reps: string; sets: string; note: string }[] = [];
  let prevW = w0, blockW = w0, bonus = 0;
  for (let i = 1; i < weeks; i++) {
    const mod = weekModifier(i, scheme);
    if (light && !mod.deload) {
      const stepW = round(w0! * Math.min(1 + 0.025 * Math.floor(i / 4), CAP));
      if (stepW > blockW!) { blockW = stepW; bonus = 0; } // новый блок: шаг весом, повторы — к исходным
    }
    let w = w0;
    if (w0 != null && mod.deload) { const d = w0 * mod.weightMult; w = d < 20 ? Math.floor(d) : round(d); }
    else if (light) w = blockW;
    else if (w0 != null) w = round(w0 * Math.min(mod.weightMult, CAP));
    if (!functional && !mod.deload) {
      if (w0 == null || mod.weightMult > CAP || w === prevW) bonus = Math.min(MAX_REPS_BONUS, bonus + 1);
      prevW = w; // сравниваем с прошлой рабочей неделей, не с разгрузкой
    }
    out.push({
      weight: w != null ? String(w).replace(".", ",") : ex.weight,
      reps: functional ? ex.reps : addReps(ex.reps, bonus),
      sets: !Number.isFinite(sets0) ? ex.sets
        : String(mod.deload ? Math.max(1, Math.round(sets0 * 0.5)) : Math.max(1, sets0 + mod.setsDelta)),
      note: mod.deload ? [ex.note, DELOAD_NOTE].filter(Boolean).join(" · ") : ex.note,
    });
  }
  return out;
}

// Клонирует дни базовой недели в planId на weeks-1 последующих недель с прогрессией по схеме scheme.
// Базовая неделя (i=0) не трогается — генерируются только новые недели 2..weeks.
export async function generateMesocycle(planId: string, baseDays: Day[], weeks: number, scheme: MesoScheme) {
  const prog = baseDays.map((d) => d.exercises.map((ex) => progressExercise(ex, weeks, scheme)));
  let position = baseDays.length; // дни базовой недели уже занимают первые позиции в плане
  for (let w = 1; w < weeks; w++) {
    const mod = weekModifier(w, scheme);
    for (const [di, day] of baseDays.entries()) {
      const { data: dayRow, error: dayErr } = await supabase
        .from("plan_days")
        .insert({ plan_id: planId, name: `${mod.label} · ${day.name}`, weekday: day.weekday, position: position++, method: day.method ?? "" })
        .select()
        .single();
      if (dayErr) throw dayErr;

      if (!day.exercises.length) continue;
      const exRows = day.exercises.map((ex, i) => {
        const p = prog[di][i][w - 1];
        return {
          day_id: dayRow.id, position: i, name: ex.name,
          sets: p.sets, reps: p.reps, weight: p.weight,
          rest: ex.rest, note: p.note, video: ex.video, detailed: false, exercise_group: ex.group,
          tempo: ex.tempo, duration: ex.duration, target: ex.target, kind: ex.kind ?? "", pulse_zone: ex.pulseZone ?? "",
          // ponytail: detailed=false — построчные подходы (setRows) при клонировании недель не переносим,
          // прогрессия применяется к общему весу/sets; при необходимости тренер разворачивает день вручную
        };
      });
      const { error: exErr } = await supabase.from("plan_exercises").insert(exRows);
      if (exErr) throw exErr;
    }
  }
}
