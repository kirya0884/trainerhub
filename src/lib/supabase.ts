import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — проверь .env");

export const supabase = createClient(url, anonKey);
