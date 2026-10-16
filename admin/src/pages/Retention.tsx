import { useState } from "react";
import * as api from "../lib/api";
import type { Range } from "../lib/api";
import { useData } from "../lib/useData";
import { ChartCard, Seg, Skeleton } from "../components/ui";
import { Cohorts } from "../components/charts";

// Удержание по когортам. Тренеры — от регистрации, клиенты — от первого собственного действия.
// Не зависит от выбранного периода: смотрит последние N недель или месяцев.
export default function Retention({ range }: { range: Range }) {
  const [grain, setGrain] = useState<"week" | "month">("week");
  const periods = grain === "week" ? 10 : 6;
  const deps = [grain, range.ex, range.tz];
  const t = useData(() => api.retention(range, "trainer", grain, periods), deps);
  const c = useData(() => api.retention(range, "client", grain, periods), deps);
  const label = (k: number) => (grain === "week" ? `Н${k}` : `М${k}`);
  const avg = (rows: api.RetentionRow[] | null, k: number) => {
    const xs = (rows ?? []).filter((r) => r.k === k);
    const size = xs.reduce((a, r) => a + r.size, 0);
    return size ? Math.round((xs.reduce((a, r) => a + r.active, 0) / size) * 100) : null;
  };
  const hint = (rows: api.RetentionRow[] | null) => [1, grain === "week" ? 4 : 3].map((k) => `${label(k)}: ${avg(rows, k) ?? "—"}%`).join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Seg value={grain} options={[["week", "По неделям"], ["month", "По месяцам"]]} onChange={setGrain} />
        <span className="text-[13px] text-ink3">Ячейка — какая доля когорты была активна через столько {grain === "week" ? "недель" : "месяцев"}. {label(0)} — период старта.</span>
      </div>
      <ChartCard title="Тренеры" sub={`Когорта — неделя/месяц регистрации · в среднем ${hint(t.data)}`}>
        {t.loading ? <Skeleton h={220} /> : t.error ? <p className="text-bad">{t.error}</p> : <Cohorts rows={t.data ?? []} periods={periods} label={label} />}
      </ChartCard>
      <ChartCard title="Клиенты" sub={`Когорта — когда клиент впервые сам что-то сделал · в среднем ${hint(c.data)}`}>
        {c.loading ? <Skeleton h={220} /> : c.error ? <p className="text-bad">{c.error}</p> : <Cohorts rows={c.data ?? []} periods={periods} label={label} />}
      </ChartCard>
    </div>
  );
}
