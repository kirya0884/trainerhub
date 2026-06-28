import { supabase } from "./supabase";
import { parseNum } from "./format";
import type { Day } from "../types";

export type MesoScheme = "linear" | "wave" | "deload4";
export const MESO_SCHEMES: { value: MesoScheme; label: string }[] = [
  { value: "linear", label: "Линейная (вес растёт каждую неделю)" },
  { value: "wave", label: "Волна (чередование объём/интенсивность)" },
  { value: "deload4", label: "Линейная + разгрузка каждую 4-ю неделю" },
];

export function weekModifier(i: number, scheme: MesoScheme): { weightMult: number; setsDelta: number; label: string } {
  if (scheme === "deload4" && i % 4 === 3) return { weightMult: 0.6, setsDelta: -1, label: `Нед. ${i + 1} · разгрузка` };
  if (scheme === "wave") return i % 2 === 0
    ? { weightMult: 0.92, setsDelta: 1, label: `Нед. ${i + 1} · объём` }
    : { weightMult: 1.06, setsDelta: -1, label: `Нед. ${i + 1} · интенсивность` };
  const step = scheme === "deload4" ? i % 4 : i;
  return { weightMult: 1 + step * 0.025, setsDelta: 0, label: `Нед. ${i + 1}` };
}

// Клонирует дни базовой недели в planId на weeks-1 последующих недель с прогрессией по схеме scheme.
// Базовая неделя (i=0) не трогается — генерируются только новые недели 2..weeks.
export async function generateMesocycle(planId: string, baseDays: Day[], weeks: number, scheme: MesoScheme) {
  let position = baseDays.length; // дни базовой недели уже занимают первые позиции в плане
  for (let w = 1; w < weeks; w++) {
    const mod = weekModifier(w, scheme);
    for (const day of baseDays) {
      const { data: dayRow, error: dayErr } = await supabase
        .from("plan_days")
        .insert({ plan_id: planId, name: `${mod.label} · ${day.name}`, weekday: day.weekday, position: position++ })
        .select()
        .single();
      if (dayErr) throw dayErr;

      if (!day.exercises.length) continue;
      const exRows = day.exercises.map((ex, i) => {
        const w0 = parseNum(ex.weight);
        const sets0 = parseInt(ex.sets, 10);
        return {
          day_id: dayRow.id, position: i, name: ex.name,
          sets: Number.isFinite(sets0) ? String(Math.max(1, sets0 + mod.setsDelta)) : ex.sets,
          reps: ex.reps, weight: w0 != null ? String(Math.round(w0 * mod.weightMult * 2) / 2) : ex.weight,
          rest: ex.rest, note: ex.note, video: ex.video, detailed: false, exercise_group: ex.group,
          tempo: ex.tempo, duration: ex.duration, target: ex.target,
          // ponytail: detailed=false — построчные подходы (setRows) при клонировании недель не переносим,
          // прогрессия применяется к общему весу/sets; при необходимости тренер разворачивает день вручную
        };
      });
      const { error: exErr } = await supabase.from("plan_exercises").insert(exRows);
      if (exErr) throw exErr;
    }
  }
}
