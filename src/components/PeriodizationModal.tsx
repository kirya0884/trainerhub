import { useState } from "react";
import { Minus, Plus, Repeat } from "lucide-react";
import ModalShell from "./ModalShell";
import { MESO_SCHEMES, generateMesocycle, type MesoScheme } from "../lib/periodization";
import { snapshotPlan } from "../lib/planVersions";
import { notify } from "../lib/dialog";
import { humanError } from "../lib/errors";
import type { Day, Mesocycle } from "../types";

// Разбор путей 3.22: неделя 1 — выбранный блок (или дни без блока), а не все дни плана: повторный
// запуск раньше размножал уже сгенерированные недели. Перед генерацией — авто-снимок версии,
// чтобы результат можно было откатить; сбой — понятное сообщение.
export default function PeriodizationModal({ days, mesocycles, planId, onClose, onDone }: { days: Day[]; mesocycles: Mesocycle[]; planId: string; onClose: () => void; onDone: () => void }) {
  const blocks = [...mesocycles].filter((m) => !m.archivedAt).sort((a, b) => a.position - b.position)
    .map((m) => ({ id: m.id as string | null, name: m.name, days: days.filter((d) => d.mesocycleId === m.id) }))
    .filter((b) => b.days.length > 0);
  const loose = days.filter((d) => !d.mesocycleId);
  const sources = [...blocks, ...(loose.length ? [{ id: null, name: blocks.length ? "Дни без блока" : "Дни плана", days: loose }] : [])];
  const [src, setSrc] = useState<string>(sources[0]?.id ?? "");
  const source = sources.find((s) => (s.id ?? "") === src) ?? sources[0];
  const [weeks, setWeeks] = useState(4);
  const [scheme, setScheme] = useState<MesoScheme>("linear");
  const info = MESO_SCHEMES.find((s) => s.value === scheme) ?? MESO_SCHEMES[0];
  const pickScheme = (v: MesoScheme) => { setScheme(v); setWeeks(MESO_SCHEMES.find((s) => s.value === v)?.weeks ?? 4); };
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!source || busy) return;
    setBusy(true);
    try {
      await snapshotPlan(planId, "Перед генератором мезоцикла");
      await generateMesocycle(planId, source.days, weeks, scheme, { dayCount: days.length, mesocycles, sourceMesoId: source.id });
      notify(`Добавлено недель: ${weeks - 1}. Прежний план сохранён в «Версиях» — его можно вернуть.`, "info");
      onDone();
    } catch (e) {
      console.error("[PeriodizationModal] run:", e);
      notify((e as { partial?: boolean })?.partial
        ? "Недели создались не полностью. Открой «Версии» и верни «Перед генератором мезоцикла»."
        : humanError(e, "Не удалось создать недели. План не изменился, попробуй ещё раз"), "error");
      if ((e as { partial?: boolean })?.partial) onDone();
    } finally { setBusy(false); }
  };

  const stepBtn = "w-11 h-11 shrink-0 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition disabled:opacity-40";
  return (
    <ModalShell title="Генератор мезоцикла" icon={<Repeat size={17} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3 text-sm">
        {sources.length > 1 && (
          <label className="text-xs text-zinc-500 block">Неделя 1 — это
            <select value={src} onChange={(e) => setSrc(e.target.value)} className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40">
              {sources.map((s) => <option key={s.id ?? ""} value={s.id ?? ""} className="bg-zinc-900">{s.name} · {s.days.length} дн.</option>)}
            </select>
          </label>
        )}
        <p className="text-zinc-400">{source ? `«${source.name}» (${source.days.length} дн.) — неделя 1. Для недель 2…${weeks} дни склонируются с прогрессией, каждая неделя станет своим блоком.` : "В плане нет дней."}</p>
        <div>
          <p className="text-xs text-zinc-500 mb-1">Длительность мезоцикла (недель){info.fixed ? " — задана шаблоном" : ""}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeeks((w) => Math.max(2, w - 1))} disabled={info.fixed || weeks <= 2} className={stepBtn} aria-label="Меньше недель"><Minus size={16} /></button>
            <span className="flex-1 text-center text-lg font-bold">{weeks}</span>
            <button onClick={() => setWeeks((w) => Math.min(12, w + 1))} disabled={info.fixed || weeks >= 12} className={stepBtn} aria-label="Больше недель"><Plus size={16} /></button>
          </div>
        </div>
        <label className="text-xs text-zinc-500 block">Схема прогрессии
          <select value={scheme} onChange={(e) => pickScheme(e.target.value)} className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 outline-none focus:ring-1 focus:ring-lime-400/40">
            {MESO_SCHEMES.map((s) => <option key={s.value} value={s.value} className="bg-zinc-900">{s.label}</option>)}
          </select>
        </label>
        {info.hint ? (
          <p className="text-xs text-zinc-500 leading-relaxed">
            {info.hint} Целевой запас повторов (RIR) пишется в заметку. Вес без числа не меняется — вместо прибавки +1 повтор (не больше +4). До 20 кг вес внутри цикла стоит, растут повторы. Вес округляется по снаряду: от 40 кг — до 2,5, от 20 — до 1, легче — до 0,5. У функциональных меняются только подходы.
          </p>
        ) : (
        <p className="text-xs text-zinc-500 leading-relaxed">
          {scheme === "wave"
            ? "Блок из 4 недель: база → объём (вес −5%, +1 подход, повторы +2) → интенсивность (вес +7,5%, −1 подход, повторы −3) → разгрузка. При 6 повторах и меньше «интенсивность» мягче: вес +5%, повторы −2, не меньше 2. Без веса «объём» даёт +2 повтора к верхней границе. Каждый следующий блок на 2,5% тяжелее."
            : "Блок из 4 недель: вес +2,5% каждую неделю, 4-я — разгрузка. Каждый следующий блок стартует на 2,5% выше."}
          {" "}Разгрузка: вес −10% (до 20 кг — с округлением вниз до целого), подходов вдвое меньше. Вес не выше +10% к плану — дальше растут повторы: +1 к верхней границе, не больше +4. До 20 кг внутри блока растут повторы, а с новым блоком вес делает шаг и повторы возвращаются к исходным. У функциональных меняются только подходы. «Разные подходы» прогрессируют построчно.
        </p>
        )}
        <button onClick={run} disabled={busy || !source} className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-xl py-2.5 hover:bg-lime-300 transition disabled:opacity-50">{busy ? "Генерация..." : `Создать недель: ${weeks - 1}`}</button>
      </div>
    </ModalShell>
  );
}
