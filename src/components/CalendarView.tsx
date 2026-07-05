import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus, Play } from "lucide-react";
import { useBookings } from "../hooks/useBookings";
import { bookingsOverlap, expandBookings, toMin } from "../lib/bookings";
import type { Booking, Occurrence } from "../lib/bookings";
import * as clientsApi from "../lib/clients";
import type { ClientListItem } from "../lib/clients";
import BookingModal, { BOOKING_STATUS_COLOR, BOOKING_STATUS_LABEL } from "./BookingModal";
import GroupSessionModal from "./GroupSessionModal";
import RemainingBadge from "./RemainingBadge";
import ModalShell from "./ModalShell";
import { bookingsToIcs, downloadIcs } from "../lib/ics";
import { today as todayFn, addDays, addMonths, toDateStr } from "../lib/format";

const WEEKDAYS_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MODES = [["day", "День"], ["week", "Неделя"], ["month", "Месяц"]] as const;
type Mode = (typeof MODES)[number][0];

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const startOfWeekMon = (s: string) => { const d = new Date(s + "T00:00:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return toDateStr(d); };
// month: "long" — полное название месяца (требование: не сокращать до "июн.")
const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const fmtLong = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const fmtMonth = (s: string) => capFirst(new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { month: "long", year: "numeric" }));
const lastDayOfMonth = (s: string) => { const d = new Date(s + "T00:00:00"); return toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };

const fromMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const HOUR_START = 6, HOUR_END = 24;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const ROW_H = 32; // px за час

export default function CalendarView({ trainerId, onOpenClient, onOpenClientPlans }: { trainerId: string; onOpenClient: (id: string) => void; onOpenClientPlans: (id: string) => void }) {
  const { bookings, addBooking, updateBooking, deleteBooking, cancelOccurrence, rescheduleOccurrence } = useBookings(trainerId);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [mode, setMode] = useState<Mode>("week");
  const today = todayFn();
  const [anchor, setAnchor] = useState(today);
  const [modal, setModal] = useState<{ booking?: Booking; date?: string; time?: string } | null>(null);
  const [quickView, setQuickView] = useState<Occurrence | null>(null);
  const [groupSession, setGroupSession] = useState<Occurrence | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  useEffect(() => { clientsApi.fetchClients(trainerId).then(setClients); }, [trainerId]);

  const weekStart = startOfWeekMon(anchor);
  const weekEnd = addDays(weekStart, 6);
  const monthStart = anchor.slice(0, 7) + "-01";
  const monthEnd = lastDayOfMonth(anchor);
  const gridStart = startOfWeekMon(monthStart);
  const gridEnd = addDays(startOfWeekMon(monthEnd), 6);

  const rangeStart = mode === "day" ? anchor : mode === "week" ? weekStart : gridStart;
  const rangeEnd = mode === "day" ? anchor : mode === "week" ? weekEnd : gridEnd;
  const occurrences = expandBookings(bookings, rangeStart, rangeEnd);
  const listDays = mode === "day" ? [anchor] : mode === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [];
  const gridDays = mode === "month" ? Array.from({ length: (new Date(gridEnd + "T00:00:00").getTime() - new Date(gridStart + "T00:00:00").getTime()) / 86400000 + 1 }, (_, i) => addDays(gridStart, i)) : [];

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "—";
  const findBookingById = (id: string) => bookings.find((b) => b.id === id);

  const navTitle = mode === "day" ? fmtLong(anchor) : mode === "week" ? `${fmt(weekStart)} – ${fmt(weekEnd)}` : fmtMonth(anchor);
  const goPrev = () => setAnchor(mode === "day" ? addDays(anchor, -1) : mode === "week" ? addDays(anchor, -7) : addMonths(anchor, -1));
  const goNext = () => setAnchor(mode === "day" ? addDays(anchor, 1) : mode === "week" ? addDays(anchor, 7) : addMonths(anchor, 1));
  const goToday = () => setAnchor(today);

  // Перенос занятия drag-and-drop на другой день (вид «Месяц», время не меняется); при конфликте — подтверждение.
  const onDropDay = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDay(null);
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;
    const { id, occDate } = JSON.parse(raw) as { id: string; occDate: string };
    if (occDate === targetDate) return;
    const b = findBookingById(id);
    if (!b) return;
    const moved = { ...b, date: targetDate, occDate: targetDate, isOccurrence: true };
    const conflict = occurrences.some((o) => o.date === targetDate && o.id !== id && bookingsOverlap(moved as any, o));
    if (conflict && !window.confirm("На эту дату уже есть запись в это же время. Перенести всё равно?")) return;
    await rescheduleOccurrence(b, occDate, targetDate);
  };

  // Перенос занятия в сетке «День»/«Неделя» — день и время определяются позицией отпускания в ячейке.
  const onDropAt = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDay(null);
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;
    const { id, occDate } = JSON.parse(raw) as { id: string; occDate: string };
    const rect = e.currentTarget.getBoundingClientRect();
    const min = HOUR_START * 60 + Math.round(((e.clientY - rect.top) / ROW_H) * 60 / 30) * 30;
    const newTime = fromMin(Math.max(HOUR_START * 60, Math.min(min, HOUR_END * 60)));
    const b = findBookingById(id);
    if (!b) return;
    if (occDate === targetDate && newTime === b.time) return;
    const moved = { ...b, date: targetDate, time: newTime, occDate: targetDate, isOccurrence: true };
    const conflict = occurrences.some((o) => o.date === targetDate && o.id !== id && bookingsOverlap(moved as any, o));
    if (conflict && !window.confirm("На это время уже есть запись. Перенести всё равно?")) return;
    await rescheduleOccurrence(b, occDate, targetDate, newTime);
  };

  const exportIcs = () => {
    const range = expandBookings(bookings, today, addDays(today, 89));
    downloadIcs(bookingsToIcs(range, clientName));
  };

  // Week strip: всегда показываем 7 дней текущей недели (Пн–Вс)
  const stripStart = startOfWeekMon(anchor);
  const stripDays = Array.from({ length: 7 }, (_, i) => addDays(stripStart, i));
  const STRIP_LABELS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
  const todayCount = expandBookings(bookings, today, today).length;
  const todayLabel = todayCount === 1 ? "ЗАНЯТИЕ" : todayCount > 1 && todayCount < 5 ? "ЗАНЯТИЯ" : "ЗАНЯТИЙ";

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-xs font-semibold tracking-widest text-zinc-500">КАЛЕНДАРЬ</p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={goToday} className="px-3 py-1.5 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:border-zinc-500 transition">Сегодня</button>
          <button onClick={exportIcs} title="Экспорт .ics" className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-cyan-400 transition"><Download size={16} /></button>
          <button onClick={() => setModal({ date: anchor })} className="flex items-center gap-1.5 bg-cyan-400 text-zinc-950 font-semibold rounded-xl px-3 py-2 text-sm hover:bg-cyan-300 transition"><Plus size={15} /> Новая запись</button>
        </div>
      </div>

      {/* Week/Month toggle */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
        {MODES.map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition ${mode === k ? "bg-cyan-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{l}</button>
        ))}
      </div>

      {/* Week strip — nav + 7-day row */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
        <div className="flex items-center justify-between mb-2.5">
          <button onClick={goPrev} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400"><ChevronLeft size={18} /></button>
          <p className="text-sm font-semibold text-zinc-200">{navTitle}</p>
          <button onClick={goNext} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400"><ChevronRight size={18} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {stripDays.map((d, i) => {
            const isToday = d === today;
            const hasEvents = occurrences.some((o) => o.date === d);
            return (
              <button key={d} onClick={() => { setAnchor(d); mode === "month" && setMode("week"); }}
                className="flex flex-col items-center gap-1 py-1.5 rounded-xl transition hover:bg-zinc-800">
                <span className="text-[10px] font-medium text-zinc-500">{STRIP_LABELS[i]}</span>
                <span className={`text-sm font-bold w-8 h-8 flex items-center justify-center rounded-full transition ${isToday ? "bg-lime-400 text-zinc-950" : "text-zinc-300"}`}>{Number(d.slice(8))}</span>
                <span className={`w-1 h-1 rounded-full ${hasEvents ? "bg-cyan-400" : ""}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* TODAY — N SESSIONS */}
      {mode !== "month" && (
        <div>
          <p className="text-xs font-semibold tracking-widest text-zinc-500 mb-2">
            СЕГОДНЯ — {todayCount} {todayLabel}
          </p>
          {todayCount === 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-6 text-center mb-2">
              <CalendarDays size={28} className="mx-auto text-zinc-700 mb-2.5" />
              <p className="text-sm text-zinc-600 mb-3">Записей на сегодня нет</p>
              <button onClick={() => setModal({ date: today })} className="inline-flex items-center gap-1.5 text-sm font-medium border border-zinc-700 rounded-xl px-4 py-2 text-zinc-300 hover:border-zinc-500 transition"><Plus size={14} /> Запланировать</button>
            </div>
          )}
        </div>
      )}

      {mode === "month" && (
        <p className="text-xs font-semibold tracking-widest text-zinc-500">ОБЗОР МЕСЯЦА</p>
      )}

            {mode === "month" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS_SHORT.map((w) => <p key={w} className="text-[11px] text-zinc-500 font-medium">{w}</p>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {gridDays.map((d) => {
              const occs = occurrences.filter((o) => o.date === d);
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
              return (
                <button key={d} onClick={() => { setAnchor(d); setMode("day"); }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverDay(d); }} onDragLeave={() => setDragOverDay(null)} onDrop={(e) => onDropDay(e, d)}
                  className={`min-h-[60px] rounded-lg border p-1 text-left transition ${dragOverDay === d ? "border-cyan-400" : d === today ? "border-cyan-400/40" : "border-zinc-800"} ${inMonth ? "bg-zinc-900" : "bg-zinc-900/40"}`}>
                  <span className={`text-xs ${d === today ? "text-cyan-400 font-bold" : inMonth ? "text-zinc-300" : "text-zinc-600"}`}>{Number(d.slice(8))}</span>
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {occs.slice(0, 4).map((o) => <span key={`${o.id}-${o.occDate}`} className="w-1.5 h-1.5 rounded-full" style={{ background: BOOKING_STATUS_COLOR[o.status] }} />)}
                    {occs.length > 4 && <span className="text-[9px] text-zinc-500">+{occs.length - 4}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="w-9 shrink-0 border-r border-zinc-800 pt-7">
            {HOURS.map((h) => (
              <div key={h} style={{ height: ROW_H }} className="text-[10px] text-zinc-500 text-right pr-1 -translate-y-1.5">{h}:00</div>
            ))}
          </div>
          <div className="flex-1 overflow-x-auto">
            <div className="flex" style={{ minWidth: listDays.length > 1 ? listDays.length * 72 : undefined }}>
              {listDays.map((d, idx) => {
                const occs = occurrences.filter((o) => o.date === d).sort((a, b) => a.time.localeCompare(b.time));
                return (
                  <div key={d} className={`flex-1 min-w-[68px] border-r border-zinc-800 last:border-r-0 ${dragOverDay === d ? "bg-cyan-400/5" : ""}`}>
                    <div className={`h-7 flex items-center justify-between px-1.5 border-b border-zinc-800 text-xs sticky top-0 bg-zinc-900 ${d === today ? "text-cyan-400 font-semibold" : "text-zinc-400"}`}>
                      <span className="truncate">{mode === "week" ? `${WEEKDAYS_SHORT[idx]} ${d.slice(8)}` : WEEKDAYS_FULL[(new Date(d + "T00:00:00").getDay() + 6) % 7]}</span>
                      <button onClick={() => setModal({ date: d })} className="text-zinc-600 hover:text-cyan-400 transition shrink-0"><Plus size={13} /></button>
                    </div>
                    <div className="relative cursor-pointer" style={{ height: HOURS.length * ROW_H }}
                      onClick={(e) => { const min = HOUR_START * 60 + Math.round(((e.clientY - e.currentTarget.getBoundingClientRect().top) / ROW_H) * 60 / 30) * 30; setModal({ date: d, time: fromMin(Math.max(HOUR_START * 60, Math.min(min, HOUR_END * 60))) }); }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverDay(d); }} onDragLeave={() => setDragOverDay(null)} onDrop={(e) => onDropAt(e, d)}>
                      {HOURS.map((h, i) => i > 0 && <div key={h} className="absolute left-0 right-0 border-t border-zinc-800/60" style={{ top: i * ROW_H }} />)}
                      {occs.map((o) => {
                        const top = Math.max(0, (toMin(o.time) - HOUR_START * 60) * (ROW_H / 60));
                        const height = Math.max(22, (Number(o.duration) || 60) * (ROW_H / 60));
                        return (
                          <button key={`${o.id}-${o.occDate}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ id: o.id, occDate: o.occDate }))}
                            onClick={(e) => { e.stopPropagation(); setQuickView(o); }} style={{ top, height, background: `${BOOKING_STATUS_COLOR[o.status]}26`, borderLeft: `3px solid ${BOOKING_STATUS_COLOR[o.status]}` }}
                            className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-left overflow-hidden cursor-grab active:cursor-grabbing">
                            <span className="block text-[11px] font-mono text-zinc-300 leading-tight">{o.time}</span>
                            <span className="block text-sm text-zinc-100 truncate leading-tight font-medium">{o.clientIds.map(clientName).join(", ")}</span>
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
        <ModalShell title="Тренировка" onClose={() => setQuickView(null)}>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BOOKING_STATUS_COLOR[quickView.status] }} />
              <p className="text-sm text-zinc-300">{WEEKDAYS_FULL[(new Date(quickView.date + "T00:00:00").getDay() + 6) % 7]}, {fmt(quickView.date)} · {quickView.time}</p>
            </div>
            <p className="text-xs text-zinc-500">{BOOKING_STATUS_LABEL[quickView.status]}{quickView.recurring && " · еженедельно"}</p>
            <button onClick={() => { setGroupSession(quickView); setQuickView(null); }} className="w-full flex items-center justify-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:bg-lime-300 transition"><Play size={16} /> Начать тренировку</button>
            <div className="space-y-1.5">
              {quickView.clientIds.map((id) => (
                <div key={id} className="flex items-center justify-between gap-2 bg-zinc-800/50 rounded-lg px-3 py-2">
                  <span className="text-sm text-zinc-100 truncate flex items-center gap-1.5"><RemainingBadge remaining={clients.find((c) => c.id === id)?.remaining ?? null} /> {clientName(id)}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { onOpenClient(id); setQuickView(null); }} className="text-xs text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded-md hover:bg-zinc-700 transition">Профиль</button>
                    <button onClick={() => { onOpenClientPlans(id); setQuickView(null); }} className="text-xs text-lime-400 hover:text-lime-300 px-2 py-1 rounded-md hover:bg-zinc-700 transition">Программы</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setModal({ booking: findBookingById(quickView.id) }); setQuickView(null); }} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg py-2 text-sm transition">Редактировать</button>
              {quickView.isOccurrence && (
                <button onClick={() => { if (window.confirm("Отменить занятие на эту дату?")) { cancelOccurrence(findBookingById(quickView.id)!, quickView.occDate); setQuickView(null); } }} className="px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition">Отменить</button>
              )}
            </div>
          </div>
        </ModalShell>
      )}

      {modal && (
        <BookingModal
          clients={clients}
          booking={modal.booking}
          defaultDate={modal.date}
          defaultTime={modal.time}
          onClose={() => setModal(null)}
          onSave={async (patch, clientIds) => {
            if (modal.booking) await updateBooking(modal.booking.id, patch, clientIds);
            else await addBooking(patch, clientIds);
            setModal(null);
          }}
          onDelete={modal.booking ? async () => { if (window.confirm("Удалить запись?")) { await deleteBooking(modal.booking!.id); setModal(null); } } : undefined}
        />
      )}

      {groupSession && (
        <GroupSessionModal
          clients={groupSession.clientIds.map((id) => ({ id, name: clientName(id), color: clients.find((c) => c.id === id)?.color || "#a3e635", remaining: clients.find((c) => c.id === id)?.remaining ?? null }))}
          onClose={() => setGroupSession(null)}
        />
      )}
    </div>
  );
}
