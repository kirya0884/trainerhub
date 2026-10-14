import * as api from "../lib/foodDiary";
import type { Macros } from "../lib/foodDiary";

// Цвета показателей: ккал оранжевый, белки лайм, жиры розовый, углеводы голубой
// Через переменные темы (index.css): в светлой теме темнее, чтобы цифры читались на белом
export const MACRO_COLOR = { kcal: "var(--m-kcal)", protein: "var(--m-protein)", fat: "var(--m-fat)", carbs: "var(--m-carbs)" } as const;
/** Пустая ячейка (стакан, день без записей) — фон-токен, светлеет в светлой теме */
export const EMPTY_CELL = "rgb(var(--bg-800))";

// Без автофокуса: клавиатура появляется только по нажатию на поле, а не сразу с окном
export function GramsInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-baseline justify-center gap-1 h-14 rounded-xl bg-zinc-800 ring-2 ring-lime-400/60 px-4">
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" aria-label="Граммы"
        onFocus={(e) => e.target.select()} className="w-24 bg-transparent text-center text-2xl font-extrabold outline-none self-center" />
      <span className="text-zinc-400 font-semibold">г</span>
    </label>
  );
}

export function MacroTiles({ m }: { m: Macros }) {
  const items = [["kcal", "ккал"], ["protein", "белки"], ["fat", "жиры"], ["carbs", "углеводы"]] as const;
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {items.map(([k, l]) => (
        <div key={k} className="text-center py-2 rounded-xl bg-zinc-800/60">
          <b className="block text-base font-extrabold" style={{ color: MACRO_COLOR[k] }}>{api.fmtN(m[k], k === "kcal" ? 0 : 1)}</b>
          <small className="text-[11px] text-zinc-400">{l}</small>
        </div>
      ))}
    </div>
  );
}
