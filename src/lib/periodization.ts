import { supabase } from "./supabase";
import { parseNum } from "./format";
import type { Day, Exercise, Mesocycle } from "../types";
import { DELOAD_NOTE, MAX_REPS_BONUS, MESO_TEMPLATES, addReps, findTemplate, progressByTemplate, shiftReps, templateWeekLabel } from "./mesoTemplates";

// Схема не хранится (выбирается в окне генератора), поэтому прежняя «Линейная + разгрузка»
// просто слилась с «Линейной» — разгрузка каждую 4-ю неделю теперь есть в обеих схемах.
// Кроме «Линейной» и «Волны» — шаблоны из mesoTemplates.ts (id шаблона).
export type MesoScheme = string;
/** weeks — длина шаблона: у фиксированных (fixed) столько недель и создаётся, у повторяющихся — по умолчанию */
export const MESO_SCHEMES: { value: MesoScheme; label: string; hint?: string; weeks: number; fixed: boolean }[] = [
  { value: "linear", label: "Линейная: +2,5% в неделю, 4-я — разгрузка", weeks: 4, fixed: false },
  { value: "wave", label: "Волна: база → объём → интенсивность → разгрузка", weeks: 4, fixed: false },
  ...MESO_TEMPLATES.map((t) => ({ value: t.id, label: t.label, hint: t.hint, weeks: t.repeat ? Math.max(4, t.weeks.length + 1) : t.weeks.length, fixed: !t.repeat })),
];

/** Потолок: вес не выше +10% к весу из плана — дальше растут повторы */
const CAP = 1.1;

/** Неделя i (0 — введённый план, не меняется). Блоки по 4 недели: k — место в блоке,
 *  B — сдвиг блока (+2,5% за каждый пройденный блок); 4-я неделя блока — разгрузка. */
// repsShift — сдвиг обеих границ повторов вместе с весом (волна): −5 % веса ≈ +2 повтора,
// +7,5 % ≈ −3 повтора, усилие недели остаётся примерно тем же (расчёт по Nuzzo 2024, см.
// CloudeCode/Агент-тренер/«Шаблоны прогрессий мезоциклов.md», Ш4). Раньше «интенсивность» давала
// +7,5 % при тех же повторах — при неделе 1 с запасом 2 повтора план был невыполним.
export function weekModifier(i: number, scheme: "linear" | "wave"): { weightMult: number; setsDelta: number; repsShift: number; deload: boolean; label: string } {
  const b = Math.floor(i / 4), k = i % 4, B = 1 + 0.025 * b;
  if (k === 3) return { weightMult: 0.9, setsDelta: 0, repsShift: 0, deload: true, label: `Нед. ${i + 1} · разгрузка` };
  if (scheme === "wave") {
    if (k === 1) return { weightMult: 0.95 * B, setsDelta: 1, repsShift: 2, deload: false, label: `Нед. ${i + 1} · объём` };
    if (k === 2) return { weightMult: 1.075 * B, setsDelta: -1, repsShift: -3, deload: false, label: `Нед. ${i + 1} · интенсивность` };
    return { weightMult: B, setsDelta: 0, repsShift: 0, deload: false, label: `Нед. ${i + 1} · база` };
  }
  return { weightMult: B * (1 + 0.025 * k), setsDelta: 0, repsShift: 0, deload: false, label: `Нед. ${i + 1}` };
}


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
  const tpl = findTemplate(scheme);
  if (tpl) return progressByTemplate(ex, weeks, tpl);
  const functional = ex.kind === "functional";
  // Вес меняем только у простого числа («60», «62,5 кг»): умножение исказит «-20», «40-50», «2×20»
  const w0 = !functional && /^\s*\d+(?:[.,]\d+)?\s*(?:кг)?\s*$/i.test(ex.weight) ? parseNum(ex.weight) : null;
  const light = w0 != null && w0 < 20;
  const sets0 = parseInt(ex.sets, 10);
  // Волна с малыми повторами (верх ≤ 6): «интенсивность» мягче — вес ×1,05 вместо ×1,075 и −2 повтора, не ниже 2
  const top0 = Number(ex.reps.match(/(\d+)\s*$/)?.[1] ?? NaN);
  const lowReps = scheme === "wave" && top0 <= 6;
  const round = (w: number) => Math.round(w * 2) / 2;
  const out: { weight: string; reps: string; sets: string; note: string }[] = [];
  let prevW = w0, blockW = w0, bonus = 0;
  for (let i = 1; i < weeks; i++) {
    const mod = weekModifier(i, scheme === "wave" ? "wave" : "linear");
    if (lowReps && mod.repsShift < 0) { mod.weightMult *= 1.05 / 1.075; mod.repsShift = -2; }
    if (light && !mod.deload) {
      const stepW = round(w0! * Math.min(1 + 0.025 * Math.floor(i / 4), CAP));
      if (stepW > blockW!) { blockW = stepW; bonus = 0; } // новый блок: шаг весом, повторы — к исходным
    }
    let w = w0;
    if (w0 != null && mod.deload) { const d = w0 * mod.weightMult; w = d < 20 ? Math.floor(d) : round(d); }
    else if (light) w = blockW;
    else if (w0 != null) w = round(w0 * Math.min(mod.weightMult, CAP));
    // Волна: повторы двигаются вместе с весом только у обычного числового веса; без веса — «объём»
    // даёт +2 к верхней границе, «интенсивность» оставляет повторы; лёгкие — как раньше (вес стоит в блоке)
    const wave = scheme === "wave" && !functional && !mod.deload;
    let reps = ex.reps;
    if (wave && w0 == null) reps = addReps(ex.reps, Math.max(0, mod.repsShift));
    else if (!functional) {
      if (!mod.deload) {
        if (w0 == null || mod.weightMult > CAP || w === prevW) bonus = Math.min(MAX_REPS_BONUS, bonus + 1);
        prevW = w; // сравниваем с прошлой рабочей неделей, не с разгрузкой
      }
      reps = addReps(wave && !light && w0 != null ? shiftReps(ex.reps, mod.repsShift, 2) : ex.reps, bonus);
    }
    out.push({
      weight: w != null ? String(w).replace(".", ",") : ex.weight,
      reps,
      sets: !Number.isFinite(sets0) ? ex.sets
        : String(mod.deload ? Math.max(1, Math.round(sets0 * 0.5)) : Math.max(1, sets0 + mod.setsDelta)),
      note: mod.deload ? [ex.note, DELOAD_NOTE].filter(Boolean).join(" · ") : ex.note,
    });
  }
  return out;
}

