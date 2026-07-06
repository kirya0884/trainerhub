import { supabase } from "./supabase";

// Бэкап тренера целиком: clients + их дочерние коллекции, plans + их дни/упражнения/прогресс,
// bookings и шаблоны. Экспорт — просто вложенный JSON (Blob/URL.createObjectURL, без библиотек).
// Импорт — ВСТАВКА новых строк с новыми id (а не замена), чтобы случайно не затереть текущие данные.
export async function exportBackup(trainerId: string) {
  const { data: clients } = await supabase.from("clients").select("*").eq("trainer_id", trainerId).is("deleted_at", null);
  const clientIds = (clients ?? []).map((c) => c.id);

  const childByClient = async (table: string) =>
    clientIds.length ? (await supabase.from(table).select("*").in("client_id", clientIds)).data ?? [] : [];

  const { data: plans } = clientIds.length
    ? await supabase.from("plans").select("*").in("client_id", clientIds).is("deleted_at", null)
    : { data: [] as any[] };
  const planIds = (plans ?? []).map((p) => p.id);

  const { data: days } = planIds.length ? await supabase.from("plan_days").select("*").in("plan_id", planIds) : { data: [] as any[] };
  const dayIds = (days ?? []).map((d) => d.id);
  const { data: exercises } = dayIds.length ? await supabase.from("plan_exercises").select("*").in("day_id", dayIds) : { data: [] as any[] };
  const exIds = (exercises ?? []).map((e) => e.id);
  const { data: setRows } = exIds.length ? await supabase.from("plan_exercise_set_rows").select("*").in("exercise_id", exIds) : { data: [] as any[] };
  const { data: progressNotes } = planIds.length ? await supabase.from("plan_progress_notes").select("*").in("plan_id", planIds) : { data: [] as any[] };
  const { data: metrics } = planIds.length ? await supabase.from("plan_metrics").select("*").in("plan_id", planIds) : { data: [] as any[] };
  const { data: sessions } = planIds.length ? await supabase.from("plan_sessions").select("*").in("plan_id", planIds) : { data: [] as any[] };
  const sessionIds = (sessions ?? []).map((s) => s.id);
  const { data: sessionItems } = sessionIds.length ? await supabase.from("plan_session_items").select("*").in("session_id", sessionIds) : { data: [] as any[] };

  const { data: bookings } = await supabase.from("bookings").select("*").eq("trainer_id", trainerId);
  const bookingIds = (bookings ?? []).map((b) => b.id);
  const { data: bookingClients } = bookingIds.length ? await supabase.from("booking_clients").select("*").in("booking_id", bookingIds) : { data: [] as any[] };

  const { data: packageTemplates } = await supabase.from("package_templates").select("*").eq("trainer_id", trainerId);
  const { data: exerciseLibrary } = await supabase.from("exercise_library").select("*").eq("trainer_id", trainerId);
  const { data: planTemplates } = await supabase.from("plan_templates").select("*").eq("trainer_id", trainerId);
  const { data: dayTemplates } = await supabase.from("day_templates").select("*").eq("trainer_id", trainerId);

  return {
    version: 1, exportedAt: new Date().toISOString(),
    clients, measurements: await childByClient("client_measurements"), photos: await childByClient("client_photos"),
    payments: await childByClient("client_payments"), promotions: await childByClient("client_promotions"), notes: await childByClient("client_notes"),
    plans, days, exercises, setRows, progressNotes, metrics, sessions, sessionItems,
    bookings, bookingClients, packageTemplates, exerciseLibrary, planTemplates, dayTemplates,
  };
}

