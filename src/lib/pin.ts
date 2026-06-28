import { supabase } from "./supabase";

// PIN — доп. защита экрана на общем устройстве, не основной auth-фактор (см. комментарий к trainers.pin_hash).
// Хэш — нативный SHA-256 (Web Crypto), без bcrypt-зависимости: достаточно для этой угрозы.
async function hash(pin: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// table: "trainers" для тренера, "clients" для клиента — PIN живёт в pin_hash на соответствующей строке.
export async function fetchPinHash(id: string, table: "trainers" | "clients" = "trainers"): Promise<string> {
  const { data, error } = await supabase.from(table).select("pin_hash").eq("id", id).single();
  if (error) throw error;
  return data.pin_hash ?? "";
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  return (await hash(pin)) === storedHash;
}

export async function setPin(id: string, pin: string, table: "trainers" | "clients" = "trainers") {
  const { error } = await supabase.from(table).update({ pin_hash: await hash(pin) }).eq("id", id);
  if (error) throw error;
}

export async function clearPin(id: string, table: "trainers" | "clients" = "trainers") {
  const { error } = await supabase.from(table).update({ pin_hash: "" }).eq("id", id);
  if (error) throw error;
}
