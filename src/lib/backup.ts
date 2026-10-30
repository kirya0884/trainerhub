import { supabase } from "./supabase";
import { today } from "./format";
import { fetchAll, fetchAllIn } from "./fetchAll";

// Бэкап тренера целиком: clients + их дочерние коллекции, plans + их дни/упражнения/прогресс,
// bookings и шаблоны. Экспорт — просто вложенный JSON (Blob/URL.createObjectURL, без библиотек).
// Импорт — ВСТАВКА новых строк с новыми id (а не замена), чтобы случайно не затереть текущие данные.
// Каждая выборка обязана пройти: копия, в которой молча нет целой таблицы (оборвалась связь),
// хуже, чем никакой — её считают полной. Ошибка прерывает экспорт, файл не скачивается.
// Выборки — постранично (fetchAll): больше 1000 строк база за раз не отдаёт и молчит об этом.
type Row = Record<string, any>;
// Порядок по уникальному ключу — без него страницы могут пересечься
const KEYS: Record<string, string[]> = {
  booking_clients: ["booking_id", "client_id"], nutrition_goals: ["client_id", "set_by"], nutrition_days: ["client_id", "date"],
  exercise_library: ["name"], // есть ли столбец id — не проверено; имя есть точно
};
const ordered = (q: any, table: string) => (KEYS[table] ?? ["id"]).reduce((acc, k) => acc.order(k), q);
/** Все строки таблицы, где col = value */
const byEq = (table: string, col: string, value: string) =>
  fetchAll<Row>((from, to) => ordered(supabase.from(table).select("*").eq(col, value), table).range(from, to));
/** Все строки таблицы, где col входит в ids */
const byIds = (table: string, col: string, ids: string[]) =>
  fetchAllIn<Row>(ids, (chunk, from, to) => ordered(supabase.from(table).select("*").in(col, chunk), table).range(from, to));

