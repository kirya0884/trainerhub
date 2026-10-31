import { useState } from "react";
import { Copy } from "lucide-react";
import ModalShell from "./ModalShell";
import * as api from "../lib/foodDiary";
import type { FoodEntry, Meal } from "../lib/foodDiary";
import { addDays, plural, today } from "../lib/format";
import { notify } from "../lib/dialog";

const chip = (on: boolean) => `h-9 px-3.5 rounded-full text-[13px] font-semibold transition ${on ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`;

// Копия приёма пищи (можно в другой приём) или целого дня на выбранную дату.
// По умолчанию: из прошлого — на сегодня, из сегодня — на завтра.
export default function FoodCopySheet({ list, meal, title, from, onCopy, onClose }: {
  list: FoodEntry[]; meal?: Meal;
  /** Свой заголовок — для выбранных записей (каждая копируется в свой приём) */
  title?: string;
  from: string; onCopy: (to: string, meal?: Meal) => Promise<void>; onClose: () => void;
}) {
  const t = today();
  const [to, setTo] = useState(from === t ? addDays(t, 1) : t);
  const [toMeal, setToMeal] = useState<Meal | undefined>(meal);
  const [busy, setBusy] = useState(false);
  const kcal = api.sum(list).kcal;
  const what = meal ? `«${api.MEALS.find((m) => m.key === meal)!.label}»` : "весь день";

  const go = async () => {
    if (busy || !to) return;
    setBusy(true);
    try { await onCopy(to, toMeal); }
    catch (e) { console.error("[FoodCopySheet]", e); notify("Не удалось скопировать. Проверь интернет."); setBusy(false); }
  };

  return (
    <ModalShell title={title ?? `Скопировать ${what}`} icon={<Copy size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-4">
        <p className="text-sm text-zinc-400">{list.length} {plural(list.length, ["запись", "записи", "записей"])} · {api.fmtN(kcal, 0)} ккал</p>
        <div>
          <p className="text-sm font-semibold text-zinc-400 mb-2">На какой день</p>
          <div className="flex gap-1.5 flex-wrap mb-2">
            {[[t, "Сегодня"], [addDays(t, 1), "Завтра"]].filter(([d]) => d !== from || meal).map(([d, l]) => (
              <button key={d} onClick={() => setTo(d)} aria-pressed={to === d} className={chip(to === d)}>{l}</button>
            ))}
          </div>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Дата"
            className="w-full h-11 px-3.5 rounded-xl bg-zinc-800 outline-none focus:ring-2 focus:ring-lime-400/50" />
        </div>
        {meal && (
          <div>
            <p className="text-sm font-semibold text-zinc-400 mb-2">В какой приём</p>
            <div className="flex gap-1.5 flex-wrap">
              {api.MEALS.map((m) => <button key={m.key} onClick={() => setToMeal(m.key)} aria-pressed={toMeal === m.key} className={chip(toMeal === m.key)}>{m.label}</button>)}
            </div>
          </div>
        )}
        <button onClick={go} disabled={busy || !to || (to === from && (!meal || toMeal === meal))}
          className="w-full h-12 flex items-center justify-center gap-2 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">
          <Copy size={17} /> {busy ? "Копирую…" : "Скопировать"}
        </button>
      </div>
    </ModalShell>
  );
}
