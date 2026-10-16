import { useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Table2 } from "lucide-react";
import { pct } from "../lib/format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-surface border border-line rounded-2xl ${className}`}>{children}</div>;
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {hint && <span className="text-[13px] text-ink3">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** Показатель с изменением к прошлому такому же периоду */
export function Kpi({ label, value, cur, prev, hint, invert = false, format }: {
  label: string; value: string; cur?: number; prev?: number; hint?: string; invert?: boolean; format?: (v: number) => string;
}) {
  const has = cur != null && prev != null;
  const delta = has ? (prev === 0 ? (cur === 0 ? 0 : null) : (cur! - prev!) / prev!) : undefined;
  const up = delta != null && delta > 0, down = delta != null && delta < 0;
  const good = invert ? down : up, bad = invert ? up : down;
  return (
    <Card className="p-4 min-w-0">
      <div className="flex items-center gap-1.5 text-[13px] text-ink2">
        <span className="truncate">{label}</span>
        {hint && <span title={hint} className="text-ink3 shrink-0 cursor-help"><Info size={13} /></span>}
      </div>
      <div className="mt-1.5 text-[26px] leading-none font-extrabold tracking-tight num">{value}</div>
      {has && (
        <div className="mt-2 flex items-center gap-1 text-[12px] num">
          {delta === null ? <span className="text-ink3">было 0</span> : delta === 0 ? <span className="text-ink3">без изменений</span> : (
            <span className={`inline-flex items-center gap-0.5 font-semibold ${good ? "text-good" : bad ? "text-bad" : "text-ink3"}`}>
              {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{pct(Math.abs(delta!), Math.abs(delta!) < 0.1 ? 1 : 0)}
            </span>
          )}
          <span className="text-ink3 truncate">· было {format ? format(prev!) : prev}</span>
        </div>
      )}
    </Card>
  );
}

export type LegendItem = { label: string; color: string; dashed?: boolean };
export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <i className="inline-block w-3 h-[3px] rounded-full" style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color }} />{i.label}
        </span>
      ))}
    </div>
  );
}

/** Карточка графика: заголовок, легенда и переключатель «Таблица» (доступность и точные числа) */
export function ChartCard({ title, sub, legend, table, children, className = "" }: {
  title: string; sub?: string; legend?: LegendItem[]; table?: { head: string[]; rows: (string | number)[][] }; children: ReactNode; className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={`p-4 min-w-0 ${className}`}>
      <div className="flex items-start gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{title}</h3>
          {sub && <p className="text-[12px] text-ink3 mt-0.5">{sub}</p>}
        </div>
        {table && (
          <button onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} title="Показать таблицей"
            className={`h-8 px-2.5 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 transition ${asTable ? "bg-accent text-onaccent" : "bg-surface2 text-ink2 hover:text-ink"}`}>
            <Table2 size={14} /> Таблица
          </button>
        )}
      </div>
      {legend && !asTable && <div className="mb-2"><Legend items={legend} /></div>}
      {asTable && table ? <DataTable head={table.head} rows={table.rows} /> : children}
    </Card>
  );
}

export function DataTable({ head, rows, max = 400 }: { head: string[]; rows: (string | number)[][]; max?: number }) {
  return (
    <div className="overflow-auto rounded-xl border border-line" style={{ maxHeight: max }}>
      <table className="w-full text-[13px] num">
        <thead className="sticky top-0 bg-surface2 text-ink2">
          <tr>{head.map((h, i) => <th key={h + i} className={`px-3 py-2 font-semibold whitespace-nowrap ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => <td key={j} className={`px-3 py-1.5 whitespace-nowrap ${j ? "text-right" : "text-left"}`}>{c}</td>)}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={head.length} className="px-3 py-6 text-center text-ink3">Нет данных за период</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, size = "md" }: { value: T; options: [T, string][]; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex p-0.5 rounded-xl bg-surface2 border border-line">
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)} aria-pressed={value === k}
          className={`${size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]"} rounded-lg font-semibold transition whitespace-nowrap ${value === k ? "bg-surface text-ink shadow-sm" : "text-ink2 hover:text-ink"}`}>{l}</button>
      ))}
    </div>
  );
}

export function Skeleton({ h = 260 }: { h?: number }) {
  return <div className="rounded-xl bg-surface2 animate-pulse" style={{ height: h }} />;
}

export function Empty({ text = "Нет данных за период" }: { text?: string }) {
  return <div className="h-40 flex items-center justify-center text-sm text-ink3">{text}</div>;
}
