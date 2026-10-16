import * as api from "../lib/api";
import type { Range } from "../lib/api";
import { useData } from "../lib/useData";
import { fmtDay, pct } from "../lib/format";
import { FEATURES } from "../lib/labels";
import { ChartCard, Skeleton } from "../components/ui";
import { Bars, HBars } from "../components/charts";

// Какими функциями пользуются: доля активных тренеров, у которых функция была в деле
export default function Features({ range }: { range: Range }) {
  const deps = [range.from, range.to, range.grain, range.ex, range.tz];
  const f = useData(() => api.features(range), deps);
  const s = useData(() => api.series(range), deps);
  const items = (f.data?.features ?? []).map((x) => ({ label: FEATURES[x.feature] ?? x.feature, value: x.share, sub: `${x.trainers} из ${f.data?.active}` }));
  const xf = (v: string) => fmtDay(v, range.grain);
  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <ChartCard title="Использование функций" sub={`Доля активных тренеров за период (всего активных: ${f.data?.active ?? "…"})`}
        table={{ head: ["Функция", "Тренеров", "Доля"], rows: (f.data?.features ?? []).map((x) => [FEATURES[x.feature] ?? x.feature, x.trainers, pct(x.share)]) }}>
        {f.loading ? <Skeleton h={320} /> : f.error ? <p className="text-bad">{f.error}</p> : items.length ? <HBars items={items} fmt={(v) => pct(v)} max={1} /> : <p className="text-sm text-ink3">Нет активных тренеров за период</p>}
      </ChartCard>
      <div className="space-y-4">
        <ChartCard title="Питание клиентов" sub="Записей еды, которые внесли сами клиенты"
          table={{ head: ["Период", "Записей"], rows: (s.data ?? []).map((r) => [xf(r.bucket), r.food]) }}>
          {s.loading ? <Skeleton h={200} /> : <Bars height={200} data={s.data ?? []} x="bucket" xFmt={xf} series={[{ key: "food", label: "Записей еды", color: "var(--s2)" }]} />}
        </ChartCard>
        <ChartCard title="Чат" sub="Сообщения тренеров и клиентов"
          table={{ head: ["Период", "Сообщений"], rows: (s.data ?? []).map((r) => [xf(r.bucket), r.messages]) }}>
          {s.loading ? <Skeleton h={200} /> : <Bars height={200} data={s.data ?? []} x="bucket" xFmt={xf} series={[{ key: "messages", label: "Сообщений", color: "var(--s1)" }]} />}
        </ChartCard>
      </div>
    </div>
  );
}
