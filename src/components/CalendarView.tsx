import { useEffect, useState } from "react";
import { loadViewState, saveViewState } from "../lib/viewState";
import { CalendarDays, CalendarX, Check, ClipboardList, ChevronLeft, ChevronRight, Pencil, Plus, Play, Repeat, Share } from "lucide-react";
import { bookingsOverlap, expandBookings, toMin } from "../lib/bookings";
import type { Booking, Occurrence } from "../lib/bookings";
import * as clientsApi from "../lib/clients";
import type { ClientListItem } from "../lib/clients";
import BookingModal, { BOOKING_STATUS_COLOR, BOOKING_STATUS_LABEL } from "./BookingModal";
import GroupSessionModal from "./GroupSessionModal";
import ModalShell from "./ModalShell";
import { bookingsToIcs, downloadIcs } from "../lib/ics";
import { today as todayFn, addDays, addMonths, toDateStr } from "../lib/format";

const WEEKDAYS_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MODES = [["day", "День"], ["days3", "3 дня"], ["week", "Неделя"], ["month", "Месяц"]] as const;
type Mode = (typeof MODES)[number][0];

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? "тренировка" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "тренировки" : "тренировок"; };
const startOfWeekMon = (s: string) => { const d = new Date(s + "T00:00:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return toDateStr(d); };
// month: "long" — полное название месяца (требование: не сокращать до "июн.")
const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const fmtLong = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const fmtMonth = (s: string) => capFirst(new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", ""));
const lastDayOfMonth = (s: string) => { const d = new Date(s + "T00:00:00"); return toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };

const fromMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const HOUR_START = 6, HOUR_END = 24;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
// К1: 40 px на час вместо 32 — в узкой колонке имя переносится на две строки,
// и при 32 px оно обрезалось. Сетка прокручивается по вертикали, места хватает.
const ROW_H = 40; // px за час

export default function CalendarView({ trainerId, bookingsHook, clients, reloadClients, onOpenClient, onOpenClientPlans, openBooking, newBookingClientId, openOccurrence }: { trainerId: string; bookingsHook: ReturnType<typeof import("../hooks/useBookings").useBookings>; clients: ClientListItem[]; reloadClients: () => void; onOpenClient: (id: string) => void; onOpenClientPlans: (id: string) => void; openBooking?: boolean; newBookingClientId?: string; openOccurrence?: { id: string; occDate: string } }) {
  const { bookings, addBooking, updateBooking, deleteBooking, cancelOccurrence, doneOccurrence, rescheduleOccurrence, reload } = bookingsHook;
  // B12: запоминаем режим просмотра, но НЕ дату — вернувшись через час, ожидаешь
  // увидеть текущую неделю, а не ту, на которой ушёл.
  const [mode, setMode] = useState<Mode>(() => loadViewState<Mode>("calendar-mode", "week"));
  useEffect(() => { saveViewState("calendar-mode", mode); }, [mode]);
  const today = todayFn();
  const [anchor, setAnchor] = useState(today);
  const [modal, setModal] = useState<{ booking?: Booking; date?: string; time?: string; occDate?: string } | null>(null);
  // B13: FAB просит сразу открыть форму новой записи на сегодня.
  useEffect(() => { if (openBooking) setModal({ date: todayFn() }); }, [openBooking]);
  // B24: дашборд попросил открыть конкретную запись — ставим календарь на её дату
  // и раскрываем карточку. Если запись успели удалить, find вернёт undefined и ничего не произойдёт.
  useEffect(() => {
    if (!openOccurrence) return;
    const { id, occDate } = openOccurrence;
    setAnchor(occDate);
    const occ = expandBookings(bookings, occDate, occDate).find((o) => o.id === id && o.occDate === occDate);
    if (occ) setQuickView(occ);
  }, [openOccurrence, bookings]);
  const [quickView, setQuickView] = useState<Occurrence | null>(null);
  const [groupSession, setGroupSession] = useState<Occurrence | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [confirmPending, setConfirmPending] = useState<{ text: string; onConfirm: () => void } | null>(null);
  const [finishedSessionClients, setFinishedSessionClients] = useState<Set<string>>(new Set());
  const askConfirm = (text: string, onConfirm: () => void) => setConfirmPending({ text, onConfirm });

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
    if (conflict && !window.confirm("На эту дату уже есть запись в это же время. Перенести всё равно?")) return;
    try { await rescheduleOccurrence(b, occDate, targetDate); }
    catch (e) { console.error("[CalendarView] onDropDay:", e); alert("Не удалось перенести запись."); }
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
    if (conflict && !window.confirm("На это время уже есть запись. Перенести всё равно?")) return;
    try { await rescheduleOccurrence(b, occDate, targetDate, newTime); }
    catch (e) { console.error("[CalendarView] onDropAt:", e); alert("Не удалось перенести запись."); }
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
                  <button onClick={(e) => { e.stopPropagation(); setGroupSession(o); }} aria-label="Начать тренировку" title="Начать тренировку"
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
            <h3 className="text-[17px] font-bold">{dayTitle(anchor)}{anchorOccs.length > 0 && ` · ${anchorOccs.length} ${plural(anchorOccs.length)}`}</h3>
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
          {/* К1: без minWidth — семь колонок по ~44 px влезают в 360 px и ничего не едет вбок.
              На широком экране колонки получают нижнюю границу ширины через sm:min-w. */}
          <div className="flex-1 overflow-x-hidden">
            <div className="flex">
              {listDays.map((d) => {
                const occs = occurrences.filter((o) => o.date === d).sort((a, b) => a.time.localeCompare(b.time));
                return (
                  <div key={d} className={`flex-1 min-w-0 sm:min-w-[68px] border-r border-zinc-800 last:border-r-0 ${
                    dragOverDay === d ? "bg-cyan-400/5" : d === today ? "bg-zinc-800/25" : ""}`}>
                    <div className="relative cursor-pointer" style={{ height: HOURS.length * ROW_H }}
                      onClick={(e) => { const min = HOUR_START * 60 + Math.round(((e.clientY - e.currentTarget.getBoundingClientRect().top) / ROW_H) * 60 / 30) * 30; setModal({ date: d, time: fromMin(Math.max(HOUR_START * 60, Math.min(min, HOUR_END * 60))) }); }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverDay(d); }} onDragLeave={() => setDragOverDay(null)} onDrop={(e) => onDropAt(e, d)}>
                      {HOURS.map((h, i) => i > 0 && <div key={h} className="absolute left-0 right-0 border-t border-zinc-800/60" style={{ top: i * ROW_H }} />)}
                      {occs.map((o) => {
                        const top = Math.max(0, (toMin(o.time) - HOUR_START * 60) * (ROW_H / 60));
                        const height = Math.max(26, (Number(o.duration) || 60) * (ROW_H / 60));
                        return (
                          <button key={`${o.id}-${o.occDate}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ id: o.id, occDate: o.occDate }))}
                            onClick={(e) => { e.stopPropagation(); setQuickView(o); }} style={{ top, height, background: `${BOOKING_STATUS_COLOR[o.status]}26`, borderLeft: `3px solid ${BOOKING_STATUS_COLOR[o.status]}` }}
                            className="absolute left-0.5 right-0.5 rounded-lg px-1.5 py-0.5 text-left overflow-hidden cursor-grab active:cursor-grabbing">
                            {/* К1: в узкой колонке имя переносится, а не обрезается многоточием */}
                            <span className="hidden sm:block text-xs font-semibold text-zinc-300 leading-tight">{o.time}</span>
                            {/* В неделе колонка ~44 px — имя ломалось по буквам, поэтому на телефоне инициалы */}
                            <span className={`block text-xs sm:text-sm text-zinc-100 leading-tight font-semibold break-words ${mode === "week" ? "hidden sm:block" : ""}`}>{o.clientIds.map(clientName).join(", ")}</span>
                            {mode === "week" && <span className="sm:hidden block text-xs text-zinc-100 leading-tight font-bold">{o.clientIds.map((id) => clientName(id).split(" ").slice(0, 2).map((w) => w[0]).join("")).join(" ")}</span>}
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
                <p className="text-4xl font-extrabold tracking-tight leading-none">{quickView.time || "—"}</p>
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
                      : <span className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center font-bold text-zinc-950" style={{ background: c?.color || "#a3e635" }}>{clientName(id)[0]}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{clientName(id)}</p>
                      {rem != null && rem !== "" && <p className={`text-[13px] ${low ? "text-orange-400" : "text-zinc-500"}`}>Осталось {rem}</p>}
                    </div>
                    <button onClick={() => { onOpenClientPlans(id); setQuickView(null); }} aria-label="Планы подопечного" title="Планы" className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 transition shrink-0"><ClipboardList size={17} /></button>
                    <button onClick={() => { onOpenClient(id); setQuickView(null); }} className="h-9 px-3 rounded-lg text-[13px] font-semibold bg-zinc-900 text-zinc-100 hover:bg-zinc-700 transition shrink-0">Профиль</button>
                  </div>
                );
              })}
            </div>
            <button onClick={() => { setGroupSession(quickView); setQuickView(null); }} className="w-full h-12 flex items-center justify-center gap-2 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98]"><Play size={18} /> Начать тренировку</button>
            <div className="flex gap-2">
              <button onClick={() => { setModal({ booking: findBookingById(quickView.id), occDate: quickView.occDate }); setQuickView(null); }} className="flex-1 h-11 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-semibold rounded-xl text-sm transition"><Pencil size={15} /> Изменить</button>
              {quickView.isOccurrence && (
                <button onClick={() => askConfirm("Отменить занятие на эту дату?", () => { cancelOccurrence(findBookingById(quickView.id)!, quickView.occDate); setQuickView(null); })} className="flex-1 h-11 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-red-500/15 text-red-400 font-semibold rounded-xl text-sm transition"><CalendarX size={15} /> Отменить</button>
              )}
            </div>
          </div>
        </ModalShell>
      )}

      {modal && (
        <BookingModal
          defaultClientIds={!modal.booking && newBookingClientId ? [newBookingClientId] : undefined}
          clients={clients}
          booking={modal.booking}
          defaultDate={modal.date}
          defaultTime={modal.time}
          onClose={() => setModal(null)}
          onSave={async (patch, clientIds) => {
            try {
              const wasAlreadyDone = modal.booking?.status === "done";
              if (modal.booking) {
                const base = findBookingById(modal.booking.id);
                if (base?.recurring && modal.occDate && patch.status) {
                  // Status change on recurring occurrence → exception, not base record
                  const { status, ...basePatch } = patch;
                  await doneOccurrence({ ...base, status }, modal.occDate);
                  if (Object.keys(basePatch).length || clientIds) await updateBooking(modal.booking.id, basePatch, clientIds);
                } else {
                  await updateBooking(modal.booking.id, patch, clientIds);
                }
              } else await addBooking(patch, clientIds);
              // Автосписание при ручной отметке «проведено».
              // П12: раньше здесь не было никакой проверки, и остаток уходил дважды —
              // например если клиент уже завершил тренировку сам в своём портале.
              // Теперь перед списанием смотрим, нет ли уже проведённой тренировки за эту дату.
              if (patch.status === "done" && !wasAlreadyDone && clientIds.length > 0) {
                const occDate = modal.occDate || patch.date;
                const skipped: string[] = [];
                await Promise.all(clientIds.map(async (cid) => {
                  const cf = await clientsApi.fetchClient(cid);
                  if (cf.membership.type !== "sessions") return;
                  // При ошибке проверки НЕ списываем: недосписать безопаснее, чем списать дважды —
                  // недостачу тренер заметит, а лишнее списание всплывёт только жалобой клиента.
                  let already = true;
                  try { already = await clientsApi.hasSessionOnDate(cid, occDate); }
                  catch (e) { console.error("[CalendarView] hasSessionOnDate:", e); }
                  if (already) { skipped.push(clientName(cid)); return; }
                  await clientsApi.decrementMembershipRemaining(cid, cf.membership);
                }));
                reloadClients();
                if (skipped.length) alert(`Тренировка за этот день уже была отмечена — повторно не списываем: ${skipped.join(", ")}`);
              }
              setModal(null);
            } catch (e) { console.error("[CalendarView] onSave:", e); alert("Не удалось сохранить запись."); }
          }}
          onDelete={modal.booking ? () => askConfirm("Удалить запись? Это действие необратимо.", async () => { await deleteBooking(modal.booking!.id); setModal(null); }) : undefined}
        />
      )}

      {groupSession && (
        <GroupSessionModal
          trainerId={trainerId}
          clients={groupSession.clientIds.map((id) => ({ id, name: clientName(id), color: clients.find((c) => c.id === id)?.color || "#a3e635", remaining: clients.find((c) => c.id === id)?.remaining ?? null }))}
          onClientFinished={async (clientId) => {
            try {
              const next = new Set([...finishedSessionClients, clientId]);
              setFinishedSessionClients(next);
              // Когда все клиенты этой записи завершили тренировку — помечаем букинг проведённым
              if (groupSession.clientIds.every((id) => next.has(id))) {
                if (groupSession.isOccurrence) {
                  const base = findBookingById(groupSession.id);
                  if (base) await doneOccurrence(base, groupSession.occDate);
                } else {
                  await updateBooking(groupSession.id, { status: "done" }, groupSession.clientIds);
                }
                setFinishedSessionClients(new Set());
                reloadClients();
              }
            } catch (e) { console.error("[CalendarView] onClientFinished:", e); }
          }}
          onClose={() => { setGroupSession(null); setFinishedSessionClients(new Set()); }}
        />
      )}

      {confirmPending && (
        <ModalShell title="Подтверждение" onClose={() => setConfirmPending(null)}>
          <div className="p-4 space-y-4">
            <p className="text-sm text-zinc-300">{confirmPending.text}</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmPending(null)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg py-2.5 text-sm transition">Отмена</button>
              <button onClick={() => { confirmPending.onConfirm(); setConfirmPending(null); }} className="flex-1 bg-red-500 hover:bg-red-400 text-white font-semibold rounded-lg py-2.5 text-sm transition">Подтвердить</button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
