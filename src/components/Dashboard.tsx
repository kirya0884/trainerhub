import { useEffect, useState } from "react";
import { BarChart3, Cake, CalendarClock, ClipboardList, LayoutDashboard, TriangleAlert, Users, Wallet } from "lucide-react";
import { fetchDashboardData } from "../lib/dashboard";
import type { DashboardClient, DashboardPayment } from "../lib/dashboard";
import { useBookings } from "../hooks/useBookings";
import { expandBookings } from "../lib/bookings";
import { notifyDailyDigest, requestNotifyPermission } from "../lib/notify";
import { fetchAllPlans } from "../lib/clients";
import AnalyticsPanel from "./AnalyticsPanel";
import { today, addDays } from "../lib/format";
import RemainingBadge from "./RemainingBadge";

const remainingOf = (m: DashboardClient["membership"]) => (m?.type === "sessions" && m.remaining !== "" && m.remaining != null ? String(m.remaining) : null);

const PERIODS = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"]] as const;

export default function Dashboard({ trainerId, onOpenClient }: { trainerId: string; onOpenClient: (id: string) => void }) {
  const [data, setData] = useState<{ clients: DashboardClient[]; payments: DashboardPayment[] } | null>(null);
  const [plansCount, setPlansCount] = useState<number | null>(null);
  const [period, setPeriod] = useState<string>("month");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const { bookings } = useBookings(trainerId);

  useEffect(() => {
    requestNotifyPermission();
    fetchDashboardData(trainerId).then(setData);
    fetchAllPlans(trainerId).then((p) => setPlansCount(p.length));
  }, [trainerId]);

  if (!data) return <div className="text-zinc-500 text-sm p-4">Загрузка...</div>;
  const { clients, payments } = data;
  const todayStr = today();
  const weekAgo = addDays(todayStr, -6);
  const inPeriod = (d: string) => {
    if (!d) return false;
    if (period === "day") return d === todayStr;
    if (period === "month") return d.slice(0, 7) === todayStr.slice(0, 7);
    return d >= weekAgo && d <= todayStr;
  };
  // ponytail: доход считаем по факту проведённых тренировок — (цена абонемента / кол-во в пакете) на клиента, не по журналу платежей
  const periodStart = period === "day" ? todayStr : period === "month" ? `${todayStr.slice(0, 7)}-01` : weekAgo;
  const doneOccurrences = expandBookings(bookings, periodStart, todayStr).filter((o) => o.status === "done");
  const pricePerSession = (c: DashboardClient) => {
    const m = c.membership;
    if (m.type === "subscription") return Number(m.pricePerSession) || 0;
    const total = Number(m.total);
    return total > 0 ? (Number(m.packagePrice) || 0) / total : 0;
  };
  const income = doneOccurrences.reduce((sum, o) => sum + o.clientIds.reduce((s, id) => { const c = clients.find((x) => x.id === id); return c ? s + pricePerSession(c) : s; }, 0), 0);
  const trainingsDone = doneOccurrences.length;

  const activeClients = clients.filter((c) => c.status !== "left");
  const debt = activeClients.filter((c) => c.membership.remaining !== "" && c.membership.remaining != null && Number(c.membership.remaining) <= 0);
  const expiring = activeClients.filter((c) => { const r = Number(c.membership.remaining); return c.membership.remaining !== "" && c.membership.remaining != null && (r === 1 || r === 2); });
  const birthdays = activeClients.map((c) => {
    if (!c.birthday) return null;
    const parts = c.birthday.split("-");
    if (parts.length < 3) return null;
    const now0 = new Date(todayStr + "T00:00:00");
    const next = new Date(now0.getFullYear(), Number(parts[1]) - 1, Number(parts[2]));
    if (next < now0) next.setFullYear(now0.getFullYear() + 1);
    const days = Math.round((next.getTime() - now0.getTime()) / 86400000);
    return days <= 7 ? { c, days } : null;
  }).filter(Boolean) as { c: DashboardClient; days: number }[];

  const todayOccurrences = expandBookings(bookings, todayStr, todayStr).sort((a, b) => a.time.localeCompare(b.time));
  const weekUpcoming = expandBookings(bookings, todayStr, addDays(todayStr, 6)).filter((o) => o.status === "scheduled");
  const last30 = expandBookings(bookings, addDays(todayStr, -29), todayStr).filter((o) => o.status === "done" || o.status === "no-show");
  const attendanceRate = last30.length ? Math.round((last30.filter((o) => o.status === "done").length / last30.length) * 100) : null;

  // Не хук: просто пуш раз в день, защищён собственным флагом в localStorage — безопасно звать при каждом рендере.
  notifyDailyDigest(trainerId, { todayCount: todayOccurrences.length, debtNames: debt.map((c) => c.name), expiringNames: expiring.map((c) => c.name) });

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-1.5"><LayoutDashboard size={18} className="text-lime-400" /> Дашборд</h2>
        <button onClick={() => setShowAnalytics((v) => !v)} className={`flex items-center gap-1.5 text-sm rounded-lg px-2.5 py-1.5 transition ${showAnalytics ? "bg-cyan-400/15 text-cyan-400" : "text-zinc-500 hover:text-zinc-300"}`}><BarChart3 size={15} /> Аналитика</button>
      </div>

      {showAnalytics && <AnalyticsPanel clients={clients} payments={payments} attendanceRate={attendanceRate} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-xl font-bold text-zinc-100 flex items-center gap-1.5"><Users size={15} className="text-lime-400" /> {activeClients.length}</p><p className="text-xs text-zinc-500 mt-0.5">активных подопечных</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-xl font-bold text-zinc-100 flex items-center gap-1.5"><ClipboardList size={15} className="text-cyan-400" /> {plansCount ?? "—"}</p><p className="text-xs text-zinc-500 mt-0.5">планов всего</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-xl font-bold text-zinc-100 flex items-center gap-1.5"><CalendarClock size={15} className="text-orange-400" /> {weekUpcoming.length}</p><p className="text-xs text-zinc-500 mt-0.5">тренировок на неделе</p></div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-zinc-400 flex items-center gap-1.5"><Wallet size={15} className="text-lime-400" /> Доход</p>
          <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5">
            {PERIODS.map(([k, l]) => (
              <button key={k} onClick={() => setPeriod(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${period === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-2xl font-bold text-lime-400">{income.toLocaleString("ru-RU")} ₽</p><p className="text-xs text-zinc-500 mt-0.5">доход за период</p></div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-2xl font-bold text-cyan-400">{trainingsDone}</p><p className="text-xs text-zinc-500 mt-0.5">тренировок проведено</p></div>
        </div>
      </div>

      <div>
        <p className="text-sm text-zinc-400 mb-2">Сегодня</p>
        {todayOccurrences.length === 0 ? (
          <p className="text-xs text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-3 text-center">Тренировок на сегодня нет</p>
        ) : (
          <div className="space-y-1.5">
            {todayOccurrences.map((o) => (
              <div key={`${o.id}-${o.occDate}`} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
                <span className="font-mono text-xs text-zinc-400">{o.time}</span>
                <span className="text-zinc-100 truncate flex items-center gap-1 flex-wrap">
                  {o.clientIds.map((id) => { const c = clients.find((x) => x.id === id); return <span key={id} className="flex items-center gap-1"><RemainingBadge remaining={c ? remainingOf(c.membership) : null} /> {c?.name || "—"}</span>; })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {weekUpcoming.filter((o) => o.date !== todayStr).length > 0 && (
        <div>
          <p className="text-sm text-zinc-400 mb-2 flex items-center gap-1.5"><CalendarClock size={15} className="text-orange-400" /> Дальше на неделе</p>
          <div className="space-y-1.5">
            {weekUpcoming.filter((o) => o.date !== todayStr).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((o) => (
              <div key={`${o.id}-${o.occDate}`} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
                <span className="text-zinc-500 text-xs shrink-0 w-16">{o.date.slice(5)}</span>
                <span className="font-mono text-xs text-zinc-400 shrink-0">{o.time}</span>
                <span className="text-zinc-100 truncate flex items-center gap-1 flex-wrap">
                  {o.clientIds.map((id) => { const c = clients.find((x) => x.id === id); return <span key={id} className="flex items-center gap-1"><RemainingBadge remaining={c ? remainingOf(c.membership) : null} /> {c?.name || "—"}</span>; })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(debt.length > 0 || expiring.length > 0) && (
        <div>
          <p className="text-sm text-zinc-400 mb-2 flex items-center gap-1.5"><TriangleAlert size={15} className="text-orange-400" /> Требуют внимания</p>
          <div className="space-y-1.5">
            {debt.map((c) => (
              <button key={c.id} onClick={() => onOpenClient(c.id)} className="w-full flex items-center gap-2 bg-zinc-900 border border-orange-500/20 rounded-lg px-3 py-2 text-sm text-left hover:border-orange-500/40 transition">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                <RemainingBadge remaining={remainingOf(c.membership)} />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-orange-400 text-xs shrink-0">остаток исчерпан</span>
              </button>
            ))}
            {expiring.map((c) => (
              <button key={c.id} onClick={() => onOpenClient(c.id)} className="w-full flex items-center gap-2 bg-zinc-900 border border-amber-500/20 rounded-lg px-3 py-2 text-sm text-left hover:border-amber-500/40 transition">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                <RemainingBadge remaining={remainingOf(c.membership)} />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-amber-400 text-xs shrink-0">осталось {c.membership.remaining}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {birthdays.length > 0 && (
        <div>
          <p className="text-sm text-zinc-400 mb-2 flex items-center gap-1.5"><Cake size={15} className="text-pink-400" /> Дни рождения скоро</p>
          <div className="space-y-1.5">
            {birthdays.map(({ c, days }) => (
              <button key={c.id} onClick={() => onOpenClient(c.id)} className="w-full flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-left hover:border-zinc-700 transition">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                <RemainingBadge remaining={remainingOf(c.membership)} />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-zinc-500 text-xs shrink-0">{days === 0 ? "сегодня" : `через ${days} дн.`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
