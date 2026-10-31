// Edge Function: пользователь удаляет свой аккаунт (152-ФЗ, требования App Store 5.1.1(v) и Google Play).
// Удалить запись в auth.users можно только с service_role — поэтому здесь, на сервере.
// Вход: POST { confirm: "DELETE", password } с JWT. Пароль проверяем входом anon-клиентом:
// украденного токена (открытая вкладка, чужое устройство) мало, чтобы стереть аккаунт.
//  • Тренер: удаляется вход → каскадом все его данные (trainers → clients, планы, записи, оплаты…);
//    входы его подопечных удаляет триггер clients_drop_login при удалении карточек
//    (вход, у которого есть карточка у другого тренера, триггер оставляет).
//  • Подопечный: по ВСЕМ его карточкам (у каждого тренера) удаляется то, что он вёл сам:
//    дневник питания, свои цели питания (set_by='client'), активности, свои события
//    аналитики (actor='client') и свои сообщения (sender='client'); затем вход.
//    Карточка в учёте тренера остаётся — её удаляет тренер (он оператор этих данных).
//  • Журнал согласий не удаляется: user_id обнуляется (on delete set null), остаётся снимок почты.
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
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password) return json({ error: "Введи пароль" }, 400);
    const email = userData.user.email;
    if (!email) return json({ error: "У аккаунта нет почты — удаление через поддержку" }, 400);

    // Проверка пароля — отдельный клиент без сохранения сессии; при успехе созданная сессия
    // уйдёт вместе со входом ниже
    const checker = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signIn, error: pwErr } = await checker.auth.signInWithPassword({ email, password });
    if (pwErr || signIn.user?.id !== uid) {
      if (pwErr?.status === 429) return json({ error: "Слишком много попыток. Подожди пару минут" }, 429);
      return json({ error: "Неверный пароль" }, 403);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: trainer } = await admin.from("trainers").select("id").eq("id", uid).maybeSingle();

    if (trainer) {
      // Карточки удаляем явно (а не только каскадом от auth.users), чтобы сработал триггер,
      // убирающий входы подопечных в кабинет
      const { error: cErr } = await admin.from("clients").delete().eq("trainer_id", uid);
      if (cErr) return json({ error: cErr.message }, 500);
    } else {
      const { data: cards, error: cardsErr } = await admin.from("clients").select("id").eq("auth_user_id", uid);
      if (cardsErr) return json({ error: cardsErr.message }, 500);
      const ids = (cards ?? []).map((c) => c.id);
      if (ids.length) {
        const steps: [string, (q: any) => any][] = [
          ["food_entries", (q) => q],
          ["food_recipes", (q) => q],
          ["food_products", (q) => q],
          ["nutrition_days", (q) => q],
          ["nutrition_goals", (q) => q.eq("set_by", "client")],
          ["client_activities", (q) => q],
          ["app_events", (q) => q.eq("actor", "client")],
          ["messages", (q) => q.eq("sender", "client")],
        ];
        for (const [t, filter] of steps) {
          const { error } = await filter(admin.from(t).delete().in("client_id", ids));
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
