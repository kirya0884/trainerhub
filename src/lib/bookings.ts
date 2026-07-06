import { supabase } from "./supabase";
import { addDays } from "./format";

export interface Booking {
  id: string; planId: string | null; dayId: string | null; dayName: string | null;
  date: string; time: string; duration: number;
  status: string; note: string; recurring: boolean; recurUntil: string | null;
  exceptions: Record<string, any>; clientIds: string[];
}
export interface Occurrence extends Booking { occDate: string; isOccurrence: boolean }

export async function fetchBookings(trainerId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, booking_clients(client_id)")
    .eq("trainer_id", trainerId)
    .order("date");
  if (error) throw error;
  return (data ?? []).map((b: any) => ({
    id: b.id, planId: b.plan_id, dayId: b.day_id ?? null, dayName: b.day_name ?? null,
    date: b.date, time: b.time ?? "", duration: b.duration ?? 60,
    status: b.status ?? "scheduled", note: b.note ?? "", recurring: !!b.recurring, recurUntil: b.recur_until,
    exceptions: b.exceptions ?? {}, clientIds: (b.booking_clients ?? []).map((x: any) => x.client_id),
  }));
}

export async function addBooking(trainerId: string, patch: Omit<Booking, "id" | "clientIds">, clientIds: string[]) {
  const { data, error } = await supabase.from("bookings").insert({
    trainer_id: trainerId, plan_id: patch.planId, day_id: patch.dayId, day_name: patch.dayName,
    date: patch.date, time: patch.time, duration: patch.duration,
    status: patch.status, note: patch.note, recurring: patch.recurring, recur_until: patch.recurUntil,
  }).select().single();
  if (error) throw error;
  if (clientIds.length) {
    const { error: bcErr } = await supabase.from("booking_clients").insert(clientIds.map((id) => ({ booking_id: data.id, client_id: id })));
    if (bcErr) throw bcErr;
  }
  return data.id as string;
}

export async function updateBooking(id: string, patch: Partial<Omit<Booking, "id" | "clientIds">>) {
  const row: Record<string, any> = {};
  if ("planId" in patch) row.plan_id = patch.planId;
  if ("dayId" in patch) row.day_id = patch.dayId;
  if ("dayName" in patch) row.day_name = patch.dayName;
  if ("recurUntil" in patch) row.recur_until = patch.recurUntil;
  for (const k of ["date", "time", "duration", "status", "note", "recurring", "exceptions"] as const) if (k in patch) row[k] = (patch as any)[k];
  const { error } = await supabase.from("bookings").update(row).eq("id", id);
  if (error) throw error;
}

export async function setBookingClients(bookingId: string, clientIds: string[]) {
  await supabase.from("booking_clients").delete().eq("booking_id", bookingId);
  if (clientIds.length) await supabase.from("booking_clients").insert(clientIds.map((id) => ({ booking_id: bookingId, client_id: id })));
}

export const deleteBooking = (id: string) => supabase.from("bookings").delete().eq("id", id);

// Запись одного занятия серии — пишем точечную правку в exceptions, саму серию не трогаем
export async function setException(booking: Booking, date: string, patch: Record<string, any>) {
  const exceptions = { ...booking.exceptions, [date]: { ...(booking.exceptions[date] || {}), ...patch } };
  const { error } = await supabase.from("bookings").update({ exceptions }).eq("id", booking.id);
  if (error) throw error;
  return exceptions;
}
export const cancelOccurrence = (booking: Booking, date: string) => setException(booking, date, { status: "cancelled" });

// ponytail: повторы раскрываются на лету в заданном диапазоне дат, без RRULE/EXDATE — exceptions хранит точечные правки/отмены конкретной даты серии
export const toMin = (t: string) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
export const bookingsOverlap = (a: Occurrence, b: Occurrence) =>
  a.date === b.date && a.status !== "cancelled" && b.status !== "cancelled" &&
  toMin(a.time) < toMin(b.time) + (Number(b.duration) || 60) && toMin(b.time) < toMin(a.time) + (Number(a.duration) || 60);

export function expandBooking(b: Booking, rangeStart: string, rangeEnd: string): Occurrence[] {
  if (!b.recurring) return b.date >= rangeStart && b.date <= rangeEnd ? [{ ...b, occDate: b.date, isOccurrence: false }] : [];
  const until = b.recurUntil && b.recurUntil < rangeEnd ? b.recurUntil : rangeEnd;
  const out: Occurrence[] = [];
  let d = b.date;
  while (d < rangeStart) d = addDays(d, 7);
  while (d <= until && d <= rangeEnd) {
    const ex = b.exceptions?.[d];
    if (ex?.status !== "cancelled") {
      const occ = { ...b, ...ex, date: ex?.date || d, occDate: d, isOccurrence: true };
      if (occ.date >= rangeStart && occ.date <= rangeEnd) out.push(occ);
    }
    d = addDays(d, 7);
  }
  return out;
}
export const expandBookings = (bookings: Booking[], rangeStart: string, rangeEnd: string) => bookings.flatMap((b) => expandBooking(b, rangeStart, rangeEnd));

// Даты проведённых тренировок клиента (status "done") за всё время — для истории в карточке абонемента.
export async function fetchClientDoneSessions(trainerId: string, clientId: string): Promise<{ date: string; time: string }[]> {
  const bookings = await fetchBookings(trainerId);
  const mine = bookings.filter((b) => b.clientIds.includes(clientId));
  const occs = expandBookings(mine, "2000-01-01", new Date().toISOString().slice(0, 10));
  return occs.filter((o) => o.status === "done").map((o) => ({ date: o.date, time: o.time })).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

// Автоматически отмечает запись в календаре как «Проведена» когда тренер завершает тренировку дня.
// Ищет запись за сегодня с совпадающим dayName для данного клиента.
export async function markSessionDone(trainerId: string, clientId: string, dayName: string, date: string) {
  try {
    const bookings = await fetchBookings(trainerId);
    const occs = expandBookings(bookings, date, date);
    const match = occs.find((o) => o.clientIds.includes(clientId) && o.dayName === dayName && o.status === "scheduled");
    if (match) await updateBooking(match.id, { status: "done" });
  } catch {}
}
