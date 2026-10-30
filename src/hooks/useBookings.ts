import { useEffect, useRef, useState } from "react";
import { useSharedListSync } from "./useSharedListSync";
import { onWorkoutFinished } from "../lib/clientsBus";
import * as api from "../lib/bookings";
import type { Booking } from "../lib/bookings";
import { cached, peekCache } from "../lib/offlineCache";

export function useBookings(trainerId: string) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);

  const load = () => { const req = ++reqRef.current; cached("bookings", () => api.fetchBookings(trainerId)).then((b) => { if (req === reqRef.current) { setBookings(b); setLoading(false); } }).catch((e) => { if (req === reqRef.current) setLoading(false); console.error("[useBookings]", e); }); };
  // trainerId пуст, пока App.tsx не понял, тренер это или клиент — до тех пор не ходим в базу.
  // Смена или выход пользователя — чужие записи не держим и поздний ответ не принимаем.
  // Сохранённые показываем сразу, пока идёт запрос
  useEffect(() => {
    reqRef.current++;
    const saved = trainerId ? peekCache<Booking[]>("bookings")?.data : undefined;
    setBookings(saved ?? []); setLoading(!saved);
    if (trainerId) load();
  }, [trainerId]);

  const addBooking = async (patch: Omit<Booking, "id" | "clientIds">, clientIds: string[]) => { const id = await api.addBooking(trainerId, patch, clientIds); await load(); return id; };
  const updateBooking = async (id: string, patch: Partial<Omit<Booking, "id" | "clientIds">>, clientIds?: string[]) => {
    await api.updateBooking(id, patch);
    if (clientIds) await api.setBookingClients(id, clientIds);
    await load();
  };
  const deleteBooking = async (id: string) => { await api.deleteBooking(id); await load(); };
  // Статус занятия и списания — одной серверной транзакцией (api.markOccurrence).
  // occDate — дата вхождения серии; у разовой записи не нужна. Календарь перечитываем
  // и после ошибки: ответ мог не дойти, а отметка — пройти.
  const markOccurrence = async (id: string, occDate: string | null, status: string, chargeClientIds: string[] = [], note?: string) => {
    try { return await api.markOccurrence(id, occDate, status, chargeClientIds, note); }
    finally { load(); }
  };
  const occKey = (b: Booking, occDate: string) => (b.recurring ? occDate : null);
  const cancelOccurrence = async (b: Booking, date: string) => { await markOccurrence(b.id, occKey(b, date), "cancelled"); };
  const doneOccurrence = async (b: Booking, occDate: string) => { await markOccurrence(b.id, occKey(b, occDate), "done"); };
  // «Не пришёл»: для серии — правка только этой даты, причина дописывается в заметку;
  // chargeClientIds — кого списать (без уважительной причины)
  const noShowOccurrence = (b: Booking, occDate: string, note: string, chargeClientIds: string[] = []) =>
    markOccurrence(b.id, occKey(b, occDate), "no-show", chargeClientIds, note);
  // Перенос одного занятия (drag-and-drop в неделе): для разовой записи двигаем дату/время, для повторяющейся — точечная exception на эту дату.
  const rescheduleOccurrence = async (b: Booking, occDate: string, newDate: string, newTime?: string) => {
    try { await api.moveOccurrence(b.id, occKey(b, occDate), newDate, newTime); }
    finally { load(); }
  };

  // А4: обновление из другого окна — возврат к окну и события репликации
  useSharedListSync(!!trainerId, ["bookings", "booking_clients"], load, `bookings-sync-${trainerId}`);
  // Завершённая тренировка отмечает запись «проведена» — календарь видит это сразу
  useEffect(() => (trainerId ? onWorkoutFinished(() => load()) : undefined), [trainerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { bookings, loading, addBooking, updateBooking, deleteBooking, markOccurrence, cancelOccurrence, doneOccurrence, noShowOccurrence, rescheduleOccurrence, reload: load };
}
