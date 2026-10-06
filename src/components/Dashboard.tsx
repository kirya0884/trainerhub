import type { ReactNode } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { BarChart3, Bell, BellOff, Cake, CalendarClock, Check, ChevronDown, ChevronRight, Clock, Eye, EyeOff, Hourglass, Play, TriangleAlert, Wallet } from "lucide-react";
import { fetchDashboardData } from "../lib/dashboard";
import type { DashboardClient, DashboardPayment } from "../lib/dashboard";
import { expandBookings } from "../lib/bookings";
import type { Booking } from "../lib/bookings";
import { notifyDailyDigest, notifyClientStarted, notifyClientFinished, notifyUpcomingBooking, requestNotifyPermission } from "../lib/notify";
import { supabase } from "../lib/supabase";
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed, isPushSupported } from "../lib/pushSubscribe";
import AnalyticsPanel from "./AnalyticsPanel";
import { today, addDays } from "../lib/format";
import RemainingBadge from "./RemainingBadge";
import { remainingOf } from "../lib/clients";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер"; };
// Ш4б: обычный заголовок раздела вместо мелкого капса с разрядкой над каждым блоком
const SectionTitle = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="flex items-center justify-between mb-2"><h2 className="text-[17px] font-bold">{children}</h2>{right}</div>
);
// Минуты до начала (отрицательные — уже идёт)
const minsUntil = (date: string, time: string) => Math.round((new Date(`${date}T${time || "00:00"}:00`).getTime() - Date.now()) / 60000);

