import { supabase } from "./supabase";

export async function fetchCustomExercises(trainerId: string): Promise<string[]> {
  const { data, error } = await supabase.from("exercise_library").select("name").eq("trainer_id", trainerId).order("name");
  if (error) throw error;
  return (data ?? []).map((r) => r.name);
}

export async function addCustomExercise(trainerId: string, name: string) {
  const { error } = await supabase.from("exercise_library").insert({ trainer_id: trainerId, name });
  if (error) throw error;
}

// ===================== Медиа упражнений (фото/видео техники) =====================
// Хранится по имени упражнения, без FK на exercise_library — покрывает и встроенные упражнения из статичного датасета.
export async function fetchExerciseMedia(trainerId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("exercise_media").select("name,media_url").eq("trainer_id", trainerId);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.name, r.media_url]));
}

export async function setExerciseMedia(trainerId: string, name: string, mediaUrl: string) {
  if (!mediaUrl) { const { error } = await supabase.from("exercise_media").delete().eq("trainer_id", trainerId).eq("name", name); if (error) throw error; return; }
  const { error } = await supabase.from("exercise_media").upsert({ trainer_id: trainerId, name, media_url: mediaUrl }, { onConflict: "trainer_id,name" });
  if (error) throw error;
}
