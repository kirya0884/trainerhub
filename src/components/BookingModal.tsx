import { useState } from "react";
import { Trash2 } from "lucide-react";
import ModalShell from "./ModalShell";
import NumField from "./NumField";
import RemainingBadge from "./RemainingBadge";
import type { ClientListItem } from "../lib/clients";
import type { Booking } from "../lib/bookings";
import { today } from "../lib/format";

const fmtDateLabel = (s: string) => {
  const str = new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export const BOOKING_STATUS_LABEL: Record<string, string> = { scheduled: "Запланирована", done: "Проведена", cancelled: "Отменена", "no-show": "Не пришёл" };
export const BOOKING_STATUS_COLOR: Record<string, string> = { scheduled: "#22d3ee", done: "#a3e635", cancelled: "#52525b", "no-show": "#fb923c" };

export default function BookingModal({ clients, booking, defaultDate, defaultTime, onSave, onDelete, onClose }: {
  clients: ClientListItem[];
  booking?: Booking;
  defaultDate?: string;
  defaultTime?: string;
  onSave: (patch: Omit<Booking, "id" | "clientIds">, clientIds: string[]) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [date] = useState(booking?.date || defaultDate || today());
  const [time, setTime] = useState(booking?.time || defaultTime || "18:00");
  const [duration, setDuration] = useState(String(booking?.duration ?? 60));
  const [status, setStatus] = useState(booking?.status || "scheduled");
  const [note, setNote] = useState(booking?.note || "");
  const [recurring, setRecurring] = useState(!!booking?.recurring);
  const [recurUntil, setRecurUntil] = useState(booking?.recurUntil || "");
  const [clientIds, setClientIds] = useState<string[]>(booking?.clientIds || []);

  const toggleClient = (id: string) => setClientIds((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));

  const save = () => {
    if (!clientIds.length) { alert("Выбери хотя бы одного подопечного"); return; }
    onSave({
      planId: booking?.planId ?? null, date, time, duration: Number(duration) || 60, status, note,
      recurring, recurUntil: recurring ? recurUntil || null : null, exceptions: booking?.exceptions ?? {},
    }, clientIds);
  };

  return (
    <ModalShell title={booking ? "Запись" : "Новая запись"} onClose={onClose}>
      <div className="p-4 space-y-3 overflow-y-auto">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Подопечные</div>
          <div className="flex flex-wrap gap-1.5">
            {clients.map((c) => (
              <button key={c.id} onClick={() => toggleClient(c.id)} className={`px-2.5 py-1.5 rounded-lg text-sm transition flex items-center gap-1.5 ${clientIds.includes(c.id) ? "text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`} style={clientIds.includes(c.id) ? { background: c.color } : undefined}>
                <RemainingBadge remaining={c.remaining} /> {c.name}
              </button>
            ))}
            {clients.length === 0 && <p className="text-xs text-zinc-600">Нет подопечных</p>}
          </div>
        </div>

        <p className="text-sm text-cyan-400 font-medium">{fmtDateLabel(date)}</p>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-zinc-500">Время
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-cyan-400/40" />
          </label>
          <NumField label="Минут" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="60" />
        </div>

        {booking && (
          <label className="text-xs text-zinc-500">Статус
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-cyan-400/40">
              {Object.entries(BOOKING_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        )}

        {!booking && (
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="accent-cyan-400" /> Повторять каждую неделю
          </label>
        )}
        {!booking && recurring && (
          <label className="text-xs text-zinc-500">До какой даты
            <input type="date" value={recurUntil} onChange={(e) => setRecurUntil(e.target.value)} className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-cyan-400/40" />
          </label>
        )}

        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Заметка" rows={2} className="w-full bg-zinc-800 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40 resize-none" />
      </div>
      <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-2 shrink-0">
        {booking && onDelete && (
          <button onClick={onDelete} className="p-2.5 rounded-lg hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition"><Trash2 size={16} /></button>
        )}
        <button onClick={save} className="flex-1 bg-cyan-400 text-zinc-950 font-semibold rounded-lg py-2.5 hover:bg-cyan-300 transition">Сохранить</button>
      </div>
    </ModalShell>
  );
}
