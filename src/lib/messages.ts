import { supabase } from "./supabase";

export interface ChatMessage { id: string; sender: "trainer" | "client"; text: string; createdAt: string }

export async function fetchMessages(clientId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase.from("messages").select("id,sender,text,created_at").eq("client_id", clientId).order("created_at");
  if (error) throw error;
  return (data ?? []).map((m) => ({ id: m.id, sender: m.sender, text: m.text, createdAt: m.created_at }));
}

export async function sendMessage(trainerId: string, clientId: string, sender: "trainer" | "client", text: string) {
  const { error } = await supabase.from("messages").insert({ trainer_id: trainerId, client_id: clientId, sender, text });
  if (error) throw error;
}
