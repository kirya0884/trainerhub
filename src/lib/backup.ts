import { supabase } from "./supabase";
import { today } from "./format";

// Бэкап тренера целиком: clients + их дочерние коллекции, plans + их дни/упражнения/прогресс,
// bookings и шаблоны. Экспорт — просто вложенный JSON (Blob/URL.createObjectURL, без библиотек).
// Импорт — ВСТАВКА новых строк с новыми id (а не замена), чтобы случайно не затереть текущие данные.
// Каждая выборка обязана пройти: копия, в которой молча нет целой таблицы (оборвалась связь),
// хуже, чем никакой — её считают полной. Ошибка прерывает экспорт, файл не скачивается.
async function must(q: PromiseLike<{ data: any[] | null; error: unknown }>): Promise<any[]> {
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function exportBackup(trainerId: string) {
  const clients = await must(supabase.from("clients").select("*").eq("trainer_id", trainerId).is("deleted_at", null));
  const clientIds = clients.map((c) => c.id);

  const childByClient = async (table: string) =>
    clientIds.length ? must(supabase.from(table).select("*").in("client_id", clientIds)) : [];

  const plans = clientIds.length ? await must(supabase.from("plans").select("*").in("client_id", clientIds).is("deleted_at", null)) : [];
  const planIds = plans.map((p) => p.id);

  const days = planIds.length ? await must(supabase.from("plan_days").select("*").in("plan_id", planIds)) : [];
  const dayIds = days.map((d) => d.id);
  const exercises = dayIds.length ? await must(supabase.from("plan_exercises").select("*").in("day_id", dayIds)) : [];
  const exIds = exercises.map((e) => e.id);
  const setRows = exIds.length ? await must(supabase.from("plan_exercise_set_rows").select("*").in("exercise_id", exIds)) : [];
  const progressNotes = planIds.length ? await must(supabase.from("plan_progress_notes").select("*").in("plan_id", planIds)) : [];
  const metrics = planIds.length ? await must(supabase.from("plan_metrics").select("*").in("plan_id", planIds)) : [];
  const sessions = planIds.length ? await must(supabase.from("plan_sessions").select("*").in("plan_id", planIds)) : [];
  const sessionIds = sessions.map((s) => s.id);
  const sessionItems = sessionIds.length ? await must(supabase.from("plan_session_items").select("*").in("session_id", sessionIds)) : [];

  const bookings = await must(supabase.from("bookings").select("*").eq("trainer_id", trainerId));
  const bookingIds = bookings.map((b) => b.id);
  const bookingClients = bookingIds.length ? await must(supabase.from("booking_clients").select("*").in("booking_id", bookingIds)) : [];

  const packageTemplates = await must(supabase.from("package_templates").select("*").eq("trainer_id", trainerId));
  const exerciseLibrary = await must(supabase.from("exercise_library").select("*").eq("trainer_id", trainerId));
  const planTemplates = await must(supabase.from("plan_templates").select("*").eq("trainer_id", trainerId));
  const dayTemplates = await must(supabase.from("day_templates").select("*").eq("trainer_id", trainerId));

  // Питание: дневник, свои продукты и рецепты, цели, вода и комментарии по дням
  const foodRecipes = await childByClient("food_recipes");
  const recipeIds = foodRecipes.map((r: any) => r.id);
  const foodRecipeItems = recipeIds.length ? await must(supabase.from("food_recipe_items").select("*").in("recipe_id", recipeIds)) : [];

  // Журнал заработка (по подопечным из копии) и журнал согласий самого тренера.
  // Согласия — только для справки: при импорте не восстанавливаются (см. importBackup).
  const sessionCharges = await childByClient("session_charges");
  const consents = await must(supabase.from("user_consents").select("*").eq("user_id", trainerId));

  return {
    version: 3, exportedAt: new Date().toISOString(),
    sessionCharges, consents,
    nutritionLogs: await childByClient("nutrition_logs"), foodProducts: await childByClient("food_products"), foodRecipes, foodRecipeItems,
    foodEntries: await childByClient("food_entries"), nutritionGoals: await childByClient("nutrition_goals"), nutritionDays: await childByClient("nutrition_days"),
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
  a.href = url; a.download = `reps-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Восстановление — построчная вставка с перегенерацией id и переподвязкой внешних ключей,
// данные трейнера всегда переписываются на текущего (trainerId), чужие бэкапы импортировать нельзя по ошибке.
export async function importBackup(trainerId: string, raw: any, onProgress?: (done: number, total: number) => void): Promise<{ skippedNutrition: number }> {
  const allItems = [
    ...(raw.clients ?? []), ...(raw.measurements ?? []), ...(raw.photos ?? []), ...(raw.payments ?? []),
    ...(raw.promotions ?? []), ...(raw.notes ?? []), ...(raw.plans ?? []), ...(raw.days ?? []),
    ...(raw.exercises ?? []), ...(raw.setRows ?? []), ...(raw.progressNotes ?? []), ...(raw.metrics ?? []),
    ...(raw.sessions ?? []), ...(raw.sessionItems ?? []), ...(raw.bookings ?? []), ...(raw.bookingClients ?? []),
    ...(raw.packageTemplates ?? []), ...(raw.exerciseLibrary ?? []), ...(raw.planTemplates ?? []), ...(raw.dayTemplates ?? []),
    ...(raw.foodProducts ?? []), ...(raw.foodRecipes ?? []), ...(raw.foodRecipeItems ?? []), ...(raw.foodEntries ?? []),
    ...(raw.nutritionGoals ?? []), ...(raw.nutritionDays ?? []), ...(raw.sessionCharges ?? []),
  ];
  const total = allItems.length;
  let done = 0;
  const tick = () => { done++; onProgress?.(done, total); };
  const idMap: Record<string, string> = {};
  const remap = (id: string) => idMap[id] ?? id;

  // Своя карточка «Я» у тренера одна (уникальный индекс): если она уже есть — данные из
  // копии переносим в неё, а не создаём вторую (раньше импорт падал на середине).
  const { data: existingSelf } = await supabase.from("clients").select("id").eq("trainer_id", trainerId).eq("is_self", true).maybeSingle();
  const selfIds = new Set<string>();
  for (const c of raw.clients ?? []) {
    const { id, trainer_id, auth_user_id, ...rest } = c;
    if (c.is_self && existingSelf) { idMap[id] = existingSelf.id; selfIds.add(existingSelf.id); tick(); continue; }
    const { data, error } = await supabase.from("clients").insert({ ...rest, trainer_id: trainerId }).select("id").single();
    tick();
    if (error) throw error;
    idMap[id] = data.id;
    if (c.is_self) selfIds.add(data.id);
  }
  // Remap partnerClientId inside membership JSONB now that all client IDs are known
  for (const c of raw.clients ?? []) {
    const partnerId = c.membership?.partnerClientId;
    if (partnerId && idMap[partnerId]) {
      const newId = idMap[c.id];
      if (!newId) continue;
      const { data: existing } = await supabase.from("clients").select("membership").eq("id", newId).single();
      if (!existing) continue;
      const membership = { ...(existing.membership ?? {}), partnerClientId: idMap[partnerId] };
      await supabase.from("clients").update({ membership }).eq("id", newId);
    }
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

  // Питание. Дневник подопечного ведёт сам подопечный — тренеру база писать в него не даёт.
  // Поэтому полностью восстанавливается только своё («Я»), а у подопечных — цели и
  // комментарии тренера. Остальное остаётся в файле, число пропущенного возвращаем.
  let skippedNutrition = 0;
  const own = (clientId: string) => selfIds.has(remap(clientId));
  for (const p of raw.foodProducts ?? []) {
    tick();
    if (!own(p.client_id)) { skippedNutrition++; continue; }
    const { id, client_id, ...rest } = p;
    const { data } = await supabase.from("food_products").insert({ ...rest, client_id: remap(client_id) }).select("id").single();
    if (data) idMap[id] = data.id;
  }
  for (const r of raw.foodRecipes ?? []) {
    tick();
    if (!own(r.client_id)) { skippedNutrition++; continue; }
    const { id, client_id, ...rest } = r;
    const { data } = await supabase.from("food_recipes").insert({ ...rest, client_id: remap(client_id) }).select("id").single();
    if (data) idMap[id] = data.id;
  }
  for (const it of raw.foodRecipeItems ?? []) {
    tick();
    if (!idMap[it.recipe_id]) { skippedNutrition++; continue; }
    const { id, recipe_id, product_id, ...rest } = it;
    await supabase.from("food_recipe_items").insert({ ...rest, recipe_id: idMap[recipe_id], product_id: product_id ? idMap[product_id] ?? null : null });
  }
  for (const e of raw.foodEntries ?? []) {
    tick();
    if (!own(e.client_id)) { skippedNutrition++; continue; }
    const { id, client_id, product_id, recipe_id, ...rest } = e;
    await supabase.from("food_entries").insert({ ...rest, client_id: remap(client_id), product_id: product_id ? idMap[product_id] ?? null : null, recipe_id: recipe_id ? idMap[recipe_id] ?? null : null });
  }
  for (const g of raw.nutritionGoals ?? []) {
    tick();
    if (!own(g.client_id) && g.set_by !== "trainer") { skippedNutrition++; continue; }
    await supabase.from("nutrition_goals").upsert({ ...g, client_id: remap(g.client_id) });
  }
  for (const d of raw.nutritionDays ?? []) {
    tick();
    if (!own(d.client_id) && !d.trainer_comment) { skippedNutrition++; continue; }
    // У подопечного вода — его данные: тренер переносит только свой комментарий
    const row = own(d.client_id) ? { ...d, client_id: remap(d.client_id) } : { client_id: remap(d.client_id), date: d.date, trainer_comment: d.trainer_comment };
    await supabase.from("nutrition_days").upsert(row);
  }
  skippedNutrition += (raw.nutritionLogs ?? []).length;

  // Журнал заработка. Подопечные из копии создаются заново (новые id), поэтому дубли
  // возможны только у карточки «Я», куда данные переносятся повторно: строку, которая уже
  // есть у этого подопечного (та же дата, вид, сумма и время создания), пропускаем.
  // Строки подопечных, которых нет в копии (удалённых), не восстанавливаем — привязать не к кому.
  const charges = (raw.sessionCharges ?? []).filter((ch: any) => idMap[ch.client_id]);
  const chargeKey = (ch: any) => [remap(ch.client_id), ch.date, ch.kind, Number(ch.amount), new Date(ch.created_at).getTime()].join("|");
  const targetIds = [...new Set(charges.map((ch: any) => remap(ch.client_id)))];
  const { data: existingCharges } = targetIds.length
    ? await supabase.from("session_charges").select("client_id,date,kind,amount,created_at").in("client_id", targetIds)
    : { data: [] as any[] };
  const seenCharges = new Set((existingCharges ?? []).map(chargeKey));
  for (const ch of raw.sessionCharges ?? []) {
    tick();
    if (!idMap[ch.client_id]) continue;
    const key = chargeKey(ch);
    // сравниваем только с тем, что было в базе до импорта: одинаковые строки внутри файла — разные списания
    if (seenCharges.has(key)) continue;
    const { id, trainer_id, client_id, ...rest } = ch;
    const { error } = await supabase.from("session_charges").insert({ ...rest, trainer_id: trainerId, client_id: remap(client_id) });
    if (error) throw error;
  }

  // Журнал согласий (raw.consents) не восстанавливаем намеренно: это запись о том, что
  // конкретный пользователь принял конкретную редакцию документов в конкретный момент.
  // Вставка из файла создала бы задним числом новые строки от имени текущего пользователя
  // (база это позволяет: insert своих строк разрешён, правка и удаление — нет, так что
  // ошибку потом не исправить). Согласия текущей учётной записи берутся из самого входа.
  return { skippedNutrition };
}
