import { Angry, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, Frown, Laugh, Meh, Smile, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Оценки после тренировки (1..5, 0 — не задано). Иконки с подписью вместо эмодзи:
// эмодзи на разных телефонах выглядят по-разному и без подписи читаются неоднозначно.
export type FeelingKind = "mood" | "wellbeing";
const SCALES: Record<FeelingKind, { icon: LucideIcon; label: string }[]> = {
  mood: [
    { icon: Angry, label: "Ужасно" },
    { icon: Frown, label: "Плохо" },
    { icon: Meh, label: "Нормально" },
    { icon: Smile, label: "Хорошо" },
    { icon: Laugh, label: "Отлично" },
  ],
  wellbeing: [
    { icon: BatteryWarning, label: "Без сил" },
    { icon: BatteryLow, label: "Устал" },
    { icon: BatteryMedium, label: "Нормально" },
    { icon: BatteryFull, label: "Бодро" },
    { icon: Zap, label: "Заряжен" },
  ],
};

export const feelingLabel = (kind: FeelingKind, value: number) => SCALES[kind][value - 1]?.label ?? "";

/** Выбор оценки. compact — без подписей (узкие колонки групповой тренировки). */
export function FeelingScale({ kind, value, onChange, compact = false }: { kind: FeelingKind; value: number; onChange: (v: number) => void; compact?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="radiogroup">
      {SCALES[kind].map(({ icon: Icon, label }, i) => {
        const on = value === i + 1;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => onChange(on ? 0 : i + 1)}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl transition ${compact ? "h-11" : "h-16"} ${on ? "bg-lime-400/15 ring-2 ring-lime-400 text-lime-400" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"}`}
          >
            <Icon size={compact ? 20 : 22} />
            {!compact && <span className="text-[11px] font-medium leading-none">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Показ сохранённой оценки: иконка и подпись (withLabel=false — только иконка с подсказкой). */
export function FeelingBadge({ kind, value, withLabel = true }: { kind: FeelingKind; value: number; withLabel?: boolean }) {
  const item = SCALES[kind][value - 1];
  if (!item) return null;
  const Icon = item.icon;
  return (
    <span className="inline-flex items-center gap-1 text-zinc-200" title={item.label}>
      <Icon size={16} className="text-lime-400 shrink-0" />
      {withLabel && <span>{item.label}</span>}
    </span>
  );
}
