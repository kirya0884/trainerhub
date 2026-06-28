import { supabase } from "./supabase";

export interface NutritionLog { id: string; date: string; calories: number; protein: number; fat: number; carbs: number }

export async function fetchNutritionLogs(clientId: string): Promise<NutritionLog[]> {
  const { data, error } = await supabase.from("nutrition_logs").select("*").eq("client_id", clientId).order("date");
  if (error) throw error;
  return (data ?? []).map((n) => ({ id: n.id, date: n.date, calories: n.calories ?? 0, protein: n.protein ?? 0, fat: n.fat ?? 0, carbs: n.carbs ?? 0 }));
}

export async function addNutritionLog(clientId: string, n: Omit<NutritionLog, "id">) {
  const { error } = await supabase.from("nutrition_logs").insert({
    client_id: clientId, date: n.date, calories: n.calories, protein: n.protein, fat: n.fat, carbs: n.carbs,
  });
  if (error) throw error;
}

export async function deleteNutritionLog(id: string) {
  const { error } = await supabase.from("nutrition_logs").delete().eq("id", id);
  if (error) throw error;
}
