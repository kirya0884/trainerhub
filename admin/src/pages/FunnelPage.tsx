import * as api from "../lib/api";
import type { Range } from "../lib/api";
import { useData } from "../lib/useData";
import { FUNNEL } from "../lib/labels";
import { ChartCard, Skeleton } from "../components/ui";
import { Funnel } from "../components/charts";

// Воронка активации: из зарегистрированных в периоде — сколько дошли до каждого шага (за всё время)
export default function FunnelPage({ range }: { range: Range }) {
  const f = useData(() => api.funnel(range), [range.from, range.to, range.ex, range.tz]);
  const steps = (f.data ?? []).map((s) => ({ label: FUNNEL[s.step] ?? s.step, n: s.n }));
  return (
    <div className="space-y-4">
      <ChartCard title="Активация тренеров" sub="Тренеры, зарегистрированные в выбранный период: сколько дошли до каждого шага"
        table={{ head: ["Шаг", "Тренеров", "От регистрации"], rows: steps.map((s) => [s.label, s.n, `${Math.round((s.n / Math.max(1, steps[0]?.n ?? 1)) * 100)}%`]) }}>
        {f.loading ? <Skeleton h={300} /> : f.error ? <p className="text-bad">{f.error}</p> : steps[0]?.n ? <Funnel steps={steps} /> : <p className="text-sm text-ink3 py-8 text-center">За этот период новых тренеров нет — выберите период длиннее.</p>}
      </ChartCard>
      <p className="text-[13px] text-ink3 px-1">Шаги не строго по порядку: «Записал в календарь» можно сделать раньше «Провёл тренировку». Процент шага — переход с предыдущей строки.</p>
    </div>
  );
}
