// Edge Function: тренер выдаёт клиенту доступ в портал — генерируем пароль через admin API
// (service_role доступен только здесь, на сервере, никогда во фронтенде) и отправляем логин/пароль
// клиенту на почту через Resend. Вызывается из приложения через supabase.functions.invoke("register-client").
// Режимы: по умолчанию — первая выдача; { resend: true } — новый пароль и повторное письмо
// (только своему клиенту, который ещё ни разу не входил).
// Если письмо не ушло, пароль возвращается тренеру в ответе один раз (поле password), иначе клиент
// его никогда не узнает: пароль нигде не хранится. Тренер и так владеет данными клиента, так что
// доступ к его кабинету не даёт ему ничего нового.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Reps <onboarding@resend.dev>";
const APP_URL = Deno.env.get("APP_URL") || "https://trainerhub-uyf5.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);

function genPassword(len = 10) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// Ответ Resend при ошибке — JSON { statusCode, message, name }; тренеру показываем только понятную причину.
async function resendError(res: Response): Promise<string> {
  let message = "";
  try { message = (await res.json())?.message || ""; } catch { /* не JSON */ }
  if (res.status === 403 && /testing emails|verify a domain/i.test(message))
    return "в Resend не подтверждён домен отправителя — с тестового адреса письма уходят только владельцу аккаунта Resend";
  return message || `Resend ответил ${res.status}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    if (!jwt) return json({ error: "Не авторизован" }, 401);

    // Кто вызывает — проверяем через anon-клиент с токеном вызывающего, без service_role.
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: "Не авторизован" }, 401);
    const trainerId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: trainerRow } = await admin.from("trainers").select("id, brand").eq("id", trainerId).maybeSingle();
    if (!trainerRow) return json({ error: "Доступно только тренеру" }, 403);

    const { clientId, resend } = await req.json();
    if (!clientId) return json({ error: "clientId обязателен" }, 400);

    const { data: client, error: clientErr } = await admin
      .from("clients").select("id, name, email, trainer_id, auth_user_id").eq("id", clientId).single();
    if (clientErr || !client) return json({ error: "Клиент не найден" }, 404);
    if (client.trainer_id !== trainerId) return json({ error: "Это не ваш клиент" }, 403);
    const email = String(client.email || "").trim().toLowerCase();
    if (!email) return json({ error: "У клиента не указан email" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json({ error: `Неверный адрес почты: ${email}` }, 400);

    const password = genPassword();
    if (resend) {
      if (!client.auth_user_id) return json({ error: "Доступ ещё не выдан — нажмите «Отправить доступ клиенту»" }, 400);
      const { data: au, error: auErr } = await admin.auth.admin.getUserById(client.auth_user_id);
      if (auErr || !au.user) return json({ error: "Аккаунт клиента не найден" }, 404);
      if (au.user.last_sign_in_at)
        return json({ error: "Клиент уже входил в кабинет. Если он забыл пароль — пусть нажмёт «Забыли пароль?» на экране входа." }, 400);
      // Почту тоже обновляем: тренер мог исправить опечатку в адресе после первой выдачи.
      const { error: updErr } = await admin.auth.admin.updateUserById(client.auth_user_id, { password, email, email_confirm: true });
      if (updErr) return json({ error: updErr.message }, 400);
    } else {
      if (client.auth_user_id) return json({ error: "Доступ уже выдан этому клиенту" }, 400);
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { role: "client" },
      });
      if (createErr || !created.user) return json({ error: createErr?.message || "Не удалось создать аккаунт" }, 400);

      const { error: linkErr } = await admin.from("clients").update({ auth_user_id: created.user.id }).eq("id", clientId);
      if (linkErr) return json({ error: linkErr.message }, 400);
    }

    // Письмо не ушло — отдаём пароль тренеру один раз, чтобы он передал его клиенту сам.
    const failed = (reason: string) => json({ ok: true, emailFailed: true, warning: reason, email, password });

    if (!RESEND_API_KEY) return failed("на сервере не настроена отправка писем (RESEND_API_KEY)");

    const brand = trainerRow.brand || "Reps";
    const html = `
      <p>Здравствуйте, ${escapeHtml(client.name)}!</p>
      <p>Ваш тренер (${escapeHtml(brand)}) создал для вас доступ в личный кабинет Reps.</p>
      <p><b>Логин:</b> ${escapeHtml(email)}<br/><b>Пароль:</b> ${escapeHtml(password)}</p>
      <p><a href="${escapeHtml(APP_URL)}">Открыть кабинет</a></p>
      <p>На экране входа выберите «Я клиент». После первого входа рекомендуем поставить PIN-код в настройках профиля.</p>`;
    const text = [
      `Здравствуйте, ${client.name}!`,
      ``,
      `Ваш тренер (${brand}) создал для вас доступ в личный кабинет Reps.`,
      ``,
      `Логин: ${email}`,
      `Пароль: ${password}`,
      ``,
      `Открыть кабинет: ${APP_URL}`,
      `На экране входа выберите «Я клиент». После первого входа рекомендуем поставить PIN-код в настройках профиля.`,
    ].join("\n");
    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: RESEND_FROM, to: email, subject: "Доступ в личный кабинет Reps", html, text }),
    });
    if (!sendRes.ok) return failed(await resendError(sendRes));

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
