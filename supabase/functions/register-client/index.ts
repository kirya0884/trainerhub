// Edge Function: тренер выдаёт клиенту доступ в кабинет — одноразовой ссылкой, без пароля.
// service_role доступен только здесь, на сервере, никогда во фронтенде.
// Вызывается из приложения: POST { clientId, redirectTo, resend? } с JWT тренера.
//
// Ответ 200: { ok: true, status: "invited" | "linked" | "already", link?, emailSent? }
//  • invited — входа с этой почтой не было: создан вход без пароля, карточка привязана;
//  • linked  — найден вход-сирота, созданный этим же тренером (прошлый вызов упал после createUser),
//              карточка привязана к нему;
//  • already — карточка уже была привязана.
// link — только если вход ещё ни разу не входил и не привязан к другим тренерам. Тому, кто уже
// входил, ссылку тренеру не выдаём (иначе он сбросил бы клиенту пароль) — клиент входит своим
// паролем или через «Забыли пароль?».
//
// «Один вход — несколько тренеров» отложено: чужой вход (клиент другого тренера, тренер, любой
// вход, созданный не этим тренером) не привязываем — всегда один и тот же 409, чтобы не раскрывать,
// кто это. Вход, созданный здесь, помечен app_metadata.invited_by = id тренера (app_metadata
// меняет только сервер).
//
// Ссылка ведёт в приложение (`${redirectTo}/#/invite?token_hash=…&type=recovery`), а не на
// /auth/v1/verify: ту гасят превью мессенджеров и почтовые сканеры, открывая её раньше клиента.
// Приложение само вызывает verifyOtp({ token_hash, type: "recovery" }) и показывает «новый пароль».
// Если настроен Resend — та же ссылка уходит письмом; письмо не ушло — не ошибка.
// Пароль функция не ставит никогда. Почту входа меняет только при исправлении опечатки:
// resend, вход создан этим тренером, ни разу не входил, других карточек нет.
// Идемпотентна: повтор после сбоя на любом шаге находит вход по почте и доводит дело до конца.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "Reps <onboarding@resend.dev>";

