import { useMemo, useState } from "react";
import { ArrowLeft, ArrowDown, ArrowUp, Search } from "lucide-react";
import * as api from "../lib/api";
import type { Range, TrainerRow } from "../lib/api";
import { useData } from "../lib/useData";
import { ago, fmtDateTime, fmtDay, n0, rub } from "../lib/format";
import { DEVICES, TIERS, kindLabel } from "../lib/labels";
import { Card, ChartCard, Kpi, Skeleton } from "../components/ui";
import { Bars, HBars } from "../components/charts";

type Col = { key: keyof TrainerRow; label: string; num?: boolean; fmt?: (r: TrainerRow) => string };
const COLS: Col[] = [
  { key: "name", label: "Тренер", fmt: (r) => r.name || "Без имени" },
  { key: "signed_up", label: "Регистрация", fmt: (r) => fmtDay(r.signed_up.slice(0, 10)) },
  { key: "last_active", label: "Был", fmt: (r) => ago(r.last_active) },
  { key: "active_days", label: "Дней активен", num: true },
  { key: "clients", label: "Клиентов", num: true },
  { key: "portal_clients", label: "В кабинете", num: true },
  { key: "active_clients", label: "Клиенты активны", num: true },
  { key: "workouts", label: "Тренировок", num: true },
  { key: "client_workouts", label: "Сами клиенты", num: true },
  { key: "gmv", label: "Оборот", num: true, fmt: (r) => rub(Number(r.gmv)) },
  { key: "tier", label: "Тариф", fmt: (r) => TIERS[r.tier] ?? r.tier },
];

// Список тренеров с показателями за период; клик — подробности по одному
export default function Trainers({ range }: { range: Range }) {
  const t = useData(() => api.trainers(range), [range.from, range.to, range.ex, range.tz]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: keyof TrainerRow; desc: boolean }>({ key: "last_active", desc: true });
  const [open, setOpen] = useState<TrainerRow | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const xs = (t.data ?? []).filter((r) => !s || (r.name ?? "").toLowerCase().includes(s) || (r.email ?? "").toLowerCase().includes(s));
    const v = (r: TrainerRow) => { const x = r[sort.key]; return typeof x === "string" && COLS.find((c) => c.key === sort.key)?.num ? Number(x) : x ?? ""; };
    return [...xs].sort((a, b) => { const A = v(a), B = v(b); const c = A < B ? -1 : A > B ? 1 : 0; return sort.desc ? -c : c; });
  }, [t.data, q, sort]);

  if (open) return <TrainerDetail row={open} range={range} onBack={() => setOpen(null)} />;
  if (t.error) return <p className="text-bad">Не удалось загрузить: {t.error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или почта"
            className="h-9 w-64 pl-9 pr-3 rounded-lg bg-surface border border-line text-sm outline-none focus:border-accent" />
        </label>
        <span className="text-[13px] text-ink3">{t.data ? `${rows.length} из ${t.data.length}` : "…"} · показатели — за выбранный период, клиенты и тариф — сейчас</span>
      </div>
      <Card className="overflow-x-auto">
        {t.loading ? <div className="p-4"><Skeleton h={300} /></div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink3 text-[12px] border-b border-line">
                {COLS.map((c) => (
                  <th key={c.key} className={`px-3 py-2.5 font-semibold whitespace-nowrap ${c.num ? "text-right" : ""}`}>
                    <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                      {c.label}{sort.key === c.key && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r)} className="border-b border-line/60 last:border-0 hover:bg-surface2 cursor-pointer">
                  {COLS.map((c) => (
                    <td key={c.key} className={`px-3 py-2.5 whitespace-nowrap ${c.num ? "text-right num" : ""}`}>
                      {c.key === "name" ? <div><div className="font-semibold">{c.fmt!(r)}</div><div className="text-[12px] text-ink3">{r.email}</div></div>
                        : c.fmt ? c.fmt(r) : n0(Number(r[c.key]))}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={COLS.length} className="px-3 py-8 text-center text-ink3">Никого не нашлось</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function TrainerDetail({ row, range, onBack }: { row: TrainerRow; range: Range; onBack: () => void }) {
  const d = useData(() => api.trainer(row.id, range), [row.id, range.from, range.to, range.tz]);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="h-9 w-9 grid place-items-center rounded-lg border border-line hover:bg-surface2" aria-label="Назад"><ArrowLeft size={18} /></button>
        <div>
          <h2 className="text-lg font-extrabold">{row.name || "Без имени"}</h2>
          <p className="text-[13px] text-ink3">{row.email} · с {fmtDay(row.signed_up.slice(0, 10))} · был {ago(row.last_active)} · тариф «{TIERS[row.tier] ?? row.tier}»</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Дней активен" value={n0(row.active_days)} />
        <Kpi label="Клиентов" value={n0(row.clients)} hint={`В кабинете: ${row.portal_clients}`} />
        <Kpi label="Клиенты активны" value={n0(row.active_clients)} hint="Сами что-то делали в кабинете за период" />
        <Kpi label="Тренировок" value={n0(row.workouts)} />
        <Kpi label="Клиенты сами" value={n0(row.client_workouts)} />
        <Kpi label="Оборот" value={rub(Number(row.gmv))} />
      </div>
      <div className="grid xl:grid-cols-2 gap-4">
        <ChartCard title="Активность по дням" legend={[{ label: "Действия тренера", color: "var(--s1)" }, { label: "Действия клиентов", color: "var(--s2)" }]}
          table={{ head: ["День", "Тренер", "Клиенты", "Тренировок"], rows: (d.data?.daily ?? []).map((x) => [fmtDay(x.d), x.trainer_events, x.client_actions, x.workouts]) }}>
          {d.loading ? <Skeleton /> : <Bars stacked data={d.data?.daily ?? []} x="d" xFmt={(v) => fmtDay(v)}
            series={[{ key: "trainer_events", label: "Тренер", color: "var(--s1)" }, { key: "client_actions", label: "Клиенты", color: "var(--s2)" }]} />}
        </ChartCard>
        <ChartCard title="Чем занимается" sub="Самые частые действия за период">
          {d.loading ? <Skeleton h={220} /> : (d.data?.kinds ?? []).length
            ? <HBars items={(d.data?.kinds ?? []).slice(0, 12).map((k) => ({ label: kindLabel(k.kind), value: k.n }))} />
            : <p className="text-sm text-ink3">За период ничего</p>}
        </ChartCard>
      </div>
      <Card className="p-4">
        <h3 className="font-bold mb-3">Последние действия</h3>
        {d.loading ? <Skeleton h={200} /> : (
          <ul className="divide-y divide-line/60 text-sm">
            {(d.data?.recent ?? []).map((e, i) => (
              <li key={i} className="py-2 flex items-center gap-3">
                <span className="w-32 shrink-0 text-ink3 num">{fmtDateTime(e.ts)}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded ${e.actor === "client" ? "bg-surface2 text-ink2" : "bg-accent/15"}`}>{e.actor === "client" ? "клиент" : "тренер"}</span>
                <span className="flex-1 min-w-0 truncate">{kindLabel(e.kind)}</span>
                {e.device && <span className="text-[12px] text-ink3 hidden sm:block">{DEVICES[e.device] ?? e.device}</span>}
              </li>
            ))}
            {!(d.data?.recent ?? []).length && <li className="py-6 text-center text-ink3">Пока ничего</li>}
          </ul>
        )}
      </Card>
    </div>
  );
}
