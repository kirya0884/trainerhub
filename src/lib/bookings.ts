import { supabase } from "./supabase";
import { addDays, today } from "./format";
import { hasSessionOnDate } from "./clients";
import { fetchAll } from "./fetchAll";

export interface Booking {
  id: string; planId: string | null; dayId: string | null; dayName: string | null;
  date: string; time: string; duration: number;
  status: string; note: string; recurring: boolean; recurUntil: string | null;
  exceptions: Record<string, any>; clientIds: string[];
}
export interface Occurrence extends Booking { occDate: string; isOccurrence: boolean }

// П.27 аудита: постранично (больше 1000 строк база за раз не отдаёт и молчит об этом);
// order по date + id — уникальный порядок, страницы не пересекаются
export async function fetchBookings(trainerId: string): Promise<Booking[]> {
  const data = await fetchAll<any>((from, to) => supabase
    .from("bookings")
    .select("*, booking_clients(client_id)")
    .eq("trainer_id", trainerId)
    .order("date").order("id")
    .range(from, to));
  return data.map((b: any) => ({
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
  const { error: delErr } = await supabase.from("booking_clients").delete().eq("booking_id", bookingId);
  if (delErr) throw delErr;
  if (clientIds.length) {
    const { error: insErr } = await supabase.from("booking_clients").insert(clientIds.map((id) => ({ booking_id: bookingId, client_id: id })));
    if (insErr) throw insErr;
  }
}

export async function deleteBooking(id: string) {
  const { error } = await supabase.from("bookings").delete().eq("id", id);
  if (error) throw error;
}

// Перенос занятия: у серии — слияние одного ключа exceptions на сервере (move_occurrence),
// статус этого занятия не трогается. Раньше сюда писался весь exceptions из копии на экране,
// и «Проведена», поставленная сервером тем временем, стиралась. occDate — исходная дата вхождения.
export async function moveOccurrence(bookingId: string, occDate: string | null, date: string, time?: string) {
  const { error } = await supabase.rpc("move_occurrence", { p_booking_id: bookingId, p_occ_date: occDate, p_date: date, p_time: time ?? null });
  if (error) throw error;
}

// «Отметить и списать» (аудит 30.10, этап 2): статус занятия и списания абонементов —
// одна транзакция на сервере (mark_occurrence). occDate — у серии дата вхождения (ключ
// exceptions, не дата после переноса), у разовой записи null. chargeClientIds — кого
// списать (только для done / no-show). Повтор того же вызова (ответ не дошёл, второе
// нажатие) не списывает второй раз: сервер помнит списание по ключу запись+дата+клиент.
export type MarkSkipReason = "same_status" | "already" | "session" | "no_membership" | "not_participant" | "nothing_to_charge";
export interface MarkResult { status: string; charged: string[]; skipped: { client_id: string; reason: MarkSkipReason }[] }
export async function markOccurrence(bookingId: string, occDate: string | null, status: string, chargeClientIds: string[] = [], note?: string): Promise<MarkResult> {
  const { data, error } = await supabase.rpc("mark_occurrence", {
    p_booking_id: bookingId, p_occ_date: occDate, p_status: status,
    p_charge_client_ids: chargeClientIds, p_note: note ?? null,
  });
  if (error) throw error;
  return data as MarkResult;
}

// ponytail: повторы раскрываются на лету в заданном диапазоне дат, без RRULE/EXDATE — exceptions хранит точечные правки/отмены конкретной даты серии
export const toMin = (t: string) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
export const bookingsOverlap = (a: Occurrence, b: Occurrence) =>
  a.date === b.date && a.status !== "cancelled" && b.status !== "cancelled" &&
  toMin(a.time) < toMin(b.time) + (Number(b.duration) || 60) && toMin(b.time) < toMin(a.time) + (Number(a.duration) || 60);

const dayNum = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
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
  // П.24 аудита: занятие перенесли В диапазон с даты ВНЕ его (пн → вт при виде «День» на
  // вторник, или через границу недели). Цикл выше перебирает только исходные даты внутри
  // диапазона и такое занятие не видел — оно пропадало из «День», «Сегодня» и автоотметки.
  for (const [k, ex] of Object.entries(b.exceptions ?? {})) {
    if (k >= rangeStart && k <= rangeEnd) continue; // исходная дата в диапазоне — учтена циклом
    if (!ex?.date || ex.status === "cancelled" || ex.date < rangeStart || ex.date > rangeEnd) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || k < b.date || (b.recurUntil && k > b.recurUntil) || (dayNum(k) - dayNum(b.date)) % 7 !== 0) continue;
    out.push({ ...b, ...ex, date: ex.date, occDate: k, isOccurrence: true });
  }
  return out;
}
export const expandBookings = (bookings: Booking[], rangeStart: string, rangeEnd: string) => bookings.flatMap((b) => expandBooking(b, rangeStart, rangeEnd));

// Даты проведённых тренировок клиента (status "done") за всё время — для истории в карточке абонемента.
export async function fetchClientDoneSessions(trainerId: string, clientId: string): Promise<{ date: string; time: string }[]> {
  const bookings = await fetchBookings(trainerId);
  const mine = bookings.filter((b) => b.clientIds.includes(clientId));
  const occs = expandBookings(mine, "2000-01-01", today());
  return occs.filter((o) => o.status === "done").map((o) => ({ date: o.date, time: o.time })).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

// Автоматически отмечает запись в календаре как «Проведена» когда тренер завершает тренировку дня.
// Ищет запись за сегодня с совпадающим dayName для данного клиента.
// Отметка — через mark_occurrence без списаний (списание сделал finishWorkout): ключ
// вхождения — его исходная дата (occDate), а не дата после переноса; правка exceptions —
// слиянием на сервере, без перезаписи всего объекта устаревшей копией.
// П.23 аудита: совместную запись (несколько подопечных) отмечаем, только когда тренировку
// за этот день записали ВСЕ её участники. Раньше её отмечал первый завершивший, и гард
// finishWorkout («запись уже проведена — списание было») не списывал второго.
export async function markSessionDone(trainerId: string, clientId: string, dayName: string, date: string) {
  try {
    const bookings = await fetchBookings(trainerId);
    const occs = expandBookings(bookings, date, date);
    const match = occs.find((o) => o.clientIds.includes(clientId) && o.dayName === dayName && o.status === "scheduled");
    if (!match) return;
    const others = match.clientIds.filter((id) => id !== clientId);
    if (others.length && !(await Promise.all(others.map((id) => hasSessionOnDate(id, date)))).every(Boolean)) return;
    await markOccurrence(match.id, match.isOccurrence ? match.occDate : null, "done");
  } catch (e) { console.error("[markSessionDone]", e); }
}