// Куда ведёт ссылка: только свои origin (иначе ссылку входа можно было бы увести на чужой сайт).
// Адреса для разработки (localhost) — через секрет APP_ORIGINS, через запятую.
const ALLOWED_ORIGINS = [
  "https://trainerhub-uyf5.vercel.app",
  ...(Deno.env.get("APP_ORIGINS") ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
];
const pickOrigin = (raw: string) => {
  const s = raw.trim().replace(/\/+$/, "");
  return ALLOWED_ORIGINS.includes(s) ? s : ALLOWED_ORIGINS[0];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);

// Один текст на любой чужой вход — не раскрываем, тренер это или клиент другого тренера
const EMAIL_TAKEN = "С этой почтой выдать доступ нельзя — она уже используется в Reps. Попроси клиента другую почту";
const EMAIL_MISMATCH = "Почта в карточке не совпадает с почтой входа клиента. Верни прежнюю почту";
const NO_ACCOUNT = "Аккаунт клиента не найден";

// Ответ Resend при ошибке — JSON { statusCode, message, name }; причину пишем в лог функции.
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
    // Старая PWA не шлёт redirectTo и ждёт пароль в ответе — отказываем до любых действий
    const body = await req.json().catch(() => ({}));
    if (typeof body?.redirectTo !== "string" || !body.redirectTo.trim())
      return json({ error: "Обнови приложение: потяни экран вниз или перезапусти его" }, 426);
    const redirectTo = pickOrigin(body.redirectTo);
    const clientId = body?.clientId;
    const resend = body?.resend === true;

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
    if (!clientId) return json({ error: "clientId обязателен" }, 400);

    const { data: client, error: clientErr } = await admin
      .from("clients").select("id, name, email, trainer_id, auth_user_id").eq("id", clientId).maybeSingle();
    if (clientErr || !client) return json({ error: "Клиент не найден" }, 404);
    if (client.trainer_id !== trainerId) return json({ error: "Это не твой клиент" }, 403);
    const email = String(client.email || "").trim().toLowerCase();
    if (!email) return json({ error: "У клиента не указана почта" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json({ error: `Неверный адрес почты: ${email}` }, 400);

    const findUserId = async (): Promise<string | null> => {
      const { data, error } = await admin.rpc("auth_user_id_by_email", { p_email: email });
      if (error) throw new Error(error.message);
      return (data as string | null) ?? null;
    };
    const getUser = async (id: string) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      return error ? null : data.user;
    };
    // Есть ли у входа карточки у других тренеров
    const hasOtherCards = async (id: string): Promise<boolean> => {
      const { count, error } = await admin.from("clients")
        .select("id", { count: "exact", head: true })
        .eq("auth_user_id", id).neq("trainer_id", trainerId);
      if (error) throw new Error(error.message);
      return !!count;
    };
    // Вход создан этим тренером и ни к кому больше не привязан
    const isOwnOrphan = async (u: { id: string; app_metadata?: Record<string, unknown> }) =>
      u.app_metadata?.invited_by === trainerId && !(await hasOtherCards(u.id));

    let userId: string;
    let status: "invited" | "linked" | "already";

    if (client.auth_user_id) {
      // Карточка уже привязана
      userId = client.auth_user_id;
      status = "already";
      const u = await getUser(userId);
      if (!u) return json({ error: NO_ACCOUNT }, 404);
      if (String(u.email || "").toLowerCase() === email) {
        if (!resend || u.last_sign_in_at) return json({ ok: true, status });
      } else {
        // Опечатка в почте: исправить можно только у своего, ни разу не входившего входа
        if (!resend || u.last_sign_in_at || !(await isOwnOrphan(u))) return json({ error: EMAIL_MISMATCH }, 409);
        const taken = await findUserId();
        if (taken && taken !== userId) return json({ error: EMAIL_TAKEN }, 409);
        const { error: updErr } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
        if (updErr) { console.warn("[register-client] updateUserById:", updErr.message); return json({ error: EMAIL_TAKEN }, 409); }
      }
    } else {
      // Вход с этой почтой: нет — создаём без пароля; есть — привязываем только своего сироту
      let found = await findUserId();
      status = "linked";
      if (!found) {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email, email_confirm: true,
          app_metadata: { invited_by: trainerId },
          user_metadata: { role: "client" },
        });
        if (created?.user) {
          found = created.user.id;
          status = "invited";
        } else {
          // Параллельный вызов успел создать вход — найдём его и проверим как сироту ниже
          found = await findUserId();
          if (!found) { console.warn("[register-client] createUser:", createErr?.message); return json({ error: "Не удалось создать доступ. Попробуй ещё раз" }, 400); }
        }
      }
      userId = found;
      if (status === "linked") {
        const u = await getUser(userId);
        if (!u || !(await isOwnOrphan(u))) return json({ error: EMAIL_TAKEN }, 409);
      }

      // Привязка. Триггер clients_guard_login_fields пропускает service_role.
      const { data: linked, error: linkErr } = await admin.from("clients")
        .update({ auth_user_id: userId })
        .eq("id", clientId).eq("trainer_id", trainerId).is("auth_user_id", null)
        .select("id");
      if (linkErr) {
        // clients_trainer_auth_user_key: у этого тренера другая карточка уже на этом входе
        if (linkErr.code === "23505")
          return json({ error: "У тебя уже есть другая карточка с доступом для этой почты" }, 409);
        return json({ error: linkErr.message }, 400);
      }
      // Строку успели привязать параллельно — к тому же входу считаем успехом, к другому — нет
      if (!linked?.length) {
        const { data: cur } = await admin.from("clients").select("auth_user_id").eq("id", clientId).maybeSingle();
        if (cur?.auth_user_id !== userId) return json({ error: "Карточку уже привязали к другому входу. Обнови экран" }, 409);
      }
    }

    // Ссылка — только если вход ни разу не входил и не привязан к другим тренерам
    const u = await getUser(userId);
    if (!u) return json({ error: NO_ACCOUNT }, 404);
    if (u.last_sign_in_at || (await hasOtherCards(userId))) return json({ ok: true, status });
    // Ссылка задаёт пароль входу — никогда для входа тренера или админа (старые привязки без invited_by)
    const [{ count: asTrainer }, { count: asAdmin }] = await Promise.all([
      admin.from("trainers").select("id", { count: "exact", head: true }).eq("id", userId),
      admin.from("admins").select("user_id", { count: "exact", head: true }).eq("user_id", userId),
    ]);
    if (asTrainer || asAdmin) return json({ error: EMAIL_TAKEN }, 409);

    const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
      type: "recovery", email, options: { redirectTo },
    });
    const hashed = gen?.properties?.hashed_token;
    if (genErr || !hashed) { console.warn("[register-client] generateLink:", genErr?.message); return json({ error: "Не удалось создать ссылку. Попробуй ещё раз" }, 400); }
    const link = `${redirectTo}/#/invite?token_hash=${encodeURIComponent(hashed)}&type=recovery`;

    let emailSent = false;
    if (RESEND_API_KEY) {
      const brand = trainerRow.brand || "Reps";
      const html = `
        <p>Здравствуйте, ${escapeHtml(client.name)}!</p>
        <p>Ваш тренер (${escapeHtml(brand)}) открыл вам доступ в личный кабинет Reps.</p>
        <p><a href="${escapeHtml(link)}">Открыть кабинет и задать пароль</a></p>
        <p>Ссылка одноразовая. Логин для следующих входов — ${escapeHtml(email)}, на экране входа выберите «Я клиент».</p>`;
      const text = [
        `Здравствуйте, ${client.name}!`,
        ``,
        `Ваш тренер (${brand}) открыл вам доступ в личный кабинет Reps.`,
        ``,
        `Открыть кабинет и задать пароль: ${link}`,
        ``,
        `Ссылка одноразовая. Логин для следующих входов — ${email}, на экране входа выберите «Я клиент».`,
      ].join("\n");
      try {
        const sendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: RESEND_FROM, to: email, subject: "Доступ в личный кабинет Reps", html, text }),
        });
        emailSent = sendRes.ok;
        if (!sendRes.ok) console.warn("[register-client] письмо не ушло:", await resendError(sendRes));
      } catch (e) {
        console.warn("[register-client] письмо не ушло:", String((e as any)?.message || e));
      }
    }

    return json({ ok: true, status, link, emailSent });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
