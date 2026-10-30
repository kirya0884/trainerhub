import { useEffect, useRef, useState } from "react";
import { loadViewState, saveViewState } from "../lib/viewState";
import { CalendarDays, Check, ClipboardList, UserX, Bell, ChevronLeft, ChevronRight, Pencil, Plus, Play, Repeat, Share, Trash2 } from "lucide-react";
import { bookingsOverlap, expandBookings, toMin } from "../lib/bookings";
import type { Booking, Occurrence } from "../lib/bookings";
import * as clientsApi from "../lib/clients";
import type { ClientListItem } from "../lib/clients";
import BookingModal, { BOOKING_STATUS_COLOR, BOOKING_STATUS_LABEL } from "./BookingModal";
import { useActiveWorkout } from "../hooks/useActiveWorkout";
import ModalShell from "./ModalShell";
import RemindModal from "./RemindModal";
import RenewModal from "./RenewModal";
import NoShowModal, { type NoShowReason } from "./NoShowModal";
import { bookingsToIcs, downloadIcs } from "../lib/ics";
import { today as todayFn, addDays, addMonths, plural, toDateStr } from "../lib/format";
import { ask, notify } from "../lib/dialog";
import { track } from "../lib/events";

const WEEKDAYS_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MODES = [["day", "День"], ["days3", "3 дня"], ["week", "Неделя"], ["month", "Месяц"]] as const;
type Mode = (typeof MODES)[number][0];

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const startOfWeekMon = (s: string) => { const d = new Date(s + "T00:00:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return toDateStr(d); };
// month: "long" — полное название месяца (требование: не сокращать до "июн.")
const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const fmtLong = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const fmtMonth = (s: string) => capFirst(new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", ""));
const lastDayOfMonth = (s: string) => { const d = new Date(s + "T00:00:00"); return toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };

const fromMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const HOUR_START = 6, HOUR_END = 24;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
// 48 px на час: в часовую плитку влезают время и полное имя в две строки
// (колонка недели на телефоне ~92 px). Сетка прокручивается по вертикали, места хватает.
const ROW_H = 48; // px за час

export default function CalendarView({ trainerId, bookingsHook, clients, reloadClients, onOpenClient, onOpenClientPlans, openBooking, newBookingClientId, openOccurrence }: { trainerId: string; bookingsHook: ReturnType<typeof import("../hooks/useBookings").useBookings>; clients: ClientListItem[]; reloadClients: () => void; onOpenClient: (id: string) => void; onOpenClientPlans: (id: string) => void; openBooking?: boolean; newBookingClientId?: string; openOccurrence?: { id: string; occDate: string } }) {
  const { bookings, addBooking, updateBooking, deleteBooking, markOccurrence, cancelOccurrence, noShowOccurrence, rescheduleOccurrence } = bookingsHook;
  // B12: запоминаем режим просмотра, но НЕ дату — вернувшись через час, ожидаешь
  // увидеть текущую неделю, а не ту, на которой ушёл.
  const [mode, setMode] = useState<Mode>(() => loadViewState<Mode>("calendar-mode", "week"));
  useEffect(() => { saveViewState("calendar-mode", mode); }, [mode]);
  const today = todayFn();
  const [anchor, setAnchor] = useState(today);
  // createdId — запись, созданная этой формой, если отметка после создания сорвалась (повтор не создаёт вторую)
  const [modal, setModal] = useState<{ booking?: Booking; date?: string; time?: string; occDate?: string; clientId?: string; createdId?: string } | null>(null);
  // B13: FAB просит сразу открыть форму новой записи на сегодня. Подопечного запоминаем
  // в самой форме: флаги из навигации App снимает сразу после открытия экрана.
  useEffect(() => { if (openBooking) setModal({ date: todayFn(), clientId: newBookingClientId }); }, [openBooking]); // eslint-disable-line react-hooks/exhaustive-deps
  // B24: дашборд попросил открыть конкретную запись — ставим календарь на её дату
  // и раскрываем карточку. Запрос разовый: ждём загрузки записей, открываем и забываем —
  // раньше карточка всплывала заново при каждом обновлении записей. Если запись успели
  // удалить, find вернёт undefined — ничего не откроется.
  const [pendingOcc, setPendingOcc] = useState(openOccurrence ?? null);
  useEffect(() => { if (openOccurrence) setPendingOcc(openOccurrence); }, [openOccurrence]);
  useEffect(() => { if (pendingOcc) setAnchor(pendingOcc.occDate); }, [pendingOcc]);
  useEffect(() => {
    if (!pendingOcc || bookingsHook.loading) return;
    const { id, occDate } = pendingOcc;
    // Занятие серии могли перенести на другой день (п.24) — ищем шире и встаём на его дату
    const occ = expandBookings(bookings, addDays(occDate, -366), addDays(occDate, 366)).find((o) => o.id === id && o.occDate === occDate);
    if (occ) { setAnchor(occ.date); setQuickView(occ); }
    setPendingOcc(null);
  }, [pendingOcc, bookings, bookingsHook.loading]);
  const [quickView, setQuickView] = useState<Occurrence | null>(null);
  const [noShow, setNoShow] = useState<Occurrence | null>(null);
  const [delOcc, setDelOcc] = useState<Occurrence | null>(null);
  const [renew, setRenew] = useState<string | null>(null);
  const [remind, setRemind] = useState<{ id: string; date: string; time: string } | null>(null);
  // П.14 аудита: статус и списания всех подопечных — одна серверная транзакция. Раньше
  // статус и каждое списание шли отдельными запросами: сбой на втором подопечном, повтор —
  // и первый списывался ещё раз. Теперь либо прошло всё, либо ничего; повтор того же
  // вызова (ответ не дошёл) сервер узнаёт по статусу и ключу списания и не списывает снова.
  const markNoShow = async (o: Occurrence, reasons: Record<string, NoShowReason>) => {
    const b = findBookingById(o.id);
    if (!b) return;
    const why = o.clientIds.map((id) => (o.clientIds.length > 1 ? `${clientName(id)} — ` : "") + reasons[id].toLowerCase()).join(", ");
    try {
      await noShowOccurrence(b, o.occDate, [o.note, `Не пришёл: ${why}`].filter(Boolean).join(" · "),
        o.clientIds.filter((id) => reasons[id] !== "Уважительная"));
      reloadClients();
      track("action", "no_show", { clients: o.clientIds.length, excused: o.clientIds.filter((id) => reasons[id] === "Уважительная").length });
      setNoShow(null);
    } catch (e) {
      console.error("[CalendarView] не пришёл:", e);
      notify("Не удалось сохранить. Проверь интернет и попробуй ещё раз.");
    }
  };
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [confirmPending, setConfirmPending] = useState<{ text: string; onConfirm: () => void } | null>(null);
  const askConfirm = (text: string, onConfirm: () => void) => setConfirmPending({ text, onConfirm });
  // Тренировка по записи — совместная (на всех из записи) и живёт на уровне приложения:
  // сворачивается, переживает переходы и перезагрузку; запись отмечается, когда завершат все
  const workout = useActiveWorkout();
  const startGroup = async (o: Occurrence) => {
    const list = o.clientIds.map((id) => { const c = clients.find((x) => x.id === id); return { id, name: clientName(id), color: c?.color || "#c6ff3d", remaining: c?.remaining ?? null }; });
    if (!(await clientsApi.confirmEmptyMembership(list))) return;
    const ok = workout.start({
      kind: "group", id: String(Date.now()),
      clients: list,
      booking: { id: o.id, occDate: o.occDate, isOccurrence: o.isOccurrence, clientIds: o.clientIds },
    });
    if (!ok) notify("Одна тренировка уже идёт — заверши или сверни её.");
  };

  const weekStart = startOfWeekMon(anchor);
  const weekEnd = addDays(weekStart, 6);
  const monthStart = anchor.slice(0, 7) + "-01";
  const monthEnd = lastDayOfMonth(anchor);
  const gridStart = startOfWeekMon(monthStart);
  const gridEnd = addDays(startOfWeekMon(monthEnd), 6);

  // К1: «3 дня» — середина между днём и неделей; на телефоне колонки выходят ~100 px
  // и имена видно целиком, в отличие от недельных ~44 px.
  const days3End = addDays(anchor, 2);
  const rangeStart = mode === "day" || mode === "days3" ? anchor : mode === "week" ? weekStart : gridStart;
  const rangeEnd = mode === "day" ? anchor : mode === "days3" ? days3End : mode === "week" ? weekEnd : gridEnd;
  // А5: подопечный удаляется мягко (уходит в корзину), связи booking_clients при этом
  // сохраняются — иначе восстановление из корзины вернуло бы клиента без его тренировок.
  // Поэтому чиним чтением: имена берём только у живых, а запись, где живых не осталось,
  // в расписании не показываем. Вернули клиента — запись вернулась сама, без записи в базу.
  const liveIds = new Set(clients.map((c) => c.id));
  const withLiveClients = <T extends { clientIds: string[] }>(list: T[]): T[] =>
    list
      .map((o) => ({ ...o, clientIds: o.clientIds.filter((id) => liveIds.has(id)) }))
      .filter((o) => o.clientIds.length > 0);

  const occurrences = withLiveClients(expandBookings(bookings, rangeStart, rangeEnd));
  const listDays = mode === "day" ? [anchor]
    : mode === "days3" ? Array.from({ length: 3 }, (_, i) => addDays(anchor, i))
    : mode === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [];
  const gridDays = mode === "month" ? Array.from({ length: (new Date(gridEnd + "T00:00:00").getTime() - new Date(gridStart + "T00:00:00").getTime()) / 86400000 + 1 }, (_, i) => addDays(gridStart, i)) : [];

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "—";
  const clientColor = (id: string) => clients.find((c) => c.id === id)?.color || "#c6ff3d";

  // Неделя на телефоне шире экрана — держим выбранный день в начале видимой части
  const gridScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = gridScroll.current;
    if (mode !== "week" || !el) return;
    const col = el.querySelector<HTMLElement>(`[data-day="${anchor}"]`);
    if (col) el.scrollTo({ left: col.offsetLeft, behavior: "smooth" });
  }, [mode, anchor]);
  const findBookingById = (id: string) => bookings.find((b) => b.id === id);

  const navTitle = mode === "day" ? fmtLong(anchor)
    : mode === "days3" ? `${fmt(anchor)} – ${fmt(days3End)}`
    : mode === "week" ? `${fmt(weekStart)} – ${fmt(weekEnd)}` : fmtMonth(anchor);
  const goPrev = () => setAnchor(mode === "day" ? addDays(anchor, -1) : mode === "days3" ? addDays(anchor, -3) : mode === "week" ? addDays(anchor, -7) : addMonths(anchor, -1));
  const goNext = () => setAnchor(mode === "day" ? addDays(anchor, 1) : mode === "days3" ? addDays(anchor, 3) : mode === "week" ? addDays(anchor, 7) : addMonths(anchor, 1));
  const goToday = () => setAnchor(today);

  // Перенос занятия drag-and-drop на другой день (вид «Месяц», время не меняется); при конфликте — подтверждение.
  const onDropDay = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDay(null);
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;
    let parsed: { id: string; occDate: string };
    try { parsed = JSON.parse(raw); } catch { return; }
    const { id, occDate } = parsed;
    if (occDate === targetDate) return;
    const b = findBookingById(id);
    if (!b) return;
    const moved = { ...b, date: targetDate, occDate: targetDate, isOccurrence: true };
    const conflict = occurrences.some((o) => o.date === targetDate && o.id !== id && bookingsOverlap(moved as any, o));
    if (conflict && !(await ask("На эту дату уже есть запись в это же время. Перенести всё равно?", { ok: "Перенести" }))) return;
    try { await rescheduleOccurrence(b, occDate, targetDate); }
    catch (e) { console.error("[CalendarView] onDropDay:", e); notify("Не удалось перенести запись."); }
  };

  // Перенос занятия в сетке «День»/«Неделя» — день и время определяются позицией отпускания в ячейке.
  const onDropAt = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDay(null);
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;
    let parsed: { id: string; occDate: string };
    try { parsed = JSON.parse(raw); } catch { return; }
    const { id, occDate } = parsed;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = HOUR_START * 60 + Math.round(((e.clientY - rect.top) / ROW_H) * 60 / 30) * 30;
    const newTime = fromMin(Math.max(HOUR_START * 60, Math.min(min, HOUR_END * 60)));
    const b = findBookingById(id);
    if (!b) return;
    if (occDate === targetDate && newTime === b.time) return;
    const moved = { ...b, date: targetDate, time: newTime, occDate: targetDate, isOccurrence: true };
    const conflict = occurrences.some((o) => o.date === targetDate && o.id !== id && bookingsOverlap(moved as any, o));
    if (conflict && !(await ask("На это время уже есть запись. Перенести всё равно?", { ok: "Перенести" }))) return;
    try { await rescheduleOccurrence(b, occDate, targetDate, newTime); }
    catch (e) { console.error("[CalendarView] onDropAt:", e); notify("Не удалось перенести запись."); }
  };

  const exportIcs = () => {
    const range = withLiveClients(expandBookings(bookings, today, addDays(today, 89)));
    downloadIcs(bookingsToIcs(range, clientName));
  };

  // Полоса недели: всегда 7 дней недели выбранной даты (Пн–Вс), точки — статусы записей
  const stripStart = startOfWeekMon(anchor);
  const stripDays = Array.from({ length: 7 }, (_, i) => addDays(stripStart, i));
  const stripOccs = withLiveClients(expandBookings(bookings, stripStart, addDays(stripStart, 6)));
  const dayOccs = (d: string, list: Occurrence[]) => list.filter((o) => o.date === d).sort((a, b) => a.time.localeCompare(b.time));
  const anchorOccs = dayOccs(anchor, withLiveClients(expandBookings(bookings, anchor, anchor)));
  const dayTitle = (d: string) => d === today ? "Сегодня" : d === addDays(today, 1) ? "Завтра"
    : capFirst(new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" }));
  const remainingOf = (id: string) => clients.find((c) => c.id === id)?.remaining ?? null;
  const namesOf = (o: Occurrence) => o.clientIds.length === 2 ? o.clientIds.map(clientName).join(" и ") : o.clientIds.map(clientName).join(", ");

  // Свободные окна дня (от часа) в рабочее время 8:00–21:00; для сегодняшнего дня — только впереди
  const freeGaps = (d: string, occs: Occurrence[]) => {
    if (d < today) return [];
    const now = new Date();
    let cur = d === today ? Math.max(8 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30) : 8 * 60;
    const gaps: [number, number][] = [];
    for (const o of occs.filter((x) => x.status !== "cancelled")) {
      const s = toMin(o.time), e = s + (Number(o.duration) || 60);
      if (s - cur >= 60) gaps.push([cur, s]);
      cur = Math.max(cur, e);
    }
    if (21 * 60 - cur >= 60) gaps.push([cur, 21 * 60]);
    return gaps.slice(0, 3);
  };

  // Записи дня списком: крупное время, полоска статуса, ▶ — начать тренировку
  const Agenda = ({ d, occs }: { d: string; occs: Occurrence[] }) => (
    <>
      {occs.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800">
          {occs.map((o) => {
            const color = BOOKING_STATUS_COLOR[o.status];
            const rem = o.clientIds.length === 1 ? remainingOf(o.clientIds[0]) : null;
            const sub = [o.status !== "scheduled" ? BOOKING_STATUS_LABEL[o.status] : null, o.dayName, o.recurring ? "еженедельно" : null, rem != null && rem !== "" ? `осталось ${rem}` : null].filter(Boolean).join(" · ");
            const faded = o.status === "done" || o.status === "cancelled" || o.status === "no-show";
            return (
              <div key={`${o.id}-${o.occDate}`} role="button" tabIndex={0} onClick={() => setQuickView(o)} onKeyDown={(e) => e.key === "Enter" && setQuickView(o)}
                className={`flex items-center gap-3 px-4 py-3 min-h-[72px] cursor-pointer hover:bg-zinc-800/40 transition ${faded ? "opacity-60" : ""}`}>
                <div className="w-12 shrink-0">
                  <p className="text-base font-bold leading-tight">{o.time || "—"}</p>
                  <p className="text-xs text-zinc-500">{Number(o.duration) || 60} мин</p>
                </div>
                <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{namesOf(o)}</p>
                  {sub && <p className={`text-sm truncate ${o.status === "no-show" ? "text-orange-400" : "text-zinc-400"}`}>{capFirst(sub)}</p>}
                </div>
                {o.status === "scheduled" ? (
                  <button onClick={(e) => { e.stopPropagation(); startGroup(o); }} aria-label="Начать тренировку" title="Начать тренировку"
                    className="w-10 h-10 shrink-0 rounded-xl bg-lime-400/15 text-lime-400 flex items-center justify-center hover:bg-lime-400/25 transition">
                    <Play size={18} />
                  </button>
                ) : o.status === "done" ? <Check size={18} className="shrink-0 text-lime-400" /> : null}
              </div>
            );
          })}
        </div>
      )}
      {freeGaps(d, occs).map(([s, e]) => (
        <button key={s} onClick={() => setModal({ date: d, time: fromMin(s) })}
          className="w-full mt-2 flex items-center gap-2.5 px-4 h-12 rounded-xl border-[1.5px] border-dashed border-zinc-800 text-sm text-zinc-500 hover:text-zinc-200 hover:border-zinc-700 transition">
          <Plus size={16} /> Свободно с {fromMin(s)} до {fromMin(e)}
        </button>
      ))}
    </>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Шапка: заголовок, экспорт, новая запись */}
      <div className="flex items-center gap-2 pt-1">
        <h2 className="flex-1 min-w-0 text-2xl font-extrabold tracking-tight">Календарь</h2>
        <button onClick={exportIcs} title="Экспорт .ics" aria-label="Экспорт в календарь телефона" className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition"><Share size={19} /></button>
        <button onClick={() => setModal({ date: anchor })} className="flex items-center gap-1.5 h-10 shrink-0 bg-lime-400 text-zinc-950 font-bold rounded-xl px-3.5 text-sm hover:bg-lime-300 transition active:scale-[0.98]"><Plus size={17} /> Запись</button>
      </div>

      {/* Режимы */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
        {MODES.map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} aria-pressed={mode === k} className={`flex-1 h-9 rounded-lg text-sm font-semibold transition ${mode === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{l}</button>
        ))}
      </div>

      {/* Период и переключение; кроме месяца — полоса недели */}
      <div className={mode === "month" ? "" : "bg-zinc-900 border border-zinc-800 rounded-2xl pt-1 pb-2 px-1.5"}>
        <div className="flex items-center gap-1 pl-2.5">
          <p className="flex-1 min-w-0 font-bold truncate">{mode === "day" ? fmtMonth(anchor) : navTitle}</p>
          {anchor !== today && <button onClick={goToday} className="h-9 px-2.5 rounded-lg text-sm font-semibold text-lime-400 hover:bg-zinc-800 transition shrink-0">Сегодня</button>}
          <button onClick={goPrev} title="Назад" aria-label="Предыдущий период" className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-400 shrink-0"><ChevronLeft size={20} /></button>
          <button onClick={goNext} title="Вперёд" aria-label="Следующий период" className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-400 shrink-0"><ChevronRight size={20} /></button>
        </div>
        {mode !== "month" && (
          <div className="grid grid-cols-7 gap-1 mt-1">
            {stripDays.map((d, i) => {
              const occs = dayOccs(d, stripOccs);
              return (
                <button key={d} onClick={() => setAnchor(d)} aria-pressed={d === anchor}
                  className="flex flex-col items-center gap-1 py-1 rounded-xl transition hover:bg-zinc-800/60">
                  <span className="text-xs font-semibold text-zinc-500">{WEEKDAYS_SHORT[i]}</span>
                  <span className={`text-[15px] font-bold w-9 h-9 flex items-center justify-center rounded-full transition ${
                    d === anchor ? "bg-lime-400 text-zinc-950"
                    : d === today ? "text-lime-400 ring-[1.5px] ring-inset ring-lime-400/60"
                    : "text-zinc-100"}`}>{Number(d.slice(8))}</span>
                  <span className="flex gap-[3px] h-[5px]">
                    {occs.slice(0, 3).map((o) => <span key={`${o.id}-${o.occDate}`} className="w-[5px] h-[5px] rounded-full" style={{ background: BOOKING_STATUS_COLOR[o.status] }} />)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {mode === "day" && (
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-2.5 px-0.5">
            <h3 className="text-[17px] font-bold">{dayTitle(anchor)}{anchorOccs.length > 0 && ` · ${anchorOccs.length} ${plural(anchorOccs.length, ["тренировка", "тренировки", "тренировок"])}`}</h3>
          </div>
          {anchorOccs.length === 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-6 text-center mb-2">
              <CalendarDays size={28} className="mx-auto text-zinc-600 mb-2.5" />
              <p className="text-sm text-zinc-500 mb-3">Записей на этот день нет</p>
              <button onClick={() => setModal({ date: anchor })} className="inline-flex items-center gap-1.5 h-10 text-sm font-semibold bg-zinc-800 rounded-xl px-4 text-zinc-100 hover:bg-zinc-700 transition"><Plus size={15} /> Запланировать</button>
            </div>
          )}
          {anchorOccs.length > 0 && <Agenda d={anchor} occs={anchorOccs} />}
        </div>
      )}

      {mode === "month" && (
        <div>
          <div className="grid grid-cols-7 gap-1 text-center mb-1">
            {WEEKDAYS_SHORT.map((w) => <p key={w} className="text-xs text-zinc-500 font-semibold">{w}</p>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {gridDays.map((d) => {
              const occs = dayOccs(d, occurrences);
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
              const sel = d === anchor;
              return (
                <button key={d} onClick={() => setAnchor(d)} aria-pressed={sel}
                  onDragOver={(e) => { e.preventDefault(); setDragOverDay(d); }} onDragLeave={() => setDragOverDay(null)} onDrop={(e) => onDropDay(e, d)}
                  className={`aspect-square rounded-xl flex flex-col items-center justify-start pt-1.5 gap-1 text-sm font-semibold transition ${
                    sel ? "bg-lime-400 text-zinc-950"
                    : dragOverDay === d ? "bg-zinc-900 ring-[1.5px] ring-inset ring-cyan-400"
                    : d === today ? "bg-zinc-900 text-lime-400 ring-[1.5px] ring-inset ring-lime-400"
                    : inMonth ? "bg-zinc-900 border border-zinc-800 text-zinc-100" : "text-zinc-600"}`}>
                  {Number(d.slice(8))}
                  <span className="flex gap-[3px]">
                    {occs.slice(0, 3).map((o) => <span key={`${o.id}-${o.occDate}`} className="w-[5px] h-[5px] rounded-full" style={{ background: sel ? "currentColor" : BOOKING_STATUS_COLOR[o.status] }} />)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[13px] text-zinc-400">
            {(["scheduled", "done", "no-show"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: BOOKING_STATUS_COLOR[s] }} />{BOOKING_STATUS_LABEL[s]}</span>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-2 mt-5 mb-2.5 px-0.5">
            <h3 className="text-[17px] font-bold">{dayTitle(anchor)}</h3>
            <button onClick={() => setMode("day")} className="text-sm text-zinc-400 hover:text-zinc-100 transition">Открыть день</button>
          </div>
          {anchorOccs.length === 0
            ? <p className="text-sm text-zinc-500 px-0.5">Записей нет</p>
            : <Agenda d={anchor} occs={anchorOccs} />}
        </div>
      )}

      {(mode === "days3" || mode === "week") && (
        <div className="flex bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="w-10 shrink-0 border-r border-zinc-800 pt-7">
            {HOURS.map((h) => (
              <div key={h} style={{ height: ROW_H }} className="text-[11px] text-zinc-500 text-right pr-1.5 -translate-y-1.5">{h}:00</div>
            ))}
          </div>
          {/* Неделя на телефоне: колонки ~92 px, на экране три дня, остальные — свайпом вбок.
              Так влезает полное имя; при выборе дня в полосе сетка доезжает до него. */}
          <div ref={gridScroll} className={`flex-1 ${mode === "week" ? "overflow-x-auto snap-x snap-mandatory sm:snap-none" : "overflow-x-hidden"}`}>
            <div className="flex">
              {listDays.map((d) => {
                const occs = occurrences.filter((o) => o.date === d).sort((a, b) => a.time.localeCompare(b.time));
                return (
                  <div key={d} data-day={d} className={`border-r border-zinc-800 last:border-r-0 ${
                    mode === "week" ? "shrink-0 w-[92px] snap-start sm:w-auto sm:flex-1 sm:min-w-[88px]" : "flex-1 min-w-0"} ${
                    dragOverDay === d ? "bg-cyan-400/5" : d === today ? "bg-zinc-800/25" : ""}`}>
                    <button onClick={() => setAnchor(d)} className={`h-7 w-full flex items-center justify-center gap-1 text-xs font-semibold border-b border-zinc-800 ${
                      d === today ? "text-lime-400" : d === anchor ? "text-zinc-100" : "text-zinc-500"}`}>
                      {WEEKDAYS_SHORT[(new Date(d + "T00:00:00").getDay() + 6) % 7]} {Number(d.slice(8))}
                    </button>
                    <div className="relative cursor-pointer" style={{ height: HOURS.length * ROW_H }}
                      onClick={(e) => { const min = HOUR_START * 60 + Math.round(((e.clientY - e.currentTarget.getBoundingClientRect().top) / ROW_H) * 60 / 30) * 30; setModal({ date: d, time: fromMin(Math.max(HOUR_START * 60, Math.min(min, HOUR_END * 60))) }); }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverDay(d); }} onDragLeave={() => setDragOverDay(null)} onDrop={(e) => onDropAt(e, d)}>
                      {HOURS.map((h, i) => i > 0 && <div key={h} className="absolute left-0 right-0 border-t border-zinc-800/60" style={{ top: i * ROW_H }} />)}
                      {occs.map((o) => {
                        const top = Math.max(0, (toMin(o.time) - HOUR_START * 60) * (ROW_H / 60));
                        const height = Math.max(26, (Number(o.duration) || 60) * (ROW_H / 60));
                        // Плитка в цвете клиента (в группе — первого), статус — значком и прозрачностью
                        const color = clientColor(o.clientIds[0]);
                        const group = o.clientIds.length > 1;
                        return (
                          <button key={`${o.id}-${o.occDate}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ id: o.id, occDate: o.occDate }))}
                            onClick={(e) => { e.stopPropagation(); setQuickView(o); }} style={{ top, height, background: `${color}33`, borderLeft: `3px solid ${color}` }}
                            aria-label={`${o.time}, ${namesOf(o)}, ${BOOKING_STATUS_LABEL[o.status]}`}
                            className={`absolute left-0.5 right-0.5 rounded-lg px-1 py-0.5 text-left overflow-hidden cursor-grab active:cursor-grabbing ${
                              o.status === "cancelled" ? "opacity-40" : o.status === "done" || o.status === "no-show" ? "opacity-60" : ""}`}>
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300 leading-tight">
                              {o.time}
                              {o.status === "done" && <Check size={11} className="text-lime-400" />}
                              {o.status === "no-show" && <UserX size={11} className="text-orange-400" />}
                            </span>
                            {!group && <span className={`block text-xs sm:text-[13px] text-zinc-100 leading-tight font-semibold [overflow-wrap:anywhere] ${o.status === "cancelled" ? "line-through" : ""}`}>{clientName(o.clientIds[0])}</span>}
                            {group && o.clientIds.map((id) => (
                              <span key={id} className={`flex items-start gap-1 text-xs sm:text-[13px] text-zinc-100 leading-tight font-semibold [overflow-wrap:anywhere] ${o.status === "cancelled" ? "line-through" : ""}`}>
                                <span className="w-1.5 h-1.5 mt-[5px] rounded-full shrink-0" style={{ background: clientColor(id) }} />
                                {clientName(id)}
                              </span>
                            ))}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {quickView && (
        <ModalShell title="Запись" onClose={() => setQuickView(null)}>
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-display text-4xl font-extrabold tracking-tight leading-none">{quickView.time || "—"}</p>
                <p className="text-sm text-zinc-400 mt-1.5">{WEEKDAYS_FULL[(new Date(quickView.date + "T00:00:00").getDay() + 6) % 7]}, {fmt(quickView.date)} · {Number(quickView.duration) || 60} мин</p>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[13px] font-semibold bg-zinc-800 text-zinc-200">
                  <span className="w-2 h-2 rounded-full" style={{ background: BOOKING_STATUS_COLOR[quickView.status] }} />{BOOKING_STATUS_LABEL[quickView.status]}
                </span>
                {quickView.recurring && <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[13px] font-semibold bg-zinc-800 text-zinc-300"><Repeat size={13} /> Еженедельно</span>}
              </div>
            </div>
            <div className="space-y-2">
              {quickView.clientIds.map((id) => {
                const c = clients.find((x) => x.id === id);
                const rem = c?.remaining ?? null;
                const low = rem != null && rem !== "" && Number(rem) <= 2;
                return (
                  <div key={id} className="flex items-center gap-3 bg-zinc-800/60 rounded-xl px-3 py-2.5">
                    {c?.avatarUrl
                      ? <img src={c.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                      : <span className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center font-bold text-zinc-950" style={{ background: c?.color || "#c6ff3d" }}>{clientName(id)[0]}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{clientName(id)}</p>
                      {rem != null && rem !== "" && (low
                        ? <button onClick={() => { setRenew(id); setQuickView(null); }} className="text-[13px] text-orange-400 font-semibold hover:text-orange-300 transition">Осталось {rem} · Продлить</button>
                        : <p className="text-[13px] text-zinc-500">Осталось {rem}</p>)}
                    </div>
                    {quickView.status === "scheduled" && quickView.date >= today && (
                      <button onClick={() => { setRemind({ id, date: quickView.date, time: quickView.time }); setQuickView(null); }} aria-label="Напомнить о тренировке" title="Напомнить" className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 transition shrink-0"><Bell size={17} /></button>
                    )}
                    <button onClick={() => { onOpenClientPlans(id); setQuickView(null); }} aria-label="Планы подопечного" title="Планы" className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 transition shrink-0"><ClipboardList size={17} /></button>
                    <button onClick={() => { onOpenClient(id); setQuickView(null); }} className="h-9 px-3 rounded-lg text-[13px] font-semibold bg-zinc-900 text-zinc-100 hover:bg-zinc-700 transition shrink-0">Профиль</button>
                  </div>
                );
              })}
            </div>
            {quickView.note && <p className="text-sm text-zinc-400 bg-zinc-800/60 rounded-xl px-3 py-2.5 whitespace-pre-wrap">{quickView.note}</p>}
            <button onClick={() => { startGroup(quickView); setQuickView(null); }} className="w-full h-12 flex items-center justify-center gap-2 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98]"><Play size={18} /> Начать тренировку</button>
            <div className="flex gap-2">
              <button onClick={() => { const base = findBookingById(quickView.id); setModal({ booking: base && { ...base, status: quickView.status }, occDate: quickView.occDate }); setQuickView(null); }} className="flex-1 h-11 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold rounded-xl text-sm transition"><Pencil size={15} /> Изменить</button>
              {quickView.status === "scheduled" && (
                <button onClick={() => { setNoShow(quickView); setQuickView(null); }} className="flex-1 h-11 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-orange-500/15 text-orange-400 font-semibold rounded-xl text-sm transition"><UserX size={15} /> Не пришёл</button>
              )}
              <button onClick={() => { setDelOcc(quickView); setQuickView(null); }} className="flex-1 h-11 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-red-500/15 text-red-400 font-semibold rounded-xl text-sm transition"><Trash2 size={15} /> Удалить</button>
            </div>
          </div>
        </ModalShell>
      )}

      {renew && <RenewModal trainerId={trainerId} clientId={renew} name={clientName(renew)} onDone={reloadClients} onClose={() => setRenew(null)} />}
      {remind && <RemindModal clientId={remind.id} name={clientName(remind.id)} date={remind.date} time={remind.time} onClose={() => setRemind(null)} />}

      {noShow && (
        <NoShowModal clients={noShow.clientIds.map((id) => ({ id, name: clientName(id), remaining: clients.find((c) => c.id === id)?.remaining ?? null }))} onConfirm={(r) => markNoShow(noShow, r)} onClose={() => setNoShow(null)} />
      )}

      {modal && (
        <BookingModal
          defaultClientIds={!modal.booking && modal.clientId ? [modal.clientId] : undefined}
          clients={clients}
          booking={modal.booking}
          defaultDate={modal.date}
          defaultTime={modal.time}
          onClose={() => setModal(null)}
          onSave={async (patch, clientIds) => {
            try {
              // П.13 аудита. Поля записи — обычным обновлением, статус и списание — одной
              // серверной транзакцией (markOccurrence). Раньше у занятия серии статус писался в
              // exceptions, а следом updateBooking записывал exceptions из формы (снимок на момент
              // открытия) и затирал его; «Не пришёл»/«Отменена» вообще писались как «Проведена»;
              // а «уже проведена» смотрели по статусу серии — повторная отметка списывала снова.
              // exceptions из формы больше не пишем: правки дат серии живут только на сервере.
              const { status, exceptions: _formExceptions, ...fields } = patch;
              // Новая запись создаётся «Запланирована», статус ставит markOccurrence. Если отметка
              // сорвалась, повтор «Сохранить» обновит уже созданную запись, а не создаст вторую.
              let id = modal.booking?.id ?? modal.createdId;
              const prevStatus = modal.booking?.status ?? "scheduled"; // у серии — статус ЭТОГО занятия
              if (id) await updateBooking(id, fields, clientIds);
              else {
                id = await addBooking({ ...fields, status: "scheduled", exceptions: {} }, clientIds);
                const created = id;
                setModal((m) => (m ? { ...m, createdId: created } : m));
              }
              if (status !== prevStatus) {
                // Ключ вхождения — по тому, чем запись стала после сохранения: серия → дата этого
                // занятия (у новой или только что ставшей серией — её первая дата), разовая → null
                const occDate = !fields.recurring ? null : modal.booking?.recurring ? modal.occDate ?? null : fields.date;
                // Автосписание — только при «Проведена». «Не пришёл» из формы не списывает (как
                // раньше): со списанием и причиной — кнопка «Не пришёл» в карточке занятия.
                // Гард П12 (у подопечного за этот день уже есть проведённая тренировка) — на сервере.
                const res = await markOccurrence(id, occDate, status, status === "done" ? clientIds : []);
                if (status === "done") {
                  reloadClients();
                  const skipped = res.skipped.filter((x) => x.reason === "session" || x.reason === "already").map((x) => clientName(x.client_id));
                  if (skipped.length) notify(`Тренировка за этот день уже была отмечена — повторно не списываем: ${skipped.join(", ")}`);
                }
              }
              setModal(null);
            } catch (e) { console.error("[CalendarView] onSave:", e); notify("Не удалось сохранить запись."); }
          }}
          onDelete={modal.booking ? () => askConfirm("Удалить запись? Это действие необратимо.", async () => { await deleteBooking(modal.booking!.id); setModal(null); }) : undefined}
        />
      )}

      {/* Удаление из карточки записи. Разовая — сразу; у серии — выбор: дата, дата и дальше, вся серия.
          Абонемент не трогаем: удаление записи — не отмена проведённой тренировки. */}
      {delOcc && (() => {
        const b = findBookingById(delOcc.id);
        const run = async (fn: () => Promise<void>) => {
          setDelOcc(null);
          try { await fn(); } catch (e) { console.error("[CalendarView] delete:", e); notify("Не удалось удалить запись."); }
        };
        const when = `${dayTitle(delOcc.date).toLowerCase()}, ${delOcc.time}`;
        return (
          <ModalShell title="Удалить запись" onClose={() => setDelOcc(null)}>
            <div className="p-4 space-y-2">
              <p className="text-sm text-zinc-300 mb-3">{namesOf(delOcc)} · {when}{delOcc.recurring ? " · повторяется еженедельно" : ""}</p>
              {!delOcc.recurring || !b ? (
                <button onClick={() => run(() => deleteBooking(delOcc.id))} className="w-full h-12 bg-red-500 hover:bg-red-400 text-white font-semibold rounded-xl text-sm transition">Удалить</button>
              ) : (<>
                <button onClick={() => run(() => cancelOccurrence(b, delOcc.occDate))} className="w-full h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold rounded-xl text-sm transition">Только это занятие</button>
                <button onClick={() => run(() => delOcc.occDate <= b.date ? deleteBooking(b.id) : updateBooking(b.id, { recurUntil: addDays(delOcc.occDate, -1) }))}
                  className="w-full h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold rounded-xl text-sm transition">Это и все следующие</button>
                <button onClick={() => run(() => deleteBooking(b.id))} className="w-full h-12 bg-red-500 hover:bg-red-400 text-white font-semibold rounded-xl text-sm transition">Всю серию, включая прошлые</button>
              </>)}
              <button onClick={() => setDelOcc(null)} autoFocus className="w-full h-11 text-zinc-400 hover:text-zinc-100 text-sm font-semibold transition">Не удалять</button>
            </div>
          </ModalShell>
        );
      })()}

      {confirmPending && (
        <ModalShell title="Подтверждение" onClose={() => setConfirmPending(null)}>
          <div className="p-4 space-y-4">
            <p className="text-sm text-zinc-300">{confirmPending.text}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmPending(null)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-xl py-2.5 text-sm transition">Отмена</button>
              <button onClick={() => { confirmPending.onConfirm(); setConfirmPending(null); }} className="flex-1 bg-red-500 hover:bg-red-400 text-white font-semibold rounded-xl py-2.5 text-sm transition">Подтвердить</button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
