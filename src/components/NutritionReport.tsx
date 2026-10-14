import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SkeletonRows } from "./Skeleton";
import { MACRO_COLOR } from "./NutritionParts";
import * as api from "../lib/foodDiary";
import type { FoodEntry, Macros } from "../lib/foodDiary";
import type { NutritionLog } from "../lib/nutrition";
import type { Measurement } from "../lib/clients";
import { addDays, today } from "../lib/format";

type Period = "day" | "week" | "month";
const PERIODS: [Period, string][] = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"]];
const OVER = "#f2555a";
const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const card = "bg-zinc-900 border border-zinc-800 rounded-2xl p-4";

const weekStart = (d: string) => addDays(d, -((new Date(d + "T00:00:00").getDay() + 6) % 7));
const monthStart = (d: string) => d.slice(0, 8) + "01";
const monthEnd = (d: string) => { const x = new Date(d.slice(0, 8) + "01T00:00:00"); x.setMonth(x.getMonth() + 1); x.setDate(0); return x.toLocaleDateString("sv"); };
const daysBetween = (from: string, to: string) => { const l: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) l.push(d); return l; };
const fmtD = (d: string, o: Intl.DateTimeFormatOptions) => new Date(d + "T00:00:00").toLocaleDateString("ru-RU", o);
/** «В норме» — калории в пределах ±10% от цели */
const inNorm = (kcal: number, goal: number) => goal > 0 && Math.abs(kcal - goal) <= goal * 0.1;

