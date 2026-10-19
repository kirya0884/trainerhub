import { useEffect, useRef, useState } from "react";
import { CalendarDays, Search, Trash2 } from "lucide-react";
import ModalShell from "./ModalShell";
import RemainingBadge from "./RemainingBadge";
import type { ClientListItem } from "../lib/clients";
import type { Booking } from "../lib/bookings";
import { addDays, initials, today } from "../lib/format";
import { supabase } from "../lib/supabase";
import { notify } from "../lib/dialog";

const fmtDateLabel = (s: string) => {
  const str = new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export const BOOKING_STATUS_LABEL: Record<string, string> = { scheduled: "Запланирована", done: "Проведена", cancelled: "Отменена", "no-show": "Не пришёл" };
export const BOOKING_STATUS_COLOR: Record<string, string> = { scheduled: "#22d3ee", done: "#c6ff3d", cancelled: "#52525b", "no-show": "#fb923c" };

export default function BookingModal({ clients, booking, defaultDate, defaultTime, defaultClientIds, onSave, onDelete, onClose }: {
  clients: ClientListItem[];
  booking?: Booking;
  defaultDate?: string;
  defaultTime?: string;
  defaultClientIds?: string[];
  onSave: (patch: Omit<Booking, "id" | "clientIds">, clientIds: string[]) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(booking?.date || defaultDate || today());
  const [clientQuery, setClientQuery] = useState("");
  const [time, setTime] = useState(booking?.time || defaultTime || "18:00");
  const [duration, setDuration] = useState(String(booking?.duration ?? 60));
  const [status, setStatus] = useState(booking?.status || "scheduled");
  const [note, setNote] = useState(booking?.note || "");
  const [recurring, setRecurring] = useState(!!booking?.recurring);
  const [recurUntil, setRecurUntil] = useState(booking?.recurUntil || "");
  // B03: из карточки подопечного клиент подставляется сразу
  const [clientIds, setClientIds] = useState<string[]>(booking?.clientIds || defaultClientIds || []);

  const [selectedDayId, setSelectedDayId] = useState(booking?.dayId ?? "");
  const [selectedDayName, setSelectedDayName] = useState(booking?.dayName ?? "");
  const [clientPlans, setClientPlans] = useState<{ id: string; name: string; days: { id: string; name: string }[] }[]>([]);

  useEffect(() => {
    if (clientIds.length !== 1) { setClientPlans([]); return; }
    const cid = clientIds[0];
    (async () => {
      try {
        const { data: plans } = await supabase.from("plans").select("id,name").eq("client_id", cid).is("deleted_at", null).order("created_at", { ascending: false });
        if (!plans?.length) { setClientPlans([]); return; }
        const { data: days } = await supabase.from("plan_days").select("id,name,plan_id").in("plan_id", plans.map(p => p.id)).order("position");
        const byPlan: Record<string, { id: string; name: string }[]> = {};
        for (const d of days ?? []) (byPlan[d.plan_id] ??= []).push({ id: d.id, name: d.name });
        setClientPlans(plans.map(p => ({ id: p.id, name: p.name, days: byPlan[p.id] ?? [] })));
      } catch (e) { console.error("[BookingModal] fetchPlans:", e); }
    })();
  }, [clientIds.join(",")]);

  const toggleClient = (id: string) => setClientIds((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));

  const save = () => {
    if (!clientIds.length) { notify("Выбери хотя бы одного подопечного"); return; }
    onSave({
      planId: booking?.planId ?? null, dayId: selectedDayId || null, dayName: selectedDayName || null, date, time, duration: Number(duration) || 60, status, note,
      recurring, recurUntil: recurring ? recurUntil || null : null, exceptions: booking?.exceptions ?? {},
    }, clientIds);
  };

  // Дата: лента ближайших двух недель; дальше — через календарь. У занятия из еженедельной
  // серии дату здесь не меняем: правка ушла бы в начало всей серии — перенос одного
  // занятия делается перетаскиванием в календаре.
  const dateLocked = !!booking?.recurring;
  const strip = Array.from({ length: 14 }, (_, i) => addDays(today(), i));
  if (!strip.includes(date)) strip.unshift(date);
  const dateInput = useRef<HTMLInputElement>(null);
  const wd = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", "");
  const q = clientQuery.trim().toLowerCase();
  // Выбранные — первыми; при длинном списке — поиск
  const shown = [...clients].sort((a, b) => Number(clientIds.includes(b.id)) - Number(clientIds.includes(a.id)))
    .filter((c) => !q || clientIds.includes(c.id) || c.name.toLowerCase().includes(q));
  const durs = ["45", "60", "90"];
  if (!durs.includes(duration)) durs.push(duration);
  const label = (s: string) => <span className="block text-sm font-semibold text-zinc-400 mb-2">{s}</span>;

  return (
    <ModalShell title={booking ? "Запись" : "Новая запись"} onClose={onClose}>
      <div className="p-4 space-y-4 overflow-y-auto">
        <div>
          {label("Кто")}
          {clients.length > 8 && (
            <div className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 h-10 mb-2">
              <Search size={15} className="text-zinc-500 shrink-0" />
              <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Найти подопечного" className="flex-1 min-w-0 bg-transparent outline-none" />
            </div>
          )}
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
            {shown.map((c) => {
              const on = clientIds.includes(c.id);
              return (
                <button key={c.id} onClick={() => toggleClient(c.id)} aria-pressed={on}
                  className={`shrink-0 flex items-center gap-2 h-10 pl-1.5 pr-3.5 rounded-full bg-zinc-800 text-sm font-semibold transition ${on ? "ring-2 ring-inset ring-lime-400 text-zinc-100" : "text-zinc-300 hover:bg-zinc-700"}`}>
                  <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-zinc-950" style={{ background: c.color }}>{initials(c.name)}</span>
                  {c.name.split(" ")[0]}
                  <RemainingBadge remaining={c.remaining} />
                </button>
              );
            })}
            {clients.length === 0 && <p className="text-sm text-zinc-500">Нет подопечных</p>}
          </div>
          {clientIds.length === 2 && <p className="text-[13px] text-zinc-500 mt-1.5">Двое — сплит: по записи начнётся совместная тренировка</p>}
        </div>

        <div>
          {label("Когда")}
          {dateLocked ? (
            <p className="h-11 flex items-center px-3.5 rounded-xl bg-zinc-800 font-semibold">{fmtDateLabel(date)}</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
              {strip.map((d) => (
                <button key={d} onClick={() => setDate(d)} aria-pressed={d === date}
                  className={`shrink-0 w-[3.6rem] h-[3.9rem] rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition ${d === date ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>
                  {d === today() ? "Сегодня" : wd(d)}
                  <span className={`text-lg font-bold ${d === date ? "" : "text-zinc-100"}`}>{Number(d.slice(8))}</span>
                </button>
              ))}
              <button onClick={() => { const el = dateInput.current; if (el && "showPicker" in el) { try { el.showPicker(); return; } catch { /* старые браузеры */ } } el?.focus(); }}
                aria-label="Другая дата" title="Другая дата"
                className="shrink-0 w-[3.6rem] h-[3.9rem] rounded-xl flex items-center justify-center bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition relative">
                <CalendarDays size={20} />
                <input ref={dateInput} type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} tabIndex={-1} aria-hidden className="absolute inset-0 opacity-0 pointer-events-none" />
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-[1fr_1.35fr] gap-2.5">
          <div>
            {label("Время")}
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full h-11 bg-zinc-800 rounded-xl px-3 font-bold outline-none focus:ring-1 focus:ring-lime-400/40" />
          </div>
          <div>
            {label("Минут")}
            <div className="flex p-1 rounded-xl bg-zinc-800 h-11">
              {durs.map((d) => (
                <button key={d} onClick={() => setDuration(d)} aria-pressed={d === duration}
                  className={`flex-1 rounded-lg text-sm font-semibold transition ${d === duration ? "bg-zinc-950 text-zinc-100" : "text-zinc-400"}`}>{d}</button>
              ))}
            </div>
          </div>
        </div>

        {booking && (
          <div>
            {label("Статус")}
            <div className="grid grid-cols-2 gap-2">
              {/* «Не пришёл» ставится кнопкой в карточке записи — там спрашиваем причину и списываем */}
              {Object.entries(BOOKING_STATUS_LABEL).filter(([k]) => k !== "no-show" || booking?.status === "no-show").map(([k, l]) => (
                <button key={k} onClick={() => setStatus(k)} aria-pressed={status === k}
                  className={`h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition ${status === k ? "bg-zinc-100 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
                  <span className="w-2 h-2 rounded-full" style={{ background: BOOKING_STATUS_COLOR[k] }} />{l}
                </button>
              ))}
            </div>
          </div>
        )}

        {!booking && (
          <label className="flex items-center gap-3 min-h-[48px] cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            <span className="relative w-11 h-7 shrink-0 rounded-full bg-zinc-700 peer-checked:bg-lime-400 transition after:content-[''] after:absolute after:top-1 after:left-1 after:w-5 after:h-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
            <span className="font-semibold">Повторять каждую неделю</span>
          </label>
        )}
        {!booking && recurring && (
          <div>
            {label("До какой даты (необязательно)")}
            <input type="date" value={recurUntil} onChange={(e) => setRecurUntil(e.target.value)} className="w-full h-11 bg-zinc-800 rounded-xl px-3 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </div>
        )}

        {clientPlans.length > 0 && (
          <div>
            {label("План и день (необязательно)")}
            <select
              value={selectedDayId}
              onChange={(e) => {
                const opt = e.target.options[e.target.selectedIndex];
                setSelectedDayId(e.target.value);
                setSelectedDayName(opt.dataset.name || "");
              }}
              className="w-full h-11 bg-zinc-800 rounded-xl px-3 outline-none focus:ring-1 focus:ring-lime-400/40"
            >
              <option value="">Не выбрано</option>
              {clientPlans.flatMap((p) => p.days.map((d) => (
                <option key={d.id} value={d.id} data-name={d.name}>{p.name} · {d.name}</option>
              )))}
            </select>
          </div>
        )}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка" rows={2} className="w-full bg-zinc-800 rounded-xl px-3 py-2.5 outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" />
      </div>
      <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-2 shrink-0">
        {booking && onDelete && (
          <button onClick={onDelete} title="Удалить запись" aria-label="Удалить запись" className="w-12 h-12 shrink-0 flex items-center justify-center rounded-xl bg-zinc-800 hover:bg-red-500/15 text-zinc-400 hover:text-red-400 transition"><Trash2 size={18} /></button>
        )}
        <button onClick={save} disabled={!clientIds.length} className="flex-1 h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98] disabled:opacity-40">
          {booking ? "Сохранить" : clientIds.length ? `Записать · ${wd(date)} ${time}` : "Выберите подопечного"}
        </button>
      </div>
    </ModalShell>
  );
}
