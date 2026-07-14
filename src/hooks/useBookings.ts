import { useEffect, useState } from "react";
import * as api from "../lib/bookings";
import type { Booking } from "../lib/bookings";

export function useBookings(trainerId: string) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => api.fetchBookings(trainerId).then((b) => { setBookings(b); setLoading(false); });
  useEffect(() => { load(); }, [trainerId]);

  const addBooking = async (patch: Omit<Booking, "id" | "clientIds">, clientIds: string[]) => { await api.addBooking(trainerId, patch, clientIds); await load(); };
  const updateBooking = async (id: string, patch: Partial<Omit<Booking, "id" | "clientIds">>, clientIds?: string[]) => {
    await api.updateBooking(id, patch);
    if (clientIds) await api.setBookingClients(id, clientIds);
    await load();
  };
  const deleteBooking = async (id: string) => { await api.deleteBooking(id); await load(); };
  const cancelOccurrence = async (b: Booking, date: string) => { await api.cancelOccurrence(b, date); await load(); };
  const doneOccurrence = async (b: Booking, occDate: string) => { await api.setException(b, occDate, { status: "done" }); await load(); };
  // Перенос одного занятия (drag-and-drop в неделе): для разовой записи двигаем дату/время, для повторяющейся — точечная exception на эту дату.
  const rescheduleOccurrence = async (b: Booking, occDate: string, newDate: string, newTime?: string) => {
    const patch: Partial<Booking> = { date: newDate, ...(newTime ? { time: newTime } : {}) };
    if (!b.recurring) await api.updateBooking(b.id, patch);
    else await api.setException(b, occDate, patch);
    await load();
  };

  return { bookings, loading, addBooking, updateBooking, deleteBooking, cancelOccurrence, doneOccurrence, rescheduleOccurrence, reload: load };
}
