// Edge Function: пользователь удаляет свой аккаунт (152-ФЗ, требования App Store 5.1.1(v) и Google Play).
// Удалить запись в auth.users можно только с service_role — поэтому здесь, на сервере.
//  • Тренер: удаляется вход → каскадом все его данные (trainers → clients, планы, записи, оплаты…);
//    входы его подопечных удаляет триггер clients_drop_login при удалении карточек.
//  • Подопечный: удаляется дневник питания, который он вёл сам, и вход. Карточка в учёте
//    тренера остаётся — её удаляет тренер (он оператор этих данных).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    if (!jwt) return json({ error: "Не авторизован" }, 401);
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: "Не авторизован" }, 401);
    const uid = userData.user.id;

    // Защита от случайного вызова: приложение присылает явное подтверждение
    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "DELETE") return json({ error: "Нет подтверждения" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: trainer } = await admin.from("trainers").select("id").eq("id", uid).maybeSingle();

    if (trainer) {
      // Карточки удаляем явно (а не только каскадом от auth.users), чтобы сработал триггер,
      // убирающий входы подопечных в кабинет
      const { error: cErr } = await admin.from("clients").delete().eq("trainer_id", uid);
      if (cErr) return json({ error: cErr.message }, 500);
    } else {
      const { data: cards } = await admin.from("clients").select("id").eq("auth_user_id", uid);
      const ids = (cards ?? []).map((c) => c.id);
      if (ids.length) {
        for (const t of ["food_entries", "food_recipes", "food_products", "nutrition_days"]) {
          const { error } = await admin.from(t).delete().in("client_id", ids);
          if (error) return json({ error: `${t}: ${error.message}` }, 500);
        }
      }
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return json({ error: delErr.message }, 500);
    return json({ ok: true, role: trainer ? "trainer" : "client" });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
