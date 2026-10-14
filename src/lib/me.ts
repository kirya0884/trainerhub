import { supabase } from "./supabase";
import { today } from "./format";

// «Я»: тренер ведёт себя как собственного подопечного — свой план, тренировки, питание,
// замеры. Карточка «это я» (is_self) создаётся при первом открытии вкладки, ко входу не
// привязана и в списках, оплатах и статистике не показывается.
export async function ensureSelfClient(trainerId: string, name: string): Promise<string> {
  const find = async () => {
    const { data, error } = await supabase.from("clients").select("id").eq("trainer_id", trainerId).eq("is_self", true).maybeSingle();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  };
  const found = await find();
  if (found) return found;
  const { data, error } = await supabase.from("clients")
    .insert({ trainer_id: trainerId, name: name || "Я", goal: "", color: "#a3e635", joined_at: today(), is_self: true })
    .select("id").single();
  // Две вкладки открыли «Я» одновременно — вторую вставку отбивает уникальный индекс
  if (error) { const again = await find(); if (again) return again; throw error; }
  return data.id as string;
}
