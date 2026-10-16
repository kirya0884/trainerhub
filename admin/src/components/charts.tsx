import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";
import { n0, short } from "../lib/format";

// Графики в одном стиле: тонкие линии 2px, скругления 4px у столбиков от оси, приглушённые
// сетка и оси, подсказка по наведению. Цвет — роль ряда (тренеры, клиенты…), всегда один и тот же.
export type SeriesDef = { key: string; label: string; color: string; dashed?: boolean };
type Row = Record<string, string | number>;

const axis = { stroke: "transparent", tick: { fill: "rgb(var(--ink3))", fontSize: 12 }, tickLine: false } as const;

function Tip({ active, payload, label, fmt, labelFmt }: TooltipProps<number, string> & { fmt?: (v: number) => string; labelFmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-xl text-[12px] num">
      <div className="font-semibold mb-1">{labelFmt ? labelFmt(String(label)) : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <i className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink2">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold">{fmt ? fmt(Number(p.value)) : n0(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

export function Lines({ data, x, series, height = 260, fmt, xFmt, area = false }: {
  data: Row[]; x: string; series: SeriesDef[]; height?: number; fmt?: (v: number) => string; xFmt?: (v: string) => string; area?: boolean;
}) {
  const C = area ? AreaChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <C data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={x} {...axis} tickFormatter={xFmt} minTickGap={24} />
        <YAxis {...axis} tickFormatter={(v) => (fmt ? fmt(v) : short(v))} width={56} allowDecimals={false} />
        <Tooltip content={<Tip fmt={fmt} labelFmt={xFmt} />} cursor={{ stroke: "rgb(var(--ink3))", strokeDasharray: "3 3" }} />
        {series.map((s) => area ? (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2}
            dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "rgb(var(--surface))" }} isAnimationActive={false} />
        ) : (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined}
            dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "rgb(var(--surface))" }} isAnimationActive={false} />
        ))}
      </C>
    </ResponsiveContainer>
  );
}

export function Bars({ data, x, series, height = 260, stacked = false, fmt, xFmt }: {
  data: Row[]; x: string; series: SeriesDef[]; height?: number; stacked?: boolean; fmt?: (v: number) => string; xFmt?: (v: string) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={x} {...axis} tickFormatter={xFmt} minTickGap={16} />
        <YAxis {...axis} tickFormatter={(v) => (fmt ? fmt(v) : short(v))} width={56} allowDecimals={false} />
        <Tooltip content={<Tip fmt={fmt} labelFmt={xFmt} />} cursor={{ fill: "var(--grid)" }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? "a" : undefined} isAnimationActive={false}
            stroke="rgb(var(--surface))" strokeWidth={stacked ? 1 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={36} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Горизонтальные полосы с подписью и значением — для долей и рейтингов */
export function HBars({ items, color = "var(--s1)", fmt = n0, max }: { items: { label: string; value: number; sub?: string }[]; color?: string; fmt?: (v: number) => string; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <div key={i.label} title={`${i.label}: ${fmt(i.value)}`}>
          <div className="flex justify-between gap-3 text-[13px]"><span className="truncate">{i.label}</span><span className="font-semibold num shrink-0">{fmt(i.value)}{i.sub && <span className="text-ink3 font-normal"> · {i.sub}</span>}</span></div>
          <div className="h-2 rounded-full bg-surface2 mt-1 overflow-hidden"><i className="block h-full rounded-full" style={{ width: `${(i.value / top) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}

const seq = (t: number) => `var(--seq${t <= 0 ? 0 : Math.min(5, 1 + Math.floor(t * 4.999))})`;
const inkOn = (t: number) => (t > 0.55 ? "#fff" : "rgb(var(--ink))");

/** Тепловая карта день недели × час: один оттенок, темнее — больше */
export function Heatmap({ cells }: { cells: { dow: number; h: number; n: number }[] }) {
  const max = Math.max(1, ...cells.map((c) => c.n));
  const at = (d: number, h: number) => cells.find((c) => c.dow === d && c.h === h)?.n ?? 0;
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[620px]">
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: "28px repeat(24, 1fr)" }}>
          <span />
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-[11px] text-ink3 text-center">{h % 3 === 0 ? h : ""}</span>)}
          {days.map((d, i) => (
            <div key={d} className="contents">
              <span className="text-[12px] text-ink3 self-center">{d}</span>
              {Array.from({ length: 24 }, (_, h) => { const n = at(i + 1, h); return (
                <span key={h} title={`${d}, ${h}:00 — ${n0(n)} событий`} className="h-6 rounded-[4px]" style={{ background: seq(n / max) }} />
              ); })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[11px] text-ink3">меньше {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => <i key={t} className="w-4 h-3 rounded-[3px]" style={{ background: seq(t) }} />)} больше</div>
      </div>
    </div>
  );
}

/** Когорты: строки — когорта, колонки — период после старта, ячейка — доля вернувшихся */
export function Cohorts({ rows, periods, label }: { rows: { cohort: string; size: number; k: number; active: number }[]; periods: number; label: (k: number) => string }) {
  const cohorts = [...new Set(rows.map((r) => r.cohort))].sort();
  if (!cohorts.length) return <p className="text-sm text-ink3 py-8 text-center">Пока нет когорт за выбранный срок</p>;
  return (
    <div className="overflow-x-auto">
      <table className="text-[12px] num border-separate" style={{ borderSpacing: 2 }}>
        <thead><tr><th className="text-left text-ink3 font-semibold pr-3">Когорта</th><th className="text-ink3 font-semibold px-2">Размер</th>
          {Array.from({ length: periods + 1 }, (_, k) => <th key={k} className="text-ink3 font-semibold px-1 min-w-[44px]">{label(k)}</th>)}</tr></thead>
        <tbody>
          {cohorts.map((c) => {
            const rs = rows.filter((r) => r.cohort === c);
            const size = rs[0].size;
            return (
              <tr key={c}>
                <td className="pr-3 whitespace-nowrap text-ink2">{new Date(c + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}</td>
                <td className="text-center font-semibold">{size}</td>
                {Array.from({ length: periods + 1 }, (_, k) => {
                  const r = rs.find((x) => x.k === k);
                  if (!r) return <td key={k} className="h-8 rounded-[4px] bg-surface2/50" />;
                  const t = r.active / size;
                  return <td key={k} title={`${r.active} из ${size}`} className="h-8 rounded-[4px] text-center font-semibold" style={{ background: seq(t), color: inkOn(t) }}>{Math.round(t * 100)}%</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Воронка: ширина — доля от первого шага, справа — переход с прошлого шага */
export function Funnel({ steps }: { steps: { label: string; n: number }[] }) {
  const first = Math.max(1, steps[0]?.n ?? 1);
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].n : s.n;
        return (
          <div key={s.label} className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(110px, 180px) 1fr 92px" }}>
            <span className="text-[13px] truncate">{s.label}</span>
            <div className="h-8 rounded-lg bg-surface2 overflow-hidden" title={`${s.n} из ${first}`}>
              <div className="h-full rounded-lg flex items-center px-2 text-[12px] font-bold text-white num" style={{ width: `${Math.max(4, (s.n / first) * 100)}%`, background: "var(--s1)" }}>{s.n}</div>
            </div>
            <span className="text-[12px] text-ink2 num text-right">{Math.round((s.n / first) * 100)}%{i > 0 && <span className="text-ink3"> · {prev ? Math.round((s.n / prev) * 100) : 0}% шага</span>}</span>
          </div>
        );
      })}
    </div>
  );
}