// Подходы «разных подходов» на неделях 2..weeks: каждая строка прогрессирует как отдельный подход,
// число строк — по схеме (разгрузка — половина, «объём» — +1 копией последней, «интенсивность» — −1).
// Раньше такие упражнения уходили в новые недели пустыми: прогрессия читала сводку, а не строки.
export function progressRows(ex: Pick<Exercise, "setRows" | "kind" | "note" | "sets" | "weight" | "reps">, weeks: number, scheme: MesoScheme) {
  const rows = ex.setRows ?? [];
  const perRow = rows.map((r) => progressExercise({ weight: r.weight, reps: r.reps, sets: "1", kind: ex.kind, note: "" }, weeks, scheme));
  const whole = progressExercise({ ...ex, sets: String(rows.length) }, weeks, scheme);
  return whole.map((w, k) => {
    const n = Math.max(1, parseInt(w.sets, 10) || rows.length);
    const week = perRow.map((pr) => ({ weight: pr[k].weight, reps: pr[k].reps }));
    while (week.length < n) week.push({ ...week[week.length - 1] });
    return { note: w.note, rows: week.slice(0, n) };
  });
}

// Разбор путей 3.22: недели 2..weeks из дней выбранного блока (или дней без блока), каждая неделя —
// свой блок сразу после исходного; дни — в конец плана, по порядку недель (так «следующий день»
// у клиента идёт неделя за неделей). Исходные дни не трогаются. Сбой посередине — созданное
// убираем (каскадом блок уносит и свои дни), чтобы повтор не размножал недели.
export async function generateMesocycle(planId: string, baseDays: Day[], weeks: number, scheme: MesoScheme,
  opts: { dayCount: number; mesocycles: Mesocycle[]; sourceMesoId: string | null }) {
  const prog = baseDays.map((d) => d.exercises.map((ex) => ex.detailed && ex.setRows?.length ? null : progressExercise(ex, weeks, scheme)));
  const progR = baseDays.map((d) => d.exercises.map((ex) => ex.detailed && ex.setRows?.length ? progressRows(ex, weeks, scheme) : null));
  const sorted = [...opts.mesocycles].sort((a, b) => a.position - b.position);
  const srcIdx = opts.sourceMesoId ? sorted.findIndex((m) => m.id === opts.sourceMesoId) : sorted.length - 1;
  // Недели из скрытого блока — тоже скрытые: черновик не должен открыться клиенту с недели 2
  const srcVisible = opts.sourceMesoId ? sorted[srcIdx]?.visibleToClient !== false : true;
  const createdMesos: string[] = [], createdDays: string[] = [];
  let position = opts.dayCount;
  try {
    for (let w = 1; w < weeks; w++) {
      const tpl = findTemplate(scheme);
      const label = tpl ? templateWeekLabel(tpl, w) : weekModifier(w, scheme === "wave" ? "wave" : "linear").label;
      const { data: mesoRow, error: mesoErr } = await supabase.from("plan_mesocycles")
        .insert({ plan_id: planId, name: label, position: 0, visible_to_client: srcVisible }).select("id").single();
      if (mesoErr) throw mesoErr;
      createdMesos.push(mesoRow.id as string);
      for (const [di, day] of baseDays.entries()) {
        const { data: dayRow, error: dayErr } = await supabase
          .from("plan_days")
          .insert({ plan_id: planId, name: day.name, weekday: day.weekday, position: position++, method: day.method ?? "", mesocycle_id: mesoRow.id, visible_to_client: day.visibleToClient !== false })
          .select("id")
          .single();
        if (dayErr) throw dayErr;
        createdDays.push(dayRow.id as string);
        if (!day.exercises.length) continue;
        const exRows = day.exercises.map((ex, i) => {
          const pr = progR[di][i]?.[w - 1];
          const p = prog[di][i]?.[w - 1];
          const s = pr ? { sets: String(pr.rows.length), weight: pr.rows[0]?.weight ?? "", reps: pr.rows[0]?.reps ?? "", note: pr.note } : p!;
          return {
            day_id: dayRow.id, position: i, name: ex.name,
            sets: s.sets, reps: s.reps, weight: s.weight,
            rest: ex.rest, note: s.note, video: ex.video, detailed: !!pr, exercise_group: ex.group,
            tempo: ex.tempo, duration: ex.duration, target: ex.target, kind: ex.kind ?? "", pulse_zone: ex.pulseZone ?? "",
          };
        });
        const { data: inserted, error: exErr } = await supabase.from("plan_exercises").insert(exRows).select("id,position");
        if (exErr) throw exErr;
        const setRows = (inserted ?? []).flatMap((r) => (progR[di][r.position as number]?.[w - 1]?.rows ?? [])
          .map((row, k) => ({ exercise_id: r.id, position: k, weight: row.weight, reps: row.reps })));
        if (setRows.length) {
          const { error: srErr } = await supabase.from("plan_exercise_set_rows").insert(setRows);
          if (srErr) throw srErr;
        }
      }
    }
    // Порядок блоков: новые недели — сразу после исходного блока
    const order = [...sorted];
    order.splice(srcIdx + 1, 0, ...createdMesos.map((id) => ({ id } as Mesocycle)));
    const { error: ordErr } = await supabase.rpc("reorder_plan_mesocycles", { p_rows: order.map((m, i) => ({ id: m.id, position: i })) });
    // Без порядка новые блоки делят позицию 0 с верхним, и новые дни уходят в неделю N — откатываем всё
    if (ordErr) throw ordErr;
  } catch (e) {
    const del = async (table: string, ids: string[]) => { if (!ids.length) return true; const { error } = await supabase.from(table).delete().in("id", ids); return !error; };
    const clean = (await del("plan_days", createdDays)) && (await del("plan_mesocycles", createdMesos));
    // Убрать созданное не вышло — сказать честно: «план не изменился» тут неправда
    if (!clean) throw Object.assign(new Error("partial"), { partial: true, cause: e });
    throw e;
  }
}