function range(period: Period, anchor: string) {
  if (period === "day") return { from: anchor, to: anchor };
  if (period === "week") { const from = weekStart(anchor); return { from, to: addDays(from, 6) }; }
  return { from: monthStart(anchor), to: monthEnd(anchor) };
}
function shift(period: Period, anchor: string, dir: 1 | -1) {
  if (period === "day") return addDays(anchor, dir);
  if (period === "week") return addDays(anchor, 7 * dir);
  const x = new Date(monthStart(anchor) + "T00:00:00"); x.setMonth(x.getMonth() + dir); return x.toLocaleDateString("sv");
}
function title(period: Period, anchor: string) {
  const { from, to } = range(period, anchor);
  if (period === "day") return fmtD(anchor, { day: "numeric", month: "long", weekday: "short" });
  if (period === "week") return `${fmtD(from, { day: "numeric", month: from.slice(5, 7) === to.slice(5, 7) ? undefined : "short" })} – ${fmtD(to, { day: "numeric", month: "long" })}`;
  const s = fmtD(from, { month: "long", year: "numeric" }).replace(" г.", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Отчёты питания: день (по приёмам и продуктам), неделя и месяц (калории по дням с линией цели,
// средние, дни в норме, доли БЖУ), вес из замеров рядом со средними калориями за 8 недель.
// Старые итоги дня (nutrition_logs) учитываются там, где нет записей по приёмам.
export default function NutritionReport({ clientId, goal, legacyLogs, measurements, onOpenDay }: {
  clientId: string; goal: Macros | null; legacyLogs: NutritionLog[]; measurements: Measurement[]; onOpenDay: (d: string) => void;
}) {
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(today());
  const [entries, setEntries] = useState<FoodEntry[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const { from, to } = range(period, anchor);
  // Для графика веса — 8 недель до конца периода
  const loadFrom = period === "day" ? from : [from, addDays(weekStart(to), -49)].sort()[0];

  useEffect(() => {
    let alive = true;
    setEntries(null); setSel(null);
    api.fetchEntries(clientId, loadFrom, to).then((l) => { if (alive) setEntries(l); })
      .catch((e) => { console.error("[NutritionReport]", e); if (alive) setEntries([]); });
    return () => { alive = false; };
  }, [clientId, loadFrom, to]);

  // Итог по дням: записи по приёмам, иначе старый итог дня
  const byDay = useMemo(() => {
    const m = new Map<string, Macros>();
    for (const e of entries ?? []) m.set(e.date, api.sum([m.get(e.date) ?? api.ZERO, e]));
    for (const l of legacyLogs) if (!m.has(l.date) && l.date >= loadFrom && l.date <= to) m.set(l.date, { kcal: l.calories, protein: l.protein, fat: l.fat, carbs: l.carbs });
    return m;
  }, [entries, legacyLogs, loadFrom, to]);

  const t = today();
  const days = daysBetween(from, to);
  // Сегодня день ещё идёт — в средние и «дни в норме» не берём, если есть другие дни
  const all = days.filter((d) => byDay.has(d));
  const logged = all.length > 1 || all[0] !== t ? all.filter((d) => d !== t) : all;
  const todaySkipped = logged.length < all.length;
  const avg = logged.length ? api.scale(api.sum(logged.map((d) => byDay.get(d)!)), 100 / logged.length) : api.ZERO;

  return (
    <div className="space-y-3">
      <div className="flex p-1 rounded-xl bg-zinc-900 border border-zinc-800">
        {PERIODS.map(([k, l]) => (
          <button key={k} onClick={() => { setPeriod(k); setSel(null); }} aria-pressed={period === k}
            className={`flex-1 h-9 rounded-lg text-sm font-semibold transition ${period === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{l}</button>
        ))}
      </div>
      <div className="flex items-center justify-between h-11 px-1 rounded-xl bg-zinc-900 border border-zinc-800">
        <button onClick={() => setAnchor(shift(period, anchor, -1))} aria-label="Раньше" className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 transition"><ChevronLeft size={20} /></button>
        <span className="font-bold text-[15px]">{title(period, anchor)}</span>
        <button onClick={() => setAnchor(shift(period, anchor, 1))} disabled={to >= t} aria-label="Позже" className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 transition disabled:opacity-30"><ChevronRight size={20} /></button>
      </div>

      {entries === null ? <SkeletonRows rows={3} /> : period === "day" ? (
        <DayReport entries={entries.filter((e) => e.date === from)} legacy={byDay.get(from)} goal={goal} onOpen={() => onOpenDay(from)} />
      ) : (
        <>
          <div className={card}>
            <div className="flex justify-between items-baseline"><b>Калории</b>{goal && <span className="text-[13px] text-zinc-400">цель {api.fmtN(goal.kcal, 0)}</span>}</div>
            <KcalBars days={days} byDay={byDay} goal={goal?.kcal ?? 0} period={period} sel={sel}
              onTap={(d) => (sel === d ? onOpenDay(d) : setSel(d))} />
            <p className="text-[12px] text-zinc-500 mt-2">Нажмите на столбик — БЖУ дня, ещё раз — открыть день.</p>
          </div>
          {logged.length === 0 ? (
            <p className="text-sm text-zinc-500 px-1">За этот период записей нет.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Kpi value={api.fmtN(avg.kcal, 0)} label={goal?.kcal ? `ккал в среднем · ${Math.round((avg.kcal / goal.kcal) * 100)}%` : "ккал в среднем"} />
                <Kpi value={`${api.fmtN(avg.protein, 0)} г`} color={MACRO_COLOR.protein} label={goal?.protein ? `белка · ${Math.round((avg.protein / goal.protein) * 100)}%` : "белка в среднем"} />
                {goal?.kcal
                  ? <Kpi value={`${logged.filter((d) => inNorm(byDay.get(d)!.kcal, goal.kcal)).length} из ${logged.length}`} label="дней в норме ±10%" />
                  : <Kpi value={`${logged.length} из ${days.filter((d) => d <= t).length}`} label="дней с записями" />}
              </div>
              {todaySkipped && <p className="text-[12px] text-zinc-500 px-1 -mt-1">Сегодня в средние не входит — день ещё не закончился.</p>}
              <MacroShare m={avg} />
            </>
          )}
          <WeightKcal byDay={byDay} measurements={measurements} end={to > t ? t : to} />
        </>
      )}
    </div>
  );
}

function Kpi({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
      <b className="block text-lg font-extrabold leading-tight" style={color ? { color } : undefined}>{value}</b>
      <small className="text-[12px] text-zinc-400 leading-tight block mt-0.5">{label}</small>
    </div>
  );
}

// Столбики калорий по дням. Перебор (больше цели на 10%) — красным, выбранный — ярким.
function KcalBars({ days, byDay, goal, period, sel, onTap }: {
  days: string[]; byDay: Map<string, Macros>; goal: number; period: Period; sel: string | null; onTap: (d: string) => void;
}) {
  const H = 150;
  const max = Math.max(goal * 1.25, ...days.map((d) => byDay.get(d)?.kcal ?? 0), 1);
  const y = (v: number) => (v / max) * H;
  const t = today();
  const label = (d: string, i: number) => period === "week" ? WD[i] : [1, 8, 15, 22, 29].includes(Number(d.slice(8))) ? String(Number(d.slice(8))) : "";
  return (
    <>
      <div className="relative mt-8" style={{ height: H }}>
        {goal > 0 && (
          <div className="absolute inset-x-0 border-t-[1.5px] border-dashed border-zinc-500 pointer-events-none" style={{ bottom: y(goal) }} />
        )}
        <div className="absolute inset-0 flex items-end" style={{ gap: period === "week" ? 8 : 2 }}>
          {days.map((d, i) => {
            const m = byDay.get(d);
            const v = m?.kcal ?? 0;
            const over = goal > 0 && v > goal * 1.1;
            const on = sel === d;
            const edge = i < 2 ? "left-0" : i > days.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2";
            return (
              <button key={d} onClick={() => m && onTap(d)} disabled={!m} aria-label={`${fmtD(d, { day: "numeric", month: "long" })}: ${m ? `${Math.round(v)} ккал` : "нет записей"}`}
                className="relative flex-1 h-full flex items-end">
                <span className={`block w-full ${period === "week" ? "rounded-t-lg rounded-b" : "rounded-t-sm"} transition`}
                  style={{ height: m ? Math.max(3, y(v)) : d <= t ? 3 : 0, background: !m ? "rgb(var(--bg-700))" : over ? OVER : MACRO_COLOR.kcal, opacity: !m ? 0.6 : on || !sel ? (on ? 1 : 0.55) : 0.35 }} />
                {on && m && (
                  <span className={`absolute ${edge} z-10 whitespace-nowrap rounded-lg bg-zinc-100 text-zinc-950 px-2 py-1 text-[11.5px] font-semibold leading-snug text-left`} style={{ bottom: y(v) + 6 }}>
                    {fmtD(d, { weekday: "short", day: "numeric" })} · {Math.round(v)} ккал<br />Б {Math.round(m.protein)} · Ж {Math.round(m.fat)} · У {Math.round(m.carbs)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex mt-1.5 text-[12px] text-zinc-500" style={{ gap: period === "week" ? 8 : 2 }}>
        {days.map((d, i) => <span key={d} className={`flex-1 text-center ${sel === d ? "text-zinc-100 font-bold" : ""}`}>{label(d, i)}</span>)}
      </div>
    </>
  );
}

// Откуда калории: доли белков, жиров и углеводов
function MacroShare({ m }: { m: Macros }) {
  const parts = [{ k: "protein" as const, l: "Белки", v: m.protein * 4 }, { k: "fat" as const, l: "Жиры", v: m.fat * 9 }, { k: "carbs" as const, l: "Углеводы", v: m.carbs * 4 }];
  const total = parts.reduce((a, p) => a + p.v, 0);
  if (!total) return null;
  return (
    <div className={card}>
      <b>Откуда калории</b>
      <div className="flex h-3.5 rounded-full overflow-hidden mt-2.5">
        {parts.map((p) => <i key={p.k} style={{ width: `${(p.v / total) * 100}%`, background: MACRO_COLOR[p.k] }} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[13px] text-zinc-400">
        {parts.map((p) => <span key={p.k} className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full" style={{ background: MACRO_COLOR[p.k] }} />{p.l} {Math.round((p.v / total) * 100)}%</span>)}
      </div>
    </div>
  );
}

// День: по приёмам пищи и самые калорийные продукты
function DayReport({ entries, legacy, goal, onOpen }: { entries: FoodEntry[]; legacy?: Macros; goal: Macros | null; onOpen: () => void }) {
  const total = entries.length ? api.sum(entries) : legacy ?? api.ZERO;
  if (!entries.length && !legacy) return <p className="text-sm text-zinc-500 px-1">В этот день записей нет.</p>;
  const top = [...entries].sort((a, b) => b.kcal - a.kcal).slice(0, 5);
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Kpi value={api.fmtN(total.kcal, 0)} label={goal?.kcal ? `ккал · ${Math.round((total.kcal / goal.kcal) * 100)}% цели` : "ккал"} />
        <Kpi value={`${api.fmtN(total.protein, 0)} г`} color={MACRO_COLOR.protein} label={goal?.protein ? `белка · ${Math.round((total.protein / goal.protein) * 100)}%` : "белка"} />
        <Kpi value={`${api.fmtN(total.fat, 0)} / ${api.fmtN(total.carbs, 0)}`} label="жиры / углев., г" />
      </div>
      <MacroShare m={total} />
      {entries.length > 0 ? (
        <>
          <div className={card}>
            <b>По приёмам пищи</b>
            <div className="space-y-2.5 mt-3">
              {api.MEALS.map(({ key, label }) => {
                const k = api.sum(entries.filter((e) => e.meal === key)).kcal;
                return (
                  <div key={key}>
                    <div className="flex justify-between text-sm"><span className={k ? "" : "text-zinc-500"}>{label}</span><span className="font-semibold">{k ? `${api.fmtN(k, 0)} ккал · ${Math.round((k / total.kcal) * 100)}%` : "—"}</span></div>
                    <div className="h-2 rounded-full bg-zinc-800 mt-1 overflow-hidden"><i className="block h-full rounded-full" style={{ width: `${total.kcal ? (k / total.kcal) * 100 : 0}%`, background: MACRO_COLOR.kcal }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className={card}>
            <b>Самые калорийные</b>
            <div className="divide-y divide-zinc-800 mt-1.5">
              {top.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2">
                  <span className="flex-1 min-w-0"><span className="block font-semibold truncate">{e.name}</span><span className="block text-[12px] text-zinc-500">{api.fmtN(e.grams, 0)} г · {api.MEALS.find((m) => m.key === e.meal)!.label.toLowerCase()}</span></span>
                  <span className="text-sm font-bold">{api.fmtN(e.kcal, 0)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : <p className="text-[13px] text-zinc-500 px-1">Этот день внесён одним итогом — без приёмов пищи.</p>}
      <button onClick={onOpen} className="w-full h-11 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-semibold text-zinc-300 hover:text-zinc-100 transition">Открыть день в дневнике</button>
    </>
  );
}

// Средние калории по неделям (столбики) и вес из замеров (линия) за 8 недель
function WeightKcal({ byDay, measurements, end }: { byDay: Map<string, Macros>; measurements: Measurement[]; end: string }) {
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(weekStart(end), -7 * (7 - i)));
  const data = weeks.map((w) => {
    const all = daysBetween(w, addDays(w, 6)).filter((d) => byDay.has(d));
    const ds = all.length > 1 ? all.filter((d) => d !== today()) : all; // незаконченный сегодня не тянет среднее вниз
    const kcal = ds.length ? ds.reduce((a, d) => a + byDay.get(d)!.kcal, 0) / ds.length : null;
    const ms = measurements.filter((m) => m.date >= w && m.date <= addDays(w, 6) && Number(m.weight) > 0).sort((a, b) => a.date.localeCompare(b.date));
    return { w, kcal, weight: ms.length ? Number(ms[ms.length - 1].weight) : null };
  });
  const weights = data.filter((d) => d.weight != null).map((d) => d.weight!);
  if (!data.some((d) => d.kcal != null) && weights.length < 2) return null;
  const W = 320, H = 110, bw = 26, step = W / 8;
  const kmax = Math.max(...data.map((d) => d.kcal ?? 0), 1);
  const wmin = Math.min(...weights), wmax = Math.max(...weights), span = Math.max(wmax - wmin, 1);
  const wy = (v: number) => 12 + (1 - (v - wmin) / span) * (H - 40);
  const pts = data.map((d, i) => (d.weight != null ? `${i * step + step / 2},${wy(d.weight)}` : null)).filter(Boolean).join(" ");
  const delta = weights.length >= 2 ? weights[weights.length - 1] - weights[0] : null;
  return (
    <div className={card}>
      <div className="flex justify-between items-baseline"><b>Вес и калории</b><span className="text-[13px] text-zinc-400">8 недель</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-2" style={{ height: H }} aria-hidden>
        {data.map((d, i) => d.kcal != null && (
          <rect key={d.w} x={i * step + (step - bw) / 2} y={H - (d.kcal / kmax) * (H - 30)} width={bw} height={(d.kcal / kmax) * (H - 30)} rx="5" fill={MACRO_COLOR.kcal} opacity="0.4" />
        ))}
        {weights.length >= 2 && <polyline fill="none" stroke={MACRO_COLOR.protein} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={pts} />}
        {data.map((d, i) => d.weight != null && <circle key={d.w} cx={i * step + step / 2} cy={wy(d.weight)} r="3.5" fill={MACRO_COLOR.protein} />)}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-zinc-400">
        <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full" style={{ background: MACRO_COLOR.kcal }} />Средние ккал за неделю</span>
        <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full" style={{ background: MACRO_COLOR.protein }} />
          {weights.length >= 2 ? `Вес · ${delta! > 0 ? "+" : delta! < 0 ? "−" : ""}${api.fmtN(Math.abs(delta!))} кг` : "Вес — добавьте замеры"}</span>
      </div>
    </div>
  );
}
