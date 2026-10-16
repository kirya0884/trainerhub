import { useState } from "react";
import * as api from "../lib/api";
import type { Range } from "../lib/api";
import { useData } from "../lib/useData";
import { fmtDay, n0, n1 } from "../lib/format";
import { DEVICES, eventLabel } from "../lib/labels";
import { Card, ChartCard, DataTable, Kpi, Section, Seg, Skeleton } from "../components/ui";
import { Bars, HBars, Heatmap } from "../components/charts";

// Вовлечённость: сеансы, когда пользуются, что открывают, с каких устройств
export default function Engagement({ range }: { range: Range }) {
  const deps = [range.from, range.to, range.grain, range.ex, range.tz];
  const ss = useData(() => api.sessions(range), deps);
  const ev = useData(() => api.events(range), deps);
  const s = useData(() => api.series(range), deps);
  const [who, setWho] = useState<"trainer" | "client">("trainer");
  if (ss.error || ev.error) return <p className="text-bad">Не удалось загрузить: {ss.error || ev.error}</p>;

  const sess = (ss.data ?? []).find((x) => x.actor === who);
  const events = (ev.data?.events ?? []).filter((e) => e.actor === who);
  const devices = (ev.data?.devices ?? []).filter((d) => d.actor === who);
  const xf = (v: string) => fmtDay(v, range.grain);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Seg value={who} options={[["trainer", "Тренеры"], ["client", "Клиенты"]]} onChange={setWho} />
        <span className="text-[13px] text-ink3">Сеанс — действия одного человека с перерывами меньше 30 минут</span>
      </div>
      <Section title="Сеансы">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="Сеансов" value={sess ? n0(sess.sessions) : ss.loading ? "…" : "0"} />
          <Kpi label="Пользователей" value={sess ? n0(sess.users) : ss.loading ? "…" : "0"} />
          <Kpi label="Сеансов на человека" value={sess ? n1(sess.sessions / Math.max(1, sess.users)) : "—"} />
          <Kpi label="Средняя длина" value={sess ? `${n1(sess.avg_min)} мин` : "—"} hint="От первого до последнего действия в сеансе" />
          <Kpi label="Медиана длины" value={sess ? `${n1(sess.median_min)} мин` : "—"} hint="Половина сеансов короче этого" />
          <Kpi label="Действий за сеанс" value={sess ? n1(sess.events_per_session) : "—"} />
        </div>
      </Section>

      <div className="grid xl:grid-cols-2 gap-4">
        <ChartCard title="Когда пользуются" sub="Действия по дням недели и часам (ваш часовой пояс)"
          table={{ head: ["День", "Час", "Действий"], rows: [...(ev.data?.heatmap ?? [])].sort((a, b) => b.n - a.n).map((c) => [["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][c.dow - 1], `${c.h}:00`, c.n]) }}>
          {ev.loading ? <Skeleton h={220} /> : <Heatmap cells={ev.data?.heatmap ?? []} />}
          <p className="text-[12px] text-ink3 mt-2">Тепловая карта — по всем пользователям сразу.</p>
        </ChartCard>

        <ChartCard title="Действия в приложении" sub="Все события журнала по периодам"
          table={{ head: ["Период", "Действий", "Сообщений"], rows: (s.data ?? []).map((r) => [xf(r.bucket), r.events, r.messages]) }}>
          {s.loading ? <Skeleton /> : <Bars data={s.data ?? []} x="bucket" xFmt={xf} series={[{ key: "events", label: "Действий", color: "var(--s1)" }]} />}
        </ChartCard>

        <ChartCard title="Устройства" sub="Сеансы по устройствам — и открыто ли как установленное приложение">
          {ev.loading ? <Skeleton h={160} /> : devices.length
            ? <HBars items={devices.map((d) => ({ label: DEVICES[d.device] ?? d.device, value: d.n }))} />
            : <p className="text-sm text-ink3">Устройства собираются с 16 октября 2026.</p>}
        </ChartCard>

        <Card className="p-4 min-w-0">
          <h3 className="font-bold mb-3">Экраны и действия</h3>
          {ev.loading ? <Skeleton h={300} /> : (
            <DataTable head={["Что", "Раз", "Людей", "На человека"]}
              rows={events.map((e) => [eventLabel(e.event, e.target), n0(e.n), n0(e.users), n1(e.n / Math.max(1, e.users))])} />
          )}
        </Card>
      </div>
    </div>
  );
}
