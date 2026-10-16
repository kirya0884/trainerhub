import type { ReactNode } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Cake, CalendarClock, Check, ChevronRight, Clock, Hourglass, Play, TriangleAlert, Wallet } from "lucide-react";
import { fetchDashboardData } from "../lib/dashboard";
import type { DashboardClient, DashboardPayment } from "../lib/dashboard";
import { expandBookings } from "../lib/bookings";
import type { Booking } from "../lib/bookings";
import { notifyDailyDigest, notifyClientStarted, notifyClientFinished, notifyUpcomingBooking, requestNotifyPermission } from "../lib/notify";
import { supabase } from "../lib/supabase";
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed, isPushSupported } from "../lib/pushSubscribe";
import { today, addDays } from "../lib/format";
import RemainingBadge from "./RemainingBadge";
import { remainingOf } from "../lib/clients";
import { notify } from "../lib/dialog";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер"; };
// Ш4б: обычный заголовок раздела вместо мелкого капса с разрядкой над каждым блоком
const SectionTitle = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="flex items-center justify-between mb-2"><h2 className="text-[17px] font-bold">{children}</h2>{right}</div>
);
// Минуты до начала (отрицательные — уже идёт)
const minsUntil = (date: string, time: string) => Math.round((new Date(`${date}T${time || "00:00"}:00`).getTime() - Date.now()) / 60000);

export default function Dashboard({ trainerId, bookings, onOpenClient, onOpenOccurrence, recentSlot, onOpenFinance }: { trainerId: string; bookings: Booking[]; onOpenClient: (id: string) => void; onOpenFinance: () => void; onOpenOccurrence?: (id: string, occDate: string) => void; recentSlot?: ReactNode }) {
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
  // Ш4б: какой чип «Требует внимания» раскрыт (имена под ним)
  const [attn, setAttn] = useState<"debt" | "exp" | "bday" | null>(null);
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
  const todayStr = today();

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
  const trainedThisWeek = expandBookings(bookings, addDays(todayStr, -6), todayStr).filter((o) => o.status === "done").length;

  // Карточка «Финансы»: поступления текущего месяца и все неоплаченные (подробности — на экране финансов)
  const thisMonth = todayStr.slice(0, 7);
  const paymentsThisMonth = payments.filter((p) => p.date.startsWith(thisMonth));
  const cashReceived = paymentsThisMonth.filter((p) => p.payStatus === "paid").reduce((s, p) => s + p.amount, 0);
  const monthName = new Date(todayStr + "T00:00:00").toLocaleDateString("ru-RU", { month: "long" });
  const cashPending = payments.filter((p) => p.payStatus !== "paid").reduce((s, p) => s + p.amount, 0);



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
                notify("Не удалось изменить уведомления. Попробуйте ещё раз.");
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

      {/* Деньги — отдельный экран «Финансы»; здесь только итог месяца и вход */}
      <button onClick={onOpenFinance} className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3.5 text-left transition hover:border-zinc-700">
        <span className="w-10 h-10 rounded-xl bg-lime-400/15 text-lime-400 flex items-center justify-center shrink-0"><Wallet size={19} /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-zinc-400">Финансы · {monthName}</span>
          <span className="block text-lg font-bold text-zinc-100 leading-tight">{cashReceived.toLocaleString("ru-RU")} ₽ <span className="text-sm font-normal text-zinc-500">поступило</span></span>
          {(cashPending > 0 || debt.length > 0) && (
            <span className="block text-[13px] text-orange-300 truncate">
              {[cashPending > 0 ? `ждут оплаты ${cashPending.toLocaleString("ru-RU")} ₽` : null, debt.length > 0 ? `пакет закончился у ${debt.length}` : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        <ChevronRight size={18} className="shrink-0 text-zinc-500" />
      </button>

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
