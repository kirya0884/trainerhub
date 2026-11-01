import { Users } from "lucide-react";
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

// 5.12: переключатель «Видят мои клиенты» — в «Я» тренера, в форме продукта и рецепта
export function SharedSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="w-full min-h-[44px] flex items-center gap-2.5 text-left text-[15px]">
      <Users size={18} className={on ? "text-lime-400" : "text-zinc-500"} />
      <span className="flex-1 min-w-0">Видят мои клиенты<small className="block text-[12px] text-zinc-500">В их списках, только для записи в дневник</small></span>
      <span className={`w-11 h-[26px] shrink-0 rounded-full p-[3px] flex transition ${on ? "bg-lime-400 justify-end" : "bg-zinc-800 border border-zinc-700"}`}>
        <span className={`w-5 h-5 rounded-full ${on ? "bg-[#0B0D0C]" : "bg-zinc-500"}`} />
      </span>
    </button>
  );
}

/** Пометка продукта или рецепта тренера в списках клиента */
export function TrainerBadge() {
  return <span className="shrink-0 h-5 px-1.5 inline-flex items-center rounded-full text-[11px] font-bold bg-lime-400/15 text-lime-400">от тренера</span>;
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
