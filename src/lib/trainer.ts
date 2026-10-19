import { supabase } from "./supabase";
import { upgradeLime } from "./brand";

export interface TrainerProfileData { name: string; specialization: string; bio: string; phone: string; telegram: string; whatsapp: string; avatarUrl: string; trainingRules: string; accentColor: string }
const EMPTY_PROFILE: TrainerProfileData = { name: "", specialization: "", bio: "", phone: "", telegram: "", whatsapp: "", avatarUrl: "", trainingRules: "", accentColor: "#c6ff3d" };

export interface TrainerSelf { brand: string; logoUrl: string; profile: TrainerProfileData; createdAt: string }

export async function fetchTrainerSelf(trainerId: string): Promise<TrainerSelf> {
  const { data, error } = await supabase.from("trainers").select("brand,logo_url,profile,created_at").eq("id", trainerId).maybeSingle();
  if (error) throw error;
  return {
    brand: data?.brand || "Reps", logoUrl: data?.logo_url || "",
    profile: (() => { const p = { ...EMPTY_PROFILE, ...(data?.profile || {}) }; return { ...p, accentColor: upgradeLime(p.accentColor) }; })(),
    createdAt: data?.created_at || "",
  };
}

export async function saveTrainerProfile(trainerId: string, profile: TrainerProfileData) {
  const { error } = await supabase.from("trainers").update({ profile }).eq("id", trainerId);
  if (error) throw error;
}

export async function saveTrainerBrand(trainerId: string, patch: { brand: string; logoUrl: string }) {
  const { error } = await supabase.from("trainers").update({ brand: patch.brand, logo_url: patch.logoUrl }).eq("id", trainerId);
  if (error) throw error;
}

export interface TrainerStats { activeClients: number; totalClients: number; plansCount: number; sessionsDone: number }

export async function fetchTrainerStats(trainerId: string): Promise<TrainerStats> {
  const [{ data: clients }, { data: plans }, { count: sessionsDone }] = await Promise.all([
    supabase.from("clients").select("id,status,is_self").eq("trainer_id", trainerId).is("deleted_at", null),
    supabase.from("plans").select("client_id").eq("trainer_id", trainerId).is("deleted_at", null),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("trainer_id", trainerId).eq("status", "done"),
  ]);
  // Своя карточка «Я» — не подопечный: ни она, ни её планы в счётчики не входят
  const selfIds = new Set((clients ?? []).filter((c: any) => c.is_self).map((c: any) => c.id));
  const all = (clients ?? []).filter((c: any) => !c.is_self);
  const plansCount = (plans ?? []).filter((p: any) => !selfIds.has(p.client_id)).length;
  return { activeClients: all.filter((c: any) => c.status !== "left").length, totalClients: all.length, plansCount, sessionsDone: sessionsDone ?? 0 };
}
