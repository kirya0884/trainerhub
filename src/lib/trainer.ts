import { supabase } from "./supabase";

export interface TrainerProfileData { name: string; specialization: string; bio: string; phone: string; telegram: string; whatsapp: string; avatarUrl: string; trainingRules: string }
const EMPTY_PROFILE: TrainerProfileData = { name: "", specialization: "", bio: "", phone: "", telegram: "", whatsapp: "", avatarUrl: "", trainingRules: "" };

export interface TrainerSelf { brand: string; logoUrl: string; profile: TrainerProfileData; createdAt: string }

export async function fetchTrainerSelf(trainerId: string): Promise<TrainerSelf> {
  const { data, error } = await supabase.from("trainers").select("brand,logo_url,profile,created_at").eq("id", trainerId).maybeSingle();
  if (error) throw error;
  return {
    brand: data?.brand || "TrainerHub", logoUrl: data?.logo_url || "",
    profile: { ...EMPTY_PROFILE, ...(data?.profile || {}) },
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
  const [{ data: clients }, { count: plansCount }, { count: sessionsDone }] = await Promise.all([
    supabase.from("clients").select("id,status").eq("trainer_id", trainerId).is("deleted_at", null),
    supabase.from("plans").select("id", { count: "exact", head: true }).eq("trainer_id", trainerId).is("deleted_at", null),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("trainer_id", trainerId).eq("status", "done"),
  ]);
  const all = clients ?? [];
  return { activeClients: all.filter((c: any) => c.status !== "left").length, totalClients: all.length, plansCount: plansCount ?? 0, sessionsDone: sessionsDone ?? 0 };
}