function DonutChart({ pct, size = 72 }: { pct: number; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(1, pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-zinc-800" strokeWidth={8} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-lime-400" strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
    </svg>
  );
}


const PERIODS = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"]] as const;

export default function Dashboard({ trainerId, bookings, onOpenClient, onOpenOccurrence, recentSlot }: { trainerId: string; bookings: Booking[]; onOpenClient: (id: string) => void; onOpenOccurrence?: (id: string, occDate: string) => void; recentSlot?: ReactNode }) {
  // Имя клиента как ссылка на карточку. Наследует цвет родителя, поэтому одинаково
  // работает в белом расписании и в цветных алертах.
  // ponytail: тап-зону 44px по вертикали внутри строки текста не сделать, не разорвав абзац.
  // py-1 расширяет область нажатия, -my-1 гасит прирост высоты — вёрстка не съезжает,
  // а по горизонтали ничего не добавляем, иначе запятые-разделители отлипнут от имён.
  const ClientLink = ({ id, name, className = "" }: { id: string; name: string; className?: string }) => (
    <button
      type="button"
      onClick={() => onOpenClient(id)}
      title={`Открыть карточку: ${name}`}
      className={`inline py-1 -my-1 rounded-lg text-left underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current transition ${className}`}
    >{name}</button>
  );
  const [data, setData] = useState<{ clients: DashboardClient[]; payments: DashboardPayment[] } | null>(null);
  const [period, setPeriod] = useState<string>("month");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showPayments, setShowPayments] = useState(false);
  // Ш4б: какой чип «Требует внимания» раскрыт (имена под ним)
  const [attn, setAttn] = useState<"debt" | "exp" | "bday" | null>(null);
  const [showMoney, setShowMoney] = useState(false);
  const [hideRevenue, setHideRevenue] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    requestNotifyPermission();
    fetchDashboardData(trainerId).then(setData).catch((e: Error) => setLoadError(e.message));
  }, [trainerId]);

  useEffect(() => {
    if (isPushSupported()) isPushSubscribed().then(setPushEnabled).catch((e) => console.error("[Dashboard] статус push:", e));
  }, []);

  // Real-time: detect when a client starts/finishes a workout
  const prevActiveRef = useRef<Record<string, boolean>>({});
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => {
    const channel = supabase.channel(`trainer-clients-${trainerId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "clients", filter: `trainer_id=eq.${trainerId}` }, (payload) => {
        const c = payload.new as any;
        const isNowActive = !!(c.active_session && c.active_session.status === "active");
        const wasActive = prevActiveRef.current[c.id] ?? false;
        const name = dataRef.current?.clients.find((x) => x.id === c.id)?.name ?? "Клиент";
        if (!wasActive && isNowActive) notifyClientStarted(name);
        if (wasActive && !isNowActive && c.active_session?.status === "done") notifyClientFinished(name);
        prevActiveRef.current[c.id] = isNowActive;
        // Refresh data to update isTraining badge
        fetchDashboardData(trainerId).then(setData).catch(console.error);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [trainerId]);

  // ⚠️ Rules of Hooks — ALL hooks must appear before any early return
  useEffect(() => {
    if (!data) return;
    const ts = today();
    const act = data.clients.filter((c) => c.status !== "left");
    const dbt = act.filter((c) => c.membership.type === "sessions" && c.membership.remaining !== "" && c.membership.remaining != null && Number(c.membership.remaining) <= 0);
    const exp = act.filter((c) => { const r = Number(c.membership.remaining); return c.membership.type === "sessions" && c.membership.remaining !== "" && c.membership.remaining != null && (r === 1 || r === 2); });
    const todayOccs = expandBookings(bookings, ts, ts).sort((a, b) => a.time.localeCompare(b.time));
    notifyDailyDigest(trainerId, { todayCount: todayOccs.length, debtNames: dbt.map((c) => c.name), expiringNames: exp.map((c) => c.name) });
    const nowMs = Date.now();
    for (const occ of todayOccs) {
      if (!occ.time) continue;
      const [hh, mm] = occ.time.split(":").map(Number);
      const occMs = new Date(ts + "T00:00:00").getTime() + (hh * 60 + mm) * 60000;
      const diffMin = (occMs - nowMs) / 60000;
      if (diffMin >= 50 && diffMin <= 70) notifyUpcomingBooking("trainer", trainerId, ts, occ.time);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainerId, data?.clients?.length, bookings.length]);

  // B20: скелетон в потоке страницы вместо блока на 100vh — вкладки остаются на месте,
  // страница не схлопывается при появлении данных. Классы (а не инлайновые стили) —
  // чтобы работала светлая тема: она переопределяет bg-zinc-* через html.light-theme.
  if (!data) return (
    <div className="space-y-5 max-w-2xl" role="status" aria-label={loadError ? "Ошибка загрузки" : "Загрузка дашборда"}>
      {loadError ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-center space-y-3">
          <p className="text-sm text-red-400">Ошибка загрузки: {loadError}</p>
          <button
            onClick={() => { setLoadError(null); fetchDashboardData(trainerId).then(setData).catch((e: Error) => setLoadError(e.message)); }}
            className="text-sm font-medium text-lime-400 border border-lime-400 rounded-lg px-4 py-1.5 hover:bg-lime-400/10 transition"
          >Повторить</button>
        </div>
      ) : (
        // ponytail: геометрию повторяем приблизительно — сколько будет строк расписания и алертов,
        // заранее неизвестно, поэтому скачок уменьшается, но не исчезает полностью.
        <div className="animate-pulse space-y-5" aria-hidden="true">
          <div className="pt-1">
            <div className="h-3 w-32 bg-zinc-800 rounded-lg" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-32 bg-zinc-800 rounded-lg" />
            <div className="h-24 bg-zinc-900 border border-zinc-800 rounded-2xl" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-28 bg-zinc-800 rounded-lg" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-20 bg-zinc-900 border border-zinc-800 rounded-2xl" />
              <div className="h-20 bg-zinc-900 border border-zinc-800 rounded-2xl" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-3 w-36 bg-zinc-800 rounded-lg" />
            <div className="space-y-1.5">
              <div className="h-11 bg-zinc-900 border border-zinc-800 rounded-xl" />
              <div className="h-11 bg-zinc-900 border border-zinc-800 rounded-xl" />
              <div className="h-11 bg-zinc-900 border border-zinc-800 rounded-xl" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
  const { clients, payments } = data;
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));
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
  const debt = activeClients.filter((c) => c.membership.type === "sessions" && c.membership.remaining !== "" && c.membership.remaining != null && Number(c.membership.remaining) <= 0);
  const expiring = activeClients.filter((c) => { const r = Number(c.membership.remaining); return c.membership.type === "sessions" && c.membership.remaining !== "" && c.membership.remaining != null && (r === 1 || r === 2); });
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
  const trainedThisWeek = expandBookings(bookings, addDays(todayStr, -6), todayStr).filter((o) => o.status === "done").length;
  const periodLabel = period === "day" ? "сегодня" : period === "week" ? "неделя" : new Date(todayStr + "T00:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

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



  // Ш4б: ближайшая тренировка — идущая или следующая сегодня, иначе ближайшая на неделе
  const tomorrowStr = addDays(todayStr, 1);
  const nextOcc =
    todayOccurrences.find((o) => o.status === "scheduled" && o.time && minsUntil(o.date, o.time) > -(o.duration || 60))
    ?? weekUpcoming.filter((o) => o.date !== todayStr).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const weekday = (d: string) => { const w = new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "long" }); return w.charAt(0).toUpperCase() + w.slice(1); };
  const dayLabel = (d: string) => d === todayStr ? "Сегодня" : d === tomorrowStr ? "Завтра" : weekday(d);
  const whenLabel = (o: { date: string; time: string }) => {
    if (o.date !== todayStr) return `${dayLabel(o.date)}, ${o.time}`;
    const m = minsUntil(o.date, o.time);
    if (m <= 0) return "Идёт сейчас";
    return m < 60 ? `Через ${m} мин` : `Через ${Math.floor(m / 60)} ч ${m % 60} мин`;
  };
  const names = (ids: string[]) => ids.map((id, i) => {
    const c = clients.find((x) => x.id === id);
    return <Fragment key={id}>{i > 0 && ", "}<ClientLink id={id} name={c?.name ?? id} /></Fragment>;
  });
  const statusText: Record<string, string> = { done: "Проведена", "no-show": "Не пришёл" };
  const upcomingNotToday = weekUpcoming.filter((o) => o.date !== todayStr).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Ш4б: приветствие обычным заголовком; имя и аватар — в шапке App.tsx */}
      <div className="flex items-center gap-2 pt-1">
        <div className="min-w-0">
          <p className="text-sm text-zinc-500 first-letter:uppercase">{new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">{greeting()}</h1>
        </div>
        {isPushSupported() && (
          <button
            onClick={async () => {
              setPushLoading(true);
              // finally: при ошибке сети кнопка раньше навсегда оставалась в «загрузке»
              try {
                if (pushEnabled) {
                  await unsubscribeFromPush(trainerId);
                  setPushEnabled(false);
                } else {
                  const ok = await subscribeToPush(trainerId);
                  setPushEnabled(ok);
                }
              } catch (e) {
                console.error("[Dashboard] push:", e);
                alert("Не удалось изменить уведомления. Попробуйте ещё раз.");
              } finally {
                setPushLoading(false);
              }
            }}
            disabled={pushLoading}
            title={pushEnabled ? "Push включены — нажми чтобы отключить" : "Включить push-уведомления"}
            aria-label={pushEnabled ? "Отключить push-уведомления" : "Включить push-уведомления"}
            className="ml-auto w-11 h-11 flex items-center justify-center rounded-xl transition text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900"
          >
            {pushEnabled ? <Bell size={20} className="text-lime-400" /> : <BellOff size={20} />}
          </button>
        )}
      </div>

      {/* Ш4б: ближайшая тренировка — главный блок экрана */}
      {nextOcc ? (
        <div className="relative overflow-hidden bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
          <div className="pointer-events-none absolute -right-16 -top-16 w-48 h-48 rounded-full bg-lime-400/15 blur-3xl" />
          <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-lime-400/15 text-lime-400 text-xs font-semibold">
            <Clock size={13} /> {whenLabel(nextOcc)}
          </span>
          <div className="flex items-end gap-4 mt-3">
            <p className="text-5xl font-extrabold tracking-tight leading-none">{nextOcc.time || "—"}</p>
            <div className="min-w-0 pb-0.5">
              <p className="text-lg font-bold leading-snug flex flex-wrap items-center gap-x-1.5">
                {nextOcc.clientIds.map((id) => {
                  const c = clients.find((x) => x.id === id);
                  return <RemainingBadge key={id} remaining={c ? remainingOf(c.membership) : null} />;
                })}
                <span className="min-w-0">{names(nextOcc.clientIds)}</span>
              </p>
              {nextOcc.dayName && <p className="text-sm text-zinc-400 truncate">{nextOcc.dayName}</p>}
            </div>
          </div>
          {onOpenOccurrence && (
            <button
              onClick={() => onOpenOccurrence(nextOcc.id, nextOcc.occDate)}
              className="relative mt-4 w-full h-12 rounded-2xl bg-lime-400 text-zinc-950 font-bold flex items-center justify-center gap-2 hover:bg-lime-300 transition active:scale-[0.98]"
            >
              {nextOcc.date === todayStr ? <><Play size={18} /> Начать тренировку</> : <><CalendarClock size={18} /> Открыть запись</>}
            </button>
          )}
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl px-4 py-8 text-center">
          <CalendarClock size={28} className="mx-auto text-zinc-600 mb-2.5" />
          <p className="text-sm text-zinc-500">Тренировок на неделю не запланировано</p>
        </div>
      )}

      {/* Расписание дня: проведённые приглушены и с галочкой, предстоящие — с запуском */}
      {todayOccurrences.length > 0 && (
        <div>
          <SectionTitle>Сегодня</SectionTitle>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800">
            {todayOccurrences.map((o) => {
              const finished = o.status !== "scheduled";
              return (
                <div key={`${o.id}-${o.occDate}`} className={`flex items-center gap-3 px-4 min-h-[60px] py-2 ${finished ? "opacity-60" : ""}`}>
                  <span className="w-12 shrink-0 font-bold">{o.time}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{names(o.clientIds)}</p>
                    <p className="text-xs text-zinc-500 truncate">{statusText[o.status] ?? o.dayName ?? ""}</p>
                  </div>
                  {o.status === "done"
                    ? <Check size={18} className="shrink-0 text-lime-400" />
                    : !finished && onOpenOccurrence && (
                      // B24: провести тренировку прямо из расписания
                      <button
                        onClick={() => onOpenOccurrence(o.id, o.occDate)}
                        title="Провести тренировку"
                        aria-label={`Провести тренировку в ${o.time}`}
                        className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl text-zinc-500 hover:text-lime-400 hover:bg-lime-400/10 transition"
                      >
                        <Play size={18} />
                      </button>
                    )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {upcomingNotToday.length > 0 && (
        <div>
          <SectionTitle>На неделе</SectionTitle>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800">
            {upcomingNotToday.map((o) => (
              <div key={`${o.id}-${o.occDate}`} className="flex items-center gap-3 px-4 py-3">
                <span className="shrink-0 text-sm text-zinc-400 whitespace-nowrap">{dayLabel(o.date)}, <span className="font-semibold text-zinc-200">{o.time}</span></span>
                <span className="min-w-0 truncate text-sm">{names(o.clientIds)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* B22 → Ш4б: «Требует внимания» — чипы-счётчики, тап раскрывает имена под ними */}
      {(debt.length > 0 || expiring.length > 0 || birthdays.length > 0) && (
        <div>
          <SectionTitle>Требует внимания</SectionTitle>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {([
              debt.length > 0 && { k: "debt" as const, icon: <TriangleAlert size={15} className="text-orange-400" />, label: `Долг: ${debt.length}` },
              expiring.length > 0 && { k: "exp" as const, icon: <Hourglass size={15} className="text-yellow-400" />, label: `Заканчивается: ${expiring.length}` },
              birthdays.length > 0 && { k: "bday" as const, icon: <Cake size={15} className="text-pink-400" />, label: `ДР: ${birthdays.length}` },
            ].filter(Boolean) as { k: "debt" | "exp" | "bday"; icon: ReactNode; label: string }[]).map((chip) => (
              <button
                key={chip.k}
                onClick={() => setAttn((v) => (v === chip.k ? null : chip.k))}
                aria-expanded={attn === chip.k}
                className={`shrink-0 inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full border text-sm font-medium transition ${attn === chip.k ? "bg-zinc-800 border-zinc-600 text-zinc-100" : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700"}`}
              >
                {chip.icon} {chip.label}
              </button>
            ))}
          </div>
          {attn && (
            <div className="mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm">
              {attn === "debt" && <p className="text-orange-300">{debt.map((c, i) => <Fragment key={c.id}>{i > 0 && ", "}<ClientLink id={c.id} name={c.name} /></Fragment>)}</p>}
              {attn === "exp" && <p className="text-yellow-300">{expiring.map((c, i) => <Fragment key={c.id}>{i > 0 && ", "}<ClientLink id={c.id} name={c.name} /></Fragment>)}</p>}
              {attn === "bday" && <p className="text-pink-300">{birthdays.map(({ c, days }, i) => (
                <Fragment key={c.id}>{i > 0 && ", "}<ClientLink id={c.id} name={c.name} className="font-semibold" /> — {days === 0 ? "сегодня" : `через ${days} д.`}</Fragment>
              ))}</p>}
            </div>
          )}
        </div>
      )}

      {/* B05: ряд недавних подопечных приходит слотом из App — там живут данные,
          история открытий и закрепление. Дашборд только ставит его на нужное место. */}
      {recentSlot}

      {/* B21: деньги свёрнуты в одну строку. Внутри — прежние блоки дохода, аналитики
           и оплат без единой правки; фрагмент не создаёт узла, поэтому space-y-5 не едет. */}
      <button
        onClick={() => setShowMoney((v) => !v)}
        aria-expanded={showMoney}
        className="w-full flex items-center gap-2.5 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-left transition hover:border-zinc-700"
      >
        <Wallet size={16} className="text-lime-400 shrink-0" />
        <span className="text-sm font-semibold text-zinc-400 truncate">Доход: {periodLabel}</span>
        <span className="ml-auto text-base font-bold text-zinc-100 shrink-0">
          {hideRevenue ? "• • • •" : `${income.toLocaleString("ru-RU")} ₽`}
        </span>
        {showMoney
          ? <ChevronDown size={16} className="shrink-0 text-zinc-500" />
          : <ChevronRight size={16} className="shrink-0 text-zinc-500" />}
      </button>

      {showMoney && (<>
      {/* Revenue */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-zinc-400">Доход: {periodLabel}</p>
          <div className="flex gap-0.5 bg-zinc-800/60 rounded-lg p-0.5">
            {PERIODS.map(([k, l]) => (
              <button key={k} onClick={() => setPeriod(k)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${period === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <DonutChart pct={income > 0 ? Math.min(100, attendanceRate ?? 0) : 0} size={68} />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[11px] font-bold text-zinc-300">{attendanceRate != null ? `${attendanceRate}%` : "—"}</span>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-2">
              <div>
                <div className="flex gap-0.5 mb-1.5">{[0,1,2,3].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-lime-400" />)}</div>
                <p className="text-xs text-zinc-500 leading-none">Доход</p>
                <p className="text-sm font-bold text-zinc-100 mt-1">{hideRevenue ? "• • • •" : `${income.toLocaleString("ru-RU")} ₽`}</p>
              </div>
              <div>
                <div className="flex gap-0.5 mb-1.5">{[0,1,2,3].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-amber-400" />)}</div>
                <p className="text-xs text-zinc-500 leading-none">Долг</p>
                <p className="text-sm font-bold text-zinc-100 mt-1">{hideRevenue ? "•" : debt.length}</p>
              </div>
              <div>
                <div className="flex gap-0.5 mb-1.5">{[0,1,2,3].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-600" />)}</div>
                <p className="text-xs text-zinc-500 leading-none">Занятий</p>
                <p className="text-sm font-bold text-zinc-100 mt-1">{trainingsDone}</p>
              </div>
            </div>
            <button onClick={() => setHideRevenue((v) => !v)} className="text-zinc-600 hover:text-zinc-400 transition shrink-0 p-1">
              {hideRevenue ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
          <button onClick={() => setShowAnalytics((v) => !v)} className="w-full mt-3 pt-3 border-t border-zinc-800 flex items-center justify-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition">
            <BarChart3 size={12} /> {showAnalytics ? "Скрыть аналитику" : "Показать аналитику"}
          </button>
        </div>
      </div>

      {showAnalytics && <AnalyticsPanel clients={clients} payments={payments} attendanceRate={attendanceRate} />}

      {/* Payments dashboard */}
      {(cashReceived > 0 || upcomingRenewals.length > 0) && (
        <div>
          <button onClick={() => setShowPayments(p => !p)}
            className="flex items-center justify-between w-full mb-2">
            <p className="text-sm font-semibold text-zinc-400">Оплаты за {thisMonth.slice(5)}.{thisMonth.slice(0, 4)}</p>
            {showPayments ? <ChevronDown size={14} className="text-zinc-600" /> : <ChevronRight size={14} className="text-zinc-600" />}
          </button>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Wallet size={16} className="text-lime-400 shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-zinc-500">Поступило</p>
                <p className="text-lg font-bold text-zinc-50">{hideRevenue ? "• • • •" : `${cashReceived.toLocaleString("ru-RU")} ₽`}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-500">Платежей</p>
                <p className="text-lg font-bold text-zinc-50">{paymentsThisMonth.length}</p>
              </div>
            </div>
            {cashPending > 0 && (
              <div className="border-t border-zinc-800 pt-3 flex items-center gap-3">
                <Clock size={16} className="text-orange-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-zinc-500">Ожидается оплата</p>
                  <p className="text-base font-bold text-orange-300">{hideRevenue ? "• • • •" : `${cashPending.toLocaleString("ru-RU")} ₽`}</p>
                </div>
              </div>
            )}
            {upcomingRenewals.length > 0 && (
              <div className="border-t border-zinc-800 pt-3">
                <p className="text-xs text-zinc-500 mb-1.5">Продление подписки (7 дней)</p>
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

      {/* Payments expanded list */}
      {showPayments && paymentsThisMonth.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-1.5">
          <p className="text-xs text-zinc-500 mb-1">Все платежи за месяц</p>
          {[...paymentsThisMonth].sort((a, b) => b.date.localeCompare(a.date)).map((p, i) => {
            const cName = clientById[p.clientId]?.name ?? "—";
            const badge = p.payStatus === "deferred"
              ? <span className="text-[10px] text-orange-400 bg-orange-400/10 rounded-lg px-1 shrink-0">ожидание</span>
              : p.payStatus === "installment"
              ? <span className="text-[10px] text-yellow-400 bg-yellow-400/10 rounded-lg px-1 shrink-0">рассрочка</span>
              : null;
            return (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-zinc-500 text-xs w-[44px] shrink-0">{p.date.slice(5).replace("-", ".")}</span>
                <span className="flex-1 text-zinc-300 truncate"><ClientLink id={p.clientId} name={cName} /></span>
                {badge}
                <span className={`font-semibold shrink-0 ${p.payStatus === "paid" ? "text-lime-400" : "text-orange-300"}`}>
                  {hideRevenue ? "•••" : `${p.amount.toLocaleString("ru-RU")} ₽`}
                </span>
              </div>
            );
          })}
        </div>
      )}
      </>)}


      {/* Clients */}
      <div>
        <SectionTitle>Подопечные</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 border-t-2 border-t-lime-400">
            <p className="text-2xl font-bold text-zinc-50">{activeClients.length}<span className="text-sm font-normal text-zinc-600">/{clients.length}</span></p>
            <p className="text-xs text-zinc-500 mt-1">Активных</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 border-t-2 border-t-cyan-400">
            <p className="text-2xl font-bold text-zinc-50">{trainedThisWeek}</p>
            <p className="text-xs text-zinc-500 mt-1">На неделе</p>
          </div>
        </div>
      </div>

    </div>
  );
}
