import { createClient } from "@supabase/supabase-js";

// Тот же проект, что у приложения. Ключ публичный: доступ к данным решают
// правила базы, а метрики отдаются только функциями admin_*, проверяющими админа.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_ANON_KEY as string, {
  auth: { storageKey: "reps-admin-auth" },
});
