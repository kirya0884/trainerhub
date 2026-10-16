import { useState } from "react";
import * as api from "../lib/api";
import type { Range } from "../lib/api";
import { useData } from "../lib/useData";
import { fmtDay, n0, n1, pct, rub, short } from "../lib/format";
import { ChartCard, Kpi, Section, Seg, Skeleton } from "../components/ui";
import { Bars, Lines } from "../components/charts";

const T = "var(--s1)", C = "var(--s2)", S = "var(--s3)";

// Обзор: главные цифры периода с изменением к прошлому такому же периоду и основные ряды
export default function Overview({ range }: { range: Range }) {
  const deps = [range.from, range.to, range.grain, range.ex, range.tz];
  const k = useData(() => api.kpis(range), deps);
  const s = useData(() => api.series(range), deps);
  const a = useData(() => api.active(range), deps);
  const [who, setWho] = useState<"trainer" | "client">("trainer");

  const cur = k.data?.cur ?? {}, prev = k.data?.prev ?? {};
  const kp = (key: string, label: string, opts: { hint?: string; money?: boolean; dec?: boolean; invert?: boolean } = {}) => {
    const f = opts.money ? rub : opts.dec ? n1 : n0;
    return <Kpi key={key} label={label} value={k.data ? f(cur[key]) : "…"} cur={cur[key]} prev={prev[key]} hint={opts.hint} format={f} invert={opts.invert} />;
  };
  const sticky = (x: Record<string, number>) => (x.active_trainers ? x.dau_trainers / x.active_trainers : 0);
  const xf = (v: string) => fmtDay(v, range.grain);
  const rows = (s.data ?? []).map((r) => ({ ...r, gmv: Number(r.gmv) }));
  const act = (a.data ?? []).filter((r) => r.actor === who);

  if (k.error || s.error) return <p className="text-bad">Не удалось загрузить: {k.error || s.error}</p>;
  return (
    <div className="space-y-6">
      <Section title="Пользователи">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {kp("active_trainers", "Активные тренеры", { hint: "Хотя бы одно действие за период" })}
          {kp("new_trainers", "Новые тренеры")}
          {kp("trainers_total", "Тренеров всего")}
          {kp("active_clients", "Активные клиенты", { hint: "Клиенты, которые сами что-то делали в своём кабинете" })}
          {kp("new_clients", "Новые подопечные")}
          {kp("portal_clients", "Клиенты с кабинетом", { hint: "Подопечные, которым тренер выдал вход" })}
          {kp("dau_trainers", "DAU тренеров", { dec: true, hint: "Среднее число активных тренеров в день" })}
          {kp("dau_clients", "DAU клиентов", { dec: true })}
          <Kpi label="Липкость DAU / MAU" value={k.data ? pct(sticky(cur)) : "…"} cur={sticky(cur)} prev={sticky(prev)} format={(v) => pct(v)} hint="Какую долю дней в периоде заходит активный тренер" />
          {kp("clients_total", "Подопечных всего")}
          {kp("messages", "Сообщений в чате")}
          {kp("food_entries", "Записей питания", { hint: "Еда, которую внесли клиенты" })}
        </div>
      </Section>

      <Section title="Работа и деньги">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {kp("workouts", "Тренировок проведено")}
          {kp("workouts_client", "Из них клиент сам")}
          {kp("bookings_done", "Записей «проведена»")}
          {kp("no_shows", "«Не пришёл»", { invert: true })}
          {kp("gmv", "Оборот тренеров", { money: true, hint: "Оплаты клиентов, отмеченные в приложении" })}
          {kp("payments", "Оплат")}
        </div>
      </Section>

      <div className="grid xl:grid-cols-2 gap-4">
        <ChartCard title="Активная аудитория" sub="DAU — за день, WAU — за 7 дней, MAU — за 30 дней"
          legend={[{ label: "DAU", color: T }, { label: "WAU", color: C }, { label: "MAU", color: S }]}
          table={{ head: ["День", "DAU", "WAU", "MAU"], rows: act.map((r) => [fmtDay(r.d), r.dau, r.wau, r.mau]) }}>
          <div className="mb-2"><Seg size="sm" value={who} options={[["trainer", "Тренеры"], ["client", "Клиенты"]]} onChange={setWho} /></div>
          {a.loading ? <Skeleton /> : <Lines data={act} x="d" xFmt={(v) => fmtDay(v)} series={[{ key: "dau", label: "DAU", color: T }, { key: "wau", label: "WAU", color: C }, { key: "mau", label: "MAU", color: S }]} />}
        </ChartCard>

        <ChartCard title="Активные пользователи по периодам" legend={[{ label: "Тренеры", color: T }, { label: "Клиенты", color: C }]}
          table={{ head: ["Период", "Тренеры", "Клиенты"], rows: rows.map((r) => [xf(r.bucket), r.active_trainers, r.active_clients]) }}>
          {s.loading ? <Skeleton /> : <Bars data={rows} x="bucket" xFmt={xf} series={[{ key: "active_trainers", label: "Тренеры", color: T }, { key: "active_clients", label: "Клиенты", color: C }]} />}
        </ChartCard>

        <ChartCard title="Тренировки" sub="Кто проводил: тренер с клиентом, клиент сам, тренер свою"
          legend={[{ label: "С тренером", color: T }, { label: "Клиент сам", color: C }, { label: "Своя тренера", color: S }]}
          table={{ head: ["Период", "С тренером", "Клиент сам", "Своя"], rows: rows.map((r) => [xf(r.bucket), r.workouts_trainer, r.workouts_client, r.workouts_self]) }}>
          {s.loading ? <Skeleton /> : <Bars stacked data={rows} x="bucket" xFmt={xf} series={[{ key: "workouts_trainer", label: "С тренером", color: T }, { key: "workouts_client", label: "Клиент сам", color: C }, { key: "workouts_self", label: "Своя тренера", color: S }]} />}
        </ChartCard>

        <ChartCard title="Оборот тренеров" sub="Сумма оплат клиентов, принятых через приложение"
          table={{ head: ["Период", "Оборот", "Оплат"], rows: rows.map((r) => [xf(r.bucket), rub(r.gmv), r.payments]) }}>
          {s.loading ? <Skeleton /> : <Bars data={rows} x="bucket" xFmt={xf} fmt={short} series={[{ key: "gmv", label: "Оборот, ₽", color: T }]} />}
        </ChartCard>

        <ChartCard title="Новые тренеры и подопечные" legend={[{ label: "Тренеры", color: T }, { label: "Подопечные", color: C }]}
          table={{ head: ["Период", "Тренеры", "Подопечные"], rows: rows.map((r) => [xf(r.bucket), r.new_trainers, r.new_clients]) }}>
          {s.loading ? <Skeleton /> : <Bars data={rows} x="bucket" xFmt={xf} series={[{ key: "new_trainers", label: "Тренеры", color: T }, { key: "new_clients", label: "Подопечные", color: C }]} />}
        </ChartCard>

        <ChartCard title="Записи календаря" legend={[{ label: "Проведена", color: T }, { label: "Не пришёл", color: C }]}
          table={{ head: ["Период", "Проведена", "Не пришёл"], rows: rows.map((r) => [xf(r.bucket), r.bookings_done, r.no_shows]) }}>
          {s.loading ? <Skeleton /> : <Bars data={rows} x="bucket" xFmt={xf} series={[{ key: "bookings_done", label: "Проведена", color: T }, { key: "no_shows", label: "Не пришёл", color: C }]} />}
        </ChartCard>
      </div>
    </div>
  );
}