export async function exportBackup(trainerId: string) {
  const clients = (await byEq("clients", "trainer_id", trainerId)).filter((c) => !c.deleted_at);
  const clientIds = clients.map((c) => c.id);
  const childByClient = (table: string) => byIds(table, "client_id", clientIds);

  const plans = (await byIds("plans", "client_id", clientIds)).filter((p) => !p.deleted_at);
  const planIds = plans.map((p) => p.id);

  // Мезоциклы: без них дни в восстановленном плане ссылались бы на мезоциклы старого плана
  const mesocycles = await byIds("plan_mesocycles", "plan_id", planIds);
  const days = await byIds("plan_days", "plan_id", planIds);
  const exercises = await byIds("plan_exercises", "day_id", days.map((d) => d.id));
  const setRows = await byIds("plan_exercise_set_rows", "exercise_id", exercises.map((e) => e.id));
  const progressNotes = await byIds("plan_progress_notes", "plan_id", planIds);
  const metrics = await byIds("plan_metrics", "plan_id", planIds);
  const sessions = await byIds("plan_sessions", "plan_id", planIds);
  const sessionItems = await byIds("plan_session_items", "session_id", sessions.map((s) => s.id));

  const bookings = await byEq("bookings", "trainer_id", trainerId);
  const bookingClients = await byIds("booking_clients", "booking_id", bookings.map((b) => b.id));

  const packageTemplates = await byEq("package_templates", "trainer_id", trainerId);
  const exerciseLibrary = await byEq("exercise_library", "trainer_id", trainerId);
  const planTemplates = await byEq("plan_templates", "trainer_id", trainerId);
  const dayTemplates = await byEq("day_templates", "trainer_id", trainerId);

  // Питание: дневник, свои продукты и рецепты, цели, вода и комментарии по дням
  const foodRecipes = await childByClient("food_recipes");
  const foodRecipeItems = await byIds("food_recipe_items", "recipe_id", foodRecipes.map((r) => r.id));

  // Журнал заработка (по подопечным из копии) и журнал согласий самого тренера.
  // Согласия — только для справки: при импорте не восстанавливаются (см. importBackup).
  const sessionCharges = await childByClient("session_charges");
  const consents = await byEq("user_consents", "user_id", trainerId);

  return {
    version: 3, exportedAt: new Date().toISOString(),
    sessionCharges, consents,
    nutritionLogs: await childByClient("nutrition_logs"), foodProducts: await childByClient("food_products"), foodRecipes, foodRecipeItems,
    foodEntries: await childByClient("food_entries"), nutritionGoals: await childByClient("nutrition_goals"), nutritionDays: await childByClient("nutrition_days"),
    clients, measurements: await childByClient("client_measurements"), photos: await childByClient("client_photos"),
    payments: await childByClient("client_payments"), promotions: await childByClient("client_promotions"), notes: await childByClient("client_notes"),
    plans, mesocycles, days, exercises, setRows, progressNotes, metrics, sessions, sessionItems,
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

// Восстановление — вставка пачками с новыми id и переподвязкой внешних ключей. Новые id
// создаются здесь же (crypto.randomUUID): ссылки переподвязываются до вставки, и не нужен
// отдельный запрос с ответом на каждую строку (раньше — тысячи запросов).
// Любая ошибка базы прерывает импорт (раньше половина вставок падала молча). Уже вставленное
// при этом остаётся — повторный импорт того же файла создаст дубли.
// Данные тренера всегда переписываются на текущего (trainerId), чужие бэкапы импортировать нельзя по ошибке.
const BATCH = 500;

export async function importBackup(trainerId: string, raw: any, onProgress?: (done: number, total: number) => void): Promise<{ skippedNutrition: number }> {
  const list = (k: string): Row[] => (Array.isArray(raw?.[k]) ? raw[k] : []);
  const total = [
    "clients", "measurements", "photos", "payments", "promotions", "notes", "plans", "mesocycles", "days",
    "exercises", "setRows", "progressNotes", "metrics", "sessions", "sessionItems", "bookings", "bookingClients",
    "packageTemplates", "exerciseLibrary", "planTemplates", "dayTemplates",
    "foodProducts", "foodRecipes", "foodRecipeItems", "foodEntries", "nutritionGoals", "nutritionDays", "sessionCharges",
  ].reduce((n, k) => n + list(k).length, 0);
  let done = 0;
  const tick = (n: number) => { done += n; onProgress?.(done, total); };
  const idMap: Record<string, string> = {};
  const remap = (id: string) => idMap[id] ?? id;
  /** Новый id строки из копии; ссылки на неё дальше переподвязываются через remap */
  const fresh = (oldId: string) => (idMap[oldId] = crypto.randomUUID());
  /** Ссылка на строку, которой в копии может не быть (день, мезоцикл, продукт): нет — обнуляем */
  const link = (r: Row, col: string) => (col in r ? { [col]: r[col] ? idMap[r[col]] ?? null : null } : {});

  /** Вставить строки копии пачками; toRow вернул null — строку пропустить */
  const put = async (table: string, source: Row[], toRow: (r: Row) => Row | null, upsert = false) => {
    const rows = source.map(toRow).filter((r): r is Row => r !== null);
    tick(source.length - rows.length);
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = rows.slice(i, i + BATCH);
      // defaultToNull: false — столбцы, которых нет в старой копии, база заполнит значениями по умолчанию
      const { error } = upsert
        ? await supabase.from(table).upsert(part, { defaultToNull: false })
        : await supabase.from(table).insert(part, { defaultToNull: false });
      if (error) throw error;
      tick(part.length);
    }
  };
  /** Дочерние строки без своих ссылок на них: новый id даст база */
  const child = (table: string, key: string, col: string) =>
    put(table, list(key), ({ id, ...r }) => ({ ...r, [col]: remap(r[col]) }));

  // Своя карточка «Я» у тренера одна (уникальный индекс): если она уже есть — данные из
  // копии переносим в неё, а не создаём вторую (раньше импорт падал на середине).
  const { data: existingSelf, error: selfErr } = await supabase.from("clients").select("id").eq("trainer_id", trainerId).eq("is_self", true).maybeSingle();
  if (selfErr) throw selfErr;
  const selfIds = new Set<string>();
  // Сначала все новые id — чтобы сразу переподвязать партнёра по абонементу (membership.partnerClientId)
  for (const c of list("clients")) {
    if (c.is_self && existingSelf) idMap[c.id] = existingSelf.id; else fresh(c.id);
    if (c.is_self) selfIds.add(idMap[c.id]);
  }
  await put("clients", list("clients"), (c) => {
    if (c.is_self && existingSelf) return null;
    // Вход подопечного и PIN к копии не относятся: база их всё равно обнуляет при вставке
    const { auth_user_id, pin_hash, ...rest } = c;
    const partner = c.membership?.partnerClientId;
    return {
      ...rest, id: idMap[c.id], trainer_id: trainerId,
      ...(partner && idMap[partner] ? { membership: { ...c.membership, partnerClientId: idMap[partner] } } : {}),
    };
  });
  await child("client_measurements", "measurements", "client_id");
  await child("client_photos", "photos", "client_id");
  await child("client_payments", "payments", "client_id");
  await child("client_promotions", "promotions", "client_id");
  await child("client_notes", "notes", "client_id");

  await put("plans", list("plans"), ({ id, ...r }) => ({ ...r, id: fresh(id), trainer_id: trainerId, client_id: remap(r.client_id) }));
  await put("plan_mesocycles", list("mesocycles"), ({ id, ...r }) => ({ ...r, id: fresh(id), plan_id: remap(r.plan_id) }));
  await put("plan_days", list("days"), ({ id, ...r }) => ({ ...r, id: fresh(id), plan_id: remap(r.plan_id), ...link(r, "mesocycle_id") }));
  await put("plan_exercises", list("exercises"), ({ id, ...r }) => ({ ...r, id: fresh(id), day_id: remap(r.day_id) }));
  await child("plan_exercise_set_rows", "setRows", "exercise_id");
  await child("plan_progress_notes", "progressNotes", "plan_id");
  await child("plan_metrics", "metrics", "plan_id");
  await put("plan_sessions", list("sessions"), ({ id, ...r }) => ({ ...r, id: fresh(id), plan_id: remap(r.plan_id), ...link(r, "day_id") }));
  await child("plan_session_items", "sessionItems", "session_id");

  await put("bookings", list("bookings"), ({ id, ...r }) => ({
    ...r, id: fresh(id), trainer_id: trainerId, ...link(r, "plan_id"), ...link(r, "day_id"),
  }));
  // Подопечных, удалённых до экспорта, в копии нет — их участие в записи не переносим
  await put("booking_clients", list("bookingClients"), (bc) =>
    idMap[bc.booking_id] && idMap[bc.client_id] ? { booking_id: idMap[bc.booking_id], client_id: idMap[bc.client_id] } : null);

  const trainerOwned = (table: string, key: string) => put(table, list(key), ({ id, ...r }) => ({ ...r, trainer_id: trainerId }));
  await trainerOwned("package_templates", "packageTemplates");
  await trainerOwned("exercise_library", "exerciseLibrary");
  await trainerOwned("plan_templates", "planTemplates");
  await trainerOwned("day_templates", "dayTemplates");

  // Питание. Дневник подопечного ведёт сам подопечный — тренеру база писать в него не даёт.
  // Поэтому полностью восстанавливается только своё («Я»), а у подопечных — цели и
  // комментарии тренера. Остальное остаётся в файле, число пропущенного возвращаем.
  let skippedNutrition = 0;
  const own = (clientId: string) => selfIds.has(remap(clientId));
  const skip = () => { skippedNutrition++; return null; };
  await put("food_products", list("foodProducts"), ({ id, ...r }) =>
    own(r.client_id) ? { ...r, id: fresh(id), client_id: remap(r.client_id) } : skip());
  await put("food_recipes", list("foodRecipes"), ({ id, ...r }) =>
    own(r.client_id) ? { ...r, id: fresh(id), client_id: remap(r.client_id) } : skip());
  await put("food_recipe_items", list("foodRecipeItems"), ({ id, ...r }) =>
    idMap[r.recipe_id] ? { ...r, recipe_id: idMap[r.recipe_id], ...link(r, "product_id") } : skip());
  await put("food_entries", list("foodEntries"), ({ id, ...r }) =>
    own(r.client_id) ? { ...r, client_id: remap(r.client_id), ...link(r, "product_id"), ...link(r, "recipe_id") } : skip());
  await put("nutrition_goals", list("nutritionGoals"), (g) =>
    own(g.client_id) || g.set_by === "trainer" ? { ...g, client_id: remap(g.client_id) } : skip(), true);
  // У подопечного вода — его данные: тренер переносит только свой комментарий. Отдельной пачкой:
  // в общей пачке недостающие у этих строк столбцы (вода) перезаписались бы значениями по умолчанию.
  const nutritionDays = list("nutritionDays");
  await put("nutrition_days", nutritionDays.filter((d) => own(d.client_id)), (d) => ({ ...d, client_id: remap(d.client_id) }), true);
  await put("nutrition_days", nutritionDays.filter((d) => !own(d.client_id)), (d) =>
    d.trainer_comment ? { client_id: remap(d.client_id), date: d.date, trainer_comment: d.trainer_comment } : skip(), true);
  skippedNutrition += list("nutritionLogs").length;

  // Журнал заработка. Подопечные из копии создаются заново (новые id), поэтому дубли
  // возможны только у карточки «Я», куда данные переносятся повторно: строку, которая уже
  // есть у этого подопечного (та же дата, вид, сумма и время создания), пропускаем.
  // Строки подопечных, которых нет в копии (удалённых), не восстанавливаем — привязать не к кому.
  const charges = list("sessionCharges");
  const chargeKey = (ch: Row) => [remap(ch.client_id), ch.date, ch.kind, Number(ch.amount), new Date(ch.created_at).getTime()].join("|");
  const targetIds = [...new Set(charges.filter((ch) => idMap[ch.client_id]).map((ch) => remap(ch.client_id)))];
  const existingCharges = await fetchAllIn<Row>(targetIds, (chunk, from, to) =>
    supabase.from("session_charges").select("client_id,date,kind,amount,created_at").in("client_id", chunk).order("id").range(from, to));
  // сравниваем только с тем, что было в базе до импорта: одинаковые строки внутри файла — разные списания
  const seenCharges = new Set(existingCharges.map(chargeKey));
  // booking_id/occ_date (ключ занятия) — на запись из копии; записи нет — без ключа, иначе FK и
  // отказ политики (ключ на чужую запись). Старые копии без этих столбцов — как есть.
  await put("session_charges", charges, ({ id, ...r }) => {
    if (!idMap[r.client_id] || seenCharges.has(chargeKey(r))) return null;
    const booking = r.booking_id ? idMap[r.booking_id] ?? null : null;
    return {
      ...r, trainer_id: trainerId, client_id: remap(r.client_id),
      ...("booking_id" in r ? { booking_id: booking, occ_date: booking ? r.occ_date ?? null : null } : {}),
    };
  });

  // Журнал согласий (raw.consents) не восстанавливаем намеренно: это запись о том, что
  // конкретный пользователь принял конкретную редакцию документов в конкретный момент.
  // Вставка из файла создала бы задним числом новые строки от имени текущего пользователя
  // (база это позволяет: insert своих строк разрешён, правка и удаление — нет, так что
  // ошибку потом не исправить). Согласия текущей учётной записи берутся из самого входа.
  return { skippedNutrition };
}

