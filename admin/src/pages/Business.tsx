import * as api from "../lib/api";
import type { Range } from "../lib/api";
import { useData } from "../lib/useData";
import { fmtDay, n0, n1, rub, short } from "../lib/format";
import { TIERS } from "../lib/labels";
import { ChartCard, DataTable, Kpi, Section, Skeleton } from "../components/ui";
import { Bars, HBars } from "../components/charts";

// Бизнес. Оплаты за само приложение пока не принимаются — поэтому «выручка» здесь
// потенциальная: сколько платили бы тренеры по тарифам, исходя из числа их клиентов.
export default function Business({ range }: { range: Range }) {
  const deps = [range.from, range.to, range.grain, range.ex, range.tz];
  const b = useData(() => api.business(range), deps);
  const k = useData(() => api.kpis(range), deps);
  const s = useData(() => api.series(range), deps);
  if (b.error || k.error) return <p className="text-bad">Не удалось загрузить: {b.error || k.error}</p>;
  const cur = k.data?.cur ?? {}, prev = k.data?.prev ?? {};
  const arpu = (x: Record<string, number>) => (x.active_trainers ? x.gmv / x.active_trainers : 0);
  const check = (x: Record<string, number>) => (x.payments ? x.gmv / x.payments : 0);
  const xf = (v: string) => fmtDay(v, range.grain);
  const statusName: Record<string, string> = { paid: "Оплачено", deferred: "Ожидается", installment: "Частями" };
  const typeName: Record<string, string> = { sessions: "Пакет тренировок", subscription: "Подписка", single: "Разовая" };

  return (
    <div className="space-y-6">
      <Section title="Деньги тренеров" hint="оплаты клиентов, отмеченные в приложении">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Оборот" value={k.data ? rub(cur.gmv) : "…"} cur={cur.gmv} prev={prev.gmv} format={rub} />
          <Kpi label="Ожидается оплат" value={k.data ? rub(cur.gmv_pending) : "…"} cur={cur.gmv_pending} prev={prev.gmv_pending} format={rub} invert hint="Начислено, но ещё не оплачено (позже / частями)" />
          <Kpi label="Оплат" value={k.data ? n0(cur.payments) : "…"} cur={cur.payments} prev={prev.payments} />
          <Kpi label="Средний чек" value={k.data ? rub(check(cur)) : "…"} cur={check(cur)} prev={check(prev)} format={rub} />
          <Kpi label="Платящих клиентов" value={k.data ? n0(cur.paying_clients) : "…"} cur={cur.paying_clients} prev={prev.paying_clients} />
          <Kpi label="Оборот на тренера" value={k.data ? rub(arpu(cur)) : "…"} cur={arpu(cur)} prev={arpu(prev)} format={rub} hint="Оборот / активные тренеры" />
        </div>
      </Section>

      <Section title="Потенциальная выручка Reps" hint="если бы тренеры платили по тарифам">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Kpi label="Потенциальный MRR" value={b.data ? rub(b.data.potential_mrr) : "…"} hint="Сумма тарифов по числу клиентов у каждого тренера: до 3 — бесплатно, до 15 — 990 ₽, до 40 — 1 690 ₽, больше — 2 590 ₽" />
          <Kpi label="Потенциальный ARR" value={b.data ? rub(b.data.potential_mrr * 12) : "…"} />
          <Kpi label="Клиентов на тренера" value={b.data ? n1(b.data.clients_per_trainer) : "…"} />
        </div>
      </Section>

      <div className="grid xl:grid-cols-2 gap-4">
        <ChartCard title="Оборот по периодам" table={{ head: ["Период", "Оборот", "Оплат"], rows: (s.data ?? []).map((r) => [xf(r.bucket), rub(Number(r.gmv)), r.payments]) }}>
          {s.loading ? <Skeleton /> : <Bars data={(s.data ?? []).map((r) => ({ ...r, gmv: Number(r.gmv) }))} x="bucket" xFmt={xf} fmt={short} series={[{ key: "gmv", label: "Оборот, ₽", color: "var(--s1)" }]} />}
        </ChartCard>
        <ChartCard title="Тренеры по тарифам" sub="По текущему числу клиентов"
          table={{ head: ["Тариф", "Тренеров", "₽/мес"], rows: (b.data?.tiers ?? []).map((t) => [TIERS[t.tier] ?? t.tier, t.trainers, rub(t.mrr)]) }}>
          {b.loading ? <Skeleton h={200} /> : <HBars items={(b.data?.tiers ?? []).map((t) => ({ label: `${TIERS[t.tier] ?? t.tier} · ${t.price ? rub(t.price) : "бесплатно"}`, value: t.trainers, sub: t.mrr ? `${rub(t.mrr)}/мес` : undefined }))} />}
        </ChartCard>
        <ChartCard title="Оплаты по типу и статусу">
          {b.loading ? <Skeleton h={200} /> : (
            <div className="grid sm:grid-cols-2 gap-6">
              <HBars items={(b.data?.by_type ?? []).map((t) => ({ label: typeName[t.type] ?? t.type, value: Number(t.amount), sub: `${t.n} шт.` }))} fmt={rub} />
              <HBars color="var(--s2)" items={(b.data?.by_status ?? []).map((t) => ({ label: statusName[t.status] ?? t.status, value: Number(t.amount), sub: `${t.n} шт.` }))} fmt={rub} />
            </div>
          )}
        </ChartCard>
        <ChartCard title="Тренеры с наибольшим оборотом">
          {b.loading ? <Skeleton h={200} /> : <DataTable head={["Тренер", "Оборот", "Оплат"]} rows={(b.data?.top_trainers ?? []).map((t) => [t.name || "Без имени", rub(Number(t.gmv)), t.n])} />}
        </ChartCard>
      </div>
    </div>
  );
}