export function downloadBackup(data: object) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `trainerhub-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Восстановление — построчная вставка с перегенерацией id и переподвязкой внешних ключей,
// данные трейнера всегда переписываются на текущего (trainerId), чужие бэкапы импортировать нельзя по ошибке.
export async function importBackup(trainerId: string, raw: any, onProgress?: (done: number, total: number) => void) {
  const allItems = [
    ...(raw.clients ?? []), ...(raw.measurements ?? []), ...(raw.photos ?? []), ...(raw.payments ?? []),
    ...(raw.promotions ?? []), ...(raw.notes ?? []), ...(raw.plans ?? []), ...(raw.days ?? []),
    ...(raw.exercises ?? []), ...(raw.setRows ?? []), ...(raw.progressNotes ?? []), ...(raw.metrics ?? []),
    ...(raw.sessions ?? []), ...(raw.sessionItems ?? []), ...(raw.bookings ?? []), ...(raw.bookingClients ?? []),
    ...(raw.packageTemplates ?? []), ...(raw.exerciseLibrary ?? []), ...(raw.planTemplates ?? []), ...(raw.dayTemplates ?? []),
  ];
  const total = allItems.length;
  let done = 0;
  const tick = () => { done++; onProgress?.(done, total); };
  const idMap: Record<string, string> = {};
  const remap = (id: string) => idMap[id] ?? id;

  for (const c of raw.clients ?? []) {
    const { id, trainer_id, auth_user_id, ...rest } = c;
    const { data, error } = await supabase.from("clients").insert({ ...rest, trainer_id: trainerId }).select("id").single();
    tick();
    if (error) throw error;
    idMap[id] = data.id;
  }
  for (const m of raw.measurements ?? []) {
    const { id, client_id, ...rest } = m;
    await supabase.from("client_measurements").insert({ ...rest, client_id: remap(client_id) });
    tick();
  }
  for (const p of raw.photos ?? []) {
    const { id, client_id, ...rest } = p;
    await supabase.from("client_photos").insert({ ...rest, client_id: remap(client_id) });
    tick();
  }
  for (const p of raw.payments ?? []) {
    const { id, client_id, ...rest } = p;
    await supabase.from("client_payments").insert({ ...rest, client_id: remap(client_id) });
    tick();
  }
  for (const p of raw.promotions ?? []) {
    const { id, client_id, ...rest } = p;
    await supabase.from("client_promotions").insert({ ...rest, client_id: remap(client_id) });
    tick();
  }
  for (const n of raw.notes ?? []) {
    const { id, client_id, ...rest } = n;
    await supabase.from("client_notes").insert({ ...rest, client_id: remap(client_id) });
    tick();
  }

  for (const p of raw.plans ?? []) {
    const { id, trainer_id, client_id, ...rest } = p;
    const { data, error } = await supabase.from("plans").insert({ ...rest, trainer_id: trainerId, client_id: remap(client_id) }).select("id").single();
    tick();
    if (error) throw error;
    idMap[id] = data.id;
  }
  for (const d of raw.days ?? []) {
    const { id, plan_id, ...rest } = d;
    const { data, error } = await supabase.from("plan_days").insert({ ...rest, plan_id: remap(plan_id) }).select("id").single();
    tick();
    if (error) throw error;
    idMap[id] = data.id;
  }
  for (const e of raw.exercises ?? []) {
    const { id, day_id, ...rest } = e;
    const { data, error } = await supabase.from("plan_exercises").insert({ ...rest, day_id: remap(day_id) }).select("id").single();
    tick();
    if (error) throw error;
    idMap[id] = data.id;
  }
  for (const r of raw.setRows ?? []) {
    const { id, exercise_id, ...rest } = r;
    await supabase.from("plan_exercise_set_rows").insert({ ...rest, exercise_id: remap(exercise_id) });
    tick();
  }
  for (const n of raw.progressNotes ?? []) {
    const { id, plan_id, ...rest } = n;
    await supabase.from("plan_progress_notes").insert({ ...rest, plan_id: remap(plan_id) });
    tick();
  }
  for (const m of raw.metrics ?? []) {
    const { id, plan_id, ...rest } = m;
    await supabase.from("plan_metrics").insert({ ...rest, plan_id: remap(plan_id) });
    tick();
  }
  for (const s of raw.sessions ?? []) {
    const { id, plan_id, ...rest } = s;
    const { data, error } = await supabase.from("plan_sessions").insert({ ...rest, plan_id: remap(plan_id) }).select("id").single();
    tick();
    if (error) throw error;
    idMap[id] = data.id;
  }
  for (const it of raw.sessionItems ?? []) {
    const { id, session_id, ...rest } = it;
    await supabase.from("plan_session_items").insert({ ...rest, session_id: remap(session_id) });
    tick();
  }

  for (const b of raw.bookings ?? []) {
    const { id, trainer_id, plan_id, ...rest } = b;
    const { data, error } = await supabase.from("bookings").insert({ ...rest, trainer_id: trainerId, plan_id: plan_id ? remap(plan_id) : null }).select("id").single();
    tick();
    if (error) throw error;
    idMap[id] = data.id;
  }
  for (const bc of raw.bookingClients ?? []) {
    await supabase.from("booking_clients").insert({ booking_id: remap(bc.booking_id), client_id: remap(bc.client_id) });
    tick();
  }

  for (const t of raw.packageTemplates ?? []) {
    const { id, trainer_id, ...rest } = t;
    await supabase.from("package_templates").insert({ ...rest, trainer_id: trainerId });
    tick();
  }
  for (const t of raw.exerciseLibrary ?? []) {
    const { id, trainer_id, ...rest } = t;
    await supabase.from("exercise_library").insert({ ...rest, trainer_id: trainerId });
    tick();
  }
  for (const t of raw.planTemplates ?? []) {
    const { id, trainer_id, ...rest } = t;
    await supabase.from("plan_templates").insert({ ...rest, trainer_id: trainerId });
    tick();
  }
  for (const t of raw.dayTemplates ?? []) {
    const { id, trainer_id, ...rest } = t;
    await supabase.from("day_templates").insert({ ...rest, trainer_id: trainerId });
    tick();
  }
}
