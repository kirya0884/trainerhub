import { useEffect, useState } from "react";
import { BarChart3, Cake, CalendarClock, Clock, Eye, EyeOff, TriangleAlert, Users, Wallet } from "lucide-react";
import { fetchDashboardData } from "../lib/dashboard";
import type { DashboardClient, DashboardPayment } from "../lib/dashboard";
import { useBookings } from "../hooks/useBookings";
import { expandBookings } from "../lib/bookings";
import { notifyDailyDigest, requestNotifyPermission } from "../lib/notify";
import AnalyticsPanel from "./AnalyticsPanel";
import { today, addDays } from "../lib/format";
import RemainingBadge from "./RemainingBadge";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "ДОБРОЕ УТРО" : h < 18 ? "ДОБРЫЙ ДЕНЬ" : "ДОБРЫЙ ВЕЧЕР"; };

function DonutChart({ pct, color = "#a3e635", size = 72 }: { pct: number; color?: string; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(1, pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#27272a" strokeWidth={8} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
    </svg>
  );
}

const remainingOf = (m: DashboardClient["membership"]) => (m?.type === "sessions" && m.remaining !== "" && m.remaining != null ? String(m.remaining) : null);

const PERIODS = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"]] as const;

export default function Dashboard({ trainerId, trainerName = "", trainerAvatar = "", onOpenClient }: { trainerId: string; trainerName?: string; trainerAvatar?: string; onOpenClient: (id: string) => void }) {
  const [data, setData] = useState<{ clients: DashboardClient[]; payments: DashboardPayment[] } | null>(null);
  const [period, setPeriod] = useState<string>("month");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [hideRevenue, setHideRevenue] = useState(false);
  const { bookings } = useBookings(trainerId);

  useEffect(() => {
    requestNotifyPermission();
    fetchDashboardData(trainerId).then(setData);
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
  const attendanceRate = last30.length ? Math.round((last30.filter((o) => o.status === "done").length / last30.length) * 100) : 0;
  const trainedThisWeek = expandBookings(bookings, addDays(todayStr, -6), todayStr).filter((o) => o.status === "done").length;
  const periodLabel = period === "day" ? "СЕГОДНЯ" : period === "week" ? "НЕДЕЛЯ" : new Date(todayStr + "T00:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).toUpperCase();

  // Оплаты за текущий месяц из client_payments (реальные поступления, не расчётный доход)
  const thisMonth = todayStr.slice(0, 7);
  const paymentsThisMonth = payments.filter((p) => p.date.startsWith(thisMonth));
  const cashReceived = paymentsThisMonth.filter((p) => p.payStatus === "paid").reduce((s, p) => s + p.amount, 0);
  const cashPending = paymentsThisMonth.filter((p) => p.payStatus !== "paid").reduce((s, p) => s + p.amount, 0);
  // Подписки с истекающей датой в течение 7 дней
  const upcomingRenewals = activeClients.filter((c) => {
    const d = c.membership?.nextPaymentDate;
    return d && d >= todayStr && d <= addDays(todayStr, 7);
  });

  notifyDailyDigest(trainerId, { todayCount: todayOccurrences.length, debtNames: debt.map((c) => c.name), expiringNames: expiring.map((c) => c.name) });

  return (
    <div className="space-y-5 max-w-2xl">

      {/* Greeting */}
      <div className="flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-widest text-lime-400">{greeting()}</p>
          <h1 className="text-3xl font-bold text-zinc-50 mt-0.5 truncate">{trainerName || "Тренер"}</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Reps</p>
        </div>
        <div className="relative shrink-0">
          <DonutChart pct={attendanceRate} color="#a3e635" size={76} />
          <div className="absolute inset-0 flex items-center justify-center">
            {trainerAvatar
              ? <img src={trainerAvatar} alt="" className="w-11 h-11 rounded-full object-cover" />
              : <span className="text-xl font-bold text-zinc-100">{(trainerName || "T")[0].toUpperCase()}</span>}
          </div>
        </div>
      </div>

      {/* Revenue */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold tracking-widest text-zinc-500">ДОХОД — {periodLabel}</p>
          <div className="flex gap-0.5 bg-zinc-800/60 rounded-lg p-0.5">
            {PERIODS.map(([k, l]) => (
              <button key={k} onClick={() => setPeriod(k)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${period === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <DonutChart pct={income > 0 ? Math.min(100, attendanceRate) : 0} color="#a3e635" size={68} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[11px] font-bold text-zinc-300">{attendanceRate}%</span>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-2">
              <div>
                <div className="flex gap-0.5 mb-1.5">{[0,1,2,3].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-lime-400" />)}</div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide leading-none">Доход</p>
                <p className="text-sm font-bold text-zinc-100 mt-1">{hideRevenue ? "• • • •" : `${income.toLocaleString("ru-RU")} ₽`}</p>
              </div>
              <div>
                <div className="flex gap-0.5 mb-1.5">{[0,1,2,3].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-amber-400" />)}</div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide leading-none">Долг</p>
                <p className="text-sm font-bold text-zinc-100 mt-1">{hideRevenue ? "•" : debt.length}</p>
              </div>
              <div>
                <div className="flex gap-0.5 mb-1.5">{[0,1,2,3].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-600" />)}</div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide leading-none">Занятий</p>
                <p className="text-sm font-bold text-zinc-100 mt-1">{trainingsDone}</p>
              </div>
            </div>
            <button onClick={() => setHideRevenue((v) => !v)} className="text-zinc-600 hover:text-zinc-400 transition shrink-0 p-1">
              {hideRevenue ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
          <button onClick={() => setShowAnalytics((v) => !v)} className="w-full mt-3 pt-3 border-t border-zinc-800 flex items-center justify-center gap-1.5 text-[11px] tracking-widest text-zinc-500 hover:text-zinc-300 transition uppercase">
            <BarChart3 size={12} /> {showAnalytics ? "Скрыть аналитику" : "Показать аналитику"}
          </button>
        </div>
      </div>

      {showAnalytics && <AnalyticsPanel clients={clients} payments={payments} attendanceRate={attendanceRate} />}

      {/* Payments dashboard */}
      {(cashReceived > 0 || upcomingRenewals.length > 0) && (
        <div>
          <p className="text-xs font-semibold tracking-widest text-zinc-500 mb-2">ОПЛАТЫ — {thisMonth.slice(5)}/{thisMonth.slice(0, 4)}</p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Wallet size={16} className="text-lime-400 shrink-0" />
              <div className="flex-1">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Поступило</p>
                <p className="text-lg font-bold text-zinc-50">{hideRevenue ? "• • • •" : `${cashReceived.toLocaleString("ru-RU")} ₽`}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Платежей</p>
                <p className="text-lg font-bold text-zinc-50">{paymentsThisMonth.length}</p>
              </div>
            </div>
            {cashPending > 0 && (
              <div className="border-t border-zinc-800 pt-3 flex items-center gap-3">
                <Clock size={16} className="text-orange-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Ожидается оплата</p>
                  <p className="text-base font-bold text-orange-300">{hideRevenue ? "• • • •" : `${cashPending.toLocaleString("ru-RU")} ₽`}</p>
                </div>
              </div>
            )}
            {upcomingRenewals.length > 0 && (
              <div className="border-t border-zinc-800 pt-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1.5">Продление подписки (7 дней)</p>
                <div className="space-y-1">
                  {upcomingRenewals.map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-300">{c.name}</span>
                      <span className="text-cyan-400 text-xs">{c.membership.nextPaymentDate}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clients */}
      <div>
        <p className="text-xs font-semibold tracking-widest text-zinc-500 mb-2">ПОДОПЕЧНЫЕ</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 border-t-2 border-t-lime-400">
            <p className="text-2xl font-bold text-zinc-50">{activeClients.length}<span className="text-sm font-normal text-zinc-600">/{clients.length}</span></p>
            <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wide">Активных</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 border-t-2 border-t-cyan-400">
            <p className="text-2xl font-bold text-zinc-50">{trainedThisWeek}</p>
            <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wide">На неделе</p>
          </div>
          <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 border-t-2 ${debt.length > 0 ? "border-t-orange-400" : "border-t-zinc-700"}`}>
            <p className={`text-2xl font-bold ${debt.length > 0 ? "text-orange-400" : "text-zinc-500"}`}>{debt.length}</p>
            <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wide">Не оплатили</p>
          </div>
        </div>
      </div>

      {/* Week ahead */}
      <div>
        <p className="text-xs font-semibold tracking-widest text-zinc-500 mb-2">ВАША НЕДЕЛЯ ВПЕРЕДИ</p>
        {todayOccurrences.length === 0 && weekUpcoming.filter((o) => o.date !== todayStr).length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-8 text-center">
            <CalendarClock size={28} className="mx-auto text-zinc-700 mb-2.5" />
            <p className="text-sm text-zinc-600">Тренировок на неделю не запланировано</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {todayOccurrences.map((o) => (
              <div key={`${o.id}-${o.occDate}`} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
                <span className="text-[10px] font-semibold text-lime-400 uppercase tracking-wide w-12 shrink-0">Сегодня</span>
                <span className="font-mono text-xs text-zinc-400 w-10 shrink-0">{o.time}</span>
                <span className="text-zinc-100 truncate flex items-center gap-1 flex-1">
                  {o.clientIds.map((id) => {
                    const c = clients.find((x) => x.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1">
                        <RemainingBadge remaining={c ? remainingOf(c.membership) : null} />
                        {c?.name ?? id}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
            {weekUpcoming.filter((o) => o.date !== todayStr).map((o) => (
              <div key={`${o.id}-${o.occDate}`} className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide w-12 shrink-0">
                  {o.date === addDays(todayStr, 1) ? "Завтра" : new Date(o.date + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "short" }).toUpperCase()}
                </span>
                <span className="font-mono text-xs text-zinc-400 w-10 shrink-0">{o.time}</span>
                <span className="text-zinc-100 truncate text-sm">{o.clientIds.map((id) => clients.find((x) => x.id === id)?.name ?? id).join(", ")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {(debt.length > 0 || expiring.length > 0 || birthdays.length > 0) && (
        <div className="space-y-2">
          {debt.length > 0 && (
            <div className="flex items-start gap-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl px-3.5 py-3">
              <TriangleAlert size={15} className="text-orange-400 shrink-0 mt-0.5" />
              <p className="text-sm text-orange-300"><span className="font-semibold">Долг:</span> {debt.map((c) => c.name).join(", ")}</p>
            </div>
          )}
          {expiring.length > 0 && (
            <div className="flex items-start gap-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-3.5 py-3">
              <TriangleAlert size={15} className="text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-300"><span className="font-semibold">Заканчивается:</span> {expiring.map((c) => c.name).join(", ")}</p>
            </div>
          )}
          {birthdays.map(({ c, days }) => (
            <div key={c.id} className="flex items-start gap-2.5 bg-pink-500/10 border border-pink-500/20 rounded-xl px-3.5 py-3">
              <Cake size={15} className="text-pink-400 shrink-0 mt-0.5" />
              <p className="text-sm text-pink-300"><span className="font-semibold">{c.name}</span> — {days === 0 ? "сегодня" : `через ${days} д.`}</p>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
