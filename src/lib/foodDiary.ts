import { supabase } from "./supabase";

// Дневник питания. Продукт хранит КБЖУ на 100 г; запись дневника — уже посчитанные
// значения съеденного (снимок), поэтому правка продукта прошлые дни не меняет.

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export const MEALS: { key: Meal; label: string }[] = [
  { key: "breakfast", label: "Завтрак" },
  { key: "lunch", label: "Обед" },
  { key: "dinner", label: "Ужин" },
  { key: "snack", label: "Перекус" },
];

export interface Macros { kcal: number; protein: number; fat: number; carbs: number }
export interface FoodProduct extends Macros { id: string; name: string; favorite: boolean; lastGrams: number | null; lastUsedAt: string | null }
export interface FoodEntry extends Macros { id: string; date: string; meal: Meal; productId: string | null; recipeId: string | null; name: string; grams: number }
export interface NutritionGoal extends Macros { waterCups: number | null; updatedAt: string }
export type Goals = { trainer: NutritionGoal | null; client: NutritionGoal | null };

export const ZERO: Macros = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
/** Ккал по БЖУ: белки и углеводы по 4, жиры по 9 */
export const kcalOf = (m: Omit<Macros, "kcal">) => m.protein * 4 + m.fat * 9 + m.carbs * 4;
/** КБЖУ съеденного по значениям на 100 г */
export const scale = (per100: Macros, grams: number): Macros => ({
  kcal: (per100.kcal * grams) / 100, protein: (per100.protein * grams) / 100,
  fat: (per100.fat * grams) / 100, carbs: (per100.carbs * grams) / 100,
});
export const sum = (list: Macros[]): Macros => list.reduce((a, m) => ({
  kcal: a.kcal + m.kcal, protein: a.protein + m.protein, fat: a.fat + m.fat, carbs: a.carbs + m.carbs,
}), ZERO);
/** Действующая цель: тренерская главнее своей */
export const activeGoal = (g: Goals) => g.trainer ?? g.client;
/** 12,5 → «12,5»; 113,04 → «113»; ккал — целые */
export const fmtN = (n: number, digits = 1) => {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return r.toLocaleString("ru-RU", { maximumFractionDigits: Math.abs(r) >= 100 ? 0 : digits });
};
/** «12,5» и «12.5» из поля ввода; пусто и мусор — 0 */
export const num = (s: string) => { const v = Number(String(s).replace(",", ".").trim()); return Number.isFinite(v) && v > 0 ? v : 0; };

const r2 = (n: number) => Math.round(n * 100) / 100;
const macrosRow = (m: Macros) => ({ kcal: r2(m.kcal), protein: r2(m.protein), fat: r2(m.fat), carbs: r2(m.carbs) });
const toMacros = (r: any): Macros => ({ kcal: Number(r.kcal) || 0, protein: Number(r.protein) || 0, fat: Number(r.fat) || 0, carbs: Number(r.carbs) || 0 });

// ── Записи дневника ──
const toEntry = (r: any): FoodEntry => ({
  id: r.id, date: r.date, meal: r.meal, productId: r.product_id, recipeId: r.recipe_id,
  name: r.name, grams: Number(r.grams) || 0, ...toMacros(r),
});

export async function fetchEntries(clientId: string, from: string, to: string): Promise<FoodEntry[]> {
  const { data, error } = await supabase.from("food_entries").select("*")
    .eq("client_id", clientId).gte("date", from).lte("date", to).order("created_at");
  if (error) throw error;
  return (data ?? []).map(toEntry);
}

export async function addEntry(clientId: string, e: Omit<FoodEntry, "id">): Promise<FoodEntry> {
  const { data, error } = await supabase.from("food_entries").insert({
    client_id: clientId, date: e.date, meal: e.meal, product_id: e.productId, recipe_id: e.recipeId,
    name: e.name, grams: r2(e.grams), ...macrosRow(e),
  }).select().single();
  if (error) throw error;
  return toEntry(data);
}

/** Новые граммы: КБЖУ пересчитываются пропорционально прежней записи */
export async function updateEntryGrams(e: FoodEntry, grams: number): Promise<FoodEntry> {
  const k = e.grams > 0 ? grams / e.grams : 0;
  const next = { ...e, grams, kcal: e.kcal * k, protein: e.protein * k, fat: e.fat * k, carbs: e.carbs * k };
  const { error } = await supabase.from("food_entries").update({ grams: r2(grams), ...macrosRow(next) }).eq("id", e.id);
  if (error) throw error;
  return next;
}

export async function deleteEntry(id: string) {
  const { error } = await supabase.from("food_entries").delete().eq("id", id);
  if (error) throw error;
}

// ── Мои продукты ──
const toProduct = (r: any): FoodProduct => ({
  id: r.id, name: r.name, favorite: !!r.favorite, lastGrams: r.last_grams == null ? null : Number(r.last_grams),
  lastUsedAt: r.last_used_at, ...toMacros(r),
});

export async function fetchProducts(clientId: string): Promise<FoodProduct[]> {
  const { data, error } = await supabase.from("food_products").select("*").eq("client_id", clientId)
    .order("last_used_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(toProduct);
}

export async function addProduct(clientId: string, p: { name: string } & Macros): Promise<FoodProduct> {
  const { data, error } = await supabase.from("food_products").insert({ client_id: clientId, name: p.name, ...macrosRow(p) }).select().single();
  if (error) throw error;
  return toProduct(data);
}

/** Отметка «ели только что»: продукт поднимается в недавних, запоминаются граммы для «как вчера» */
export async function touchProduct(id: string, grams: number) {
  const { error } = await supabase.from("food_products").update({ last_grams: r2(grams), last_used_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ── Цели ──
const toGoal = (r: any): NutritionGoal => ({ ...toMacros(r), waterCups: r.water_cups, updatedAt: r.updated_at });

export async function fetchGoals(clientId: string): Promise<Goals> {
  const { data, error } = await supabase.from("nutrition_goals").select("*").eq("client_id", clientId);
  if (error) throw error;
  const by = (who: string) => { const r = (data ?? []).find((x) => x.set_by === who); return r ? toGoal(r) : null; };
  return { trainer: by("trainer"), client: by("client") };
}

export async function saveGoal(clientId: string, setBy: "client" | "trainer", g: Macros & { waterCups?: number | null }) {
  const { error } = await supabase.from("nutrition_goals").upsert({
    client_id: clientId, set_by: setBy, ...macrosRow(g), water_cups: g.waterCups ?? null, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
