import { supabase } from "./supabase";

// Старый учёт питания итогом дня. Новые записи — в дневнике (foodDiary.ts); старые
// показываются там как «Запись за день» и учитываются в отчётах.
export interface NutritionLog { id: string; date: string; calories: number; protein: number; fat: number; carbs: number }

export async function fetchNutritionLogs(clientId: string): Promise<NutritionLog[]> {
  const { data, error } = await supabase.from("nutrition_logs").select("*").eq("client_id", clientId).order("date");
  if (error) throw error;
  return (data ?? []).map((n) => ({ id: n.id, date: n.date, calories: n.calories ?? 0, protein: n.protein ?? 0, fat: n.fat ?? 0, carbs: n.carbs ?? 0 }));
}
