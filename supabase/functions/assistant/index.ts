// Edge Function: помощник тренера. Этап 1 — команды «создай тренировку клиенту».
// Вход: POST { mode: "command", text, tz?, previous?: { text, result } } с JWT тренера.
// Выход: { ok, result: Command, usage: { used, limit } } — разобранная команда для карточки
// подтверждения. Функция НИЧЕГО не создаёт в планах: запись делает приложение после того,
// как тренер нажмёт «Создать», обычными запросами под его правами (RLS).
//
// Что уходит в Яндекс: текст команды и названия упражнений тренера. Список клиентов не уходит —
// имя из команды сравнивается с клиентами здесь (logic.ts → matchClient).
// Сам текст команды в журнал не пишем, только размеры и счётчик токенов.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildCommand, commandPrompt, COMMAND_SCHEMA, MAX_COMMAND_CHARS, parseModelJson, todayIn, topNames,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const YANDEX_API_KEY = Deno.env.get("YANDEX_API_KEY") ?? "";
const YANDEX_FOLDER_ID = Deno.env.get("YANDEX_FOLDER_ID") ?? "";
const YANDEX_GPT_MODEL = Deno.env.get("YANDEX_GPT_MODEL") || "yandexgpt/latest";
const DAILY_LIMIT = Number(Deno.env.get("ASSISTANT_DAILY_LIMIT")) || 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Msg = { role: "system" | "user" | "assistant"; text: string };

async function askYandex(messages: Msg[]): Promise<{ text: string; tokens: number }> {
  const res = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
    method: "POST",
    headers: {
      "Authorization": `Api-Key ${YANDEX_API_KEY}`,
      "x-folder-id": YANDEX_FOLDER_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      modelUri: `gpt://${YANDEX_FOLDER_ID}/${YANDEX_GPT_MODEL}`,
      completionOptions: { stream: false, temperature: 0.1, maxTokens: "2000" },
      messages,
      jsonSchema: { schema: COMMAND_SCHEMA },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Яндекс ответил ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.result?.alternatives?.[0]?.message?.text;
  if (typeof text !== "string") throw new Error("Яндекс вернул пустой ответ");
  return { text, tokens: Number(data?.result?.usage?.totalTokens) || 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Только POST" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    if (!jwt) return json({ error: "Не авторизован" }, 401);
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: "Не авторизован" }, 401);
    const uid = userData.user.id;

    // Чтение — под правами тренера: видны только его клиенты и планы
    const db = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: trainer } = await db.from("trainers").select("id").eq("id", uid).maybeSingle();
    if (!trainer) return json({ error: "Помощник доступен только тренеру" }, 403);
    // Ключ проверяем после входа: посторонним не сообщаем, подключён ли помощник
    if (!YANDEX_API_KEY || !YANDEX_FOLDER_ID) return json({ error: "Помощник ещё не подключён" }, 503);

    const body = await req.json().catch(() => ({}));
    if (body?.mode !== "command") return json({ error: "Неизвестный режим" }, 400);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return json({ error: "Пустая команда" }, 400);
    if (text.length > MAX_COMMAND_CHARS) return json({ error: "Слишком длинная команда" }, 400);
    const prev = body?.previous;
    const prevText = typeof prev?.text === "string" ? prev.text.slice(0, MAX_COMMAND_CHARS) : "";
    const prevResult = prev?.result && typeof prev.result === "object" ? JSON.stringify(prev.result).slice(0, 8000) : "";

    const today = todayIn(typeof body?.tz === "string" ? body.tz : "Europe/Moscow");

    const [clientsRes, exRes, libRes] = await Promise.all([
      db.from("clients").select("id,name").eq("trainer_id", uid).eq("is_self", false).is("deleted_at", null),
      db.from("plan_exercises").select("name, plan_days!inner(plans!inner(trainer_id))")
        .eq("plan_days.plans.trainer_id", uid).limit(5000),
      db.from("exercise_library").select("name").eq("trainer_id", uid).limit(2000),
    ]);
    if (clientsRes.error) throw clientsRes.error;
    const clients = (clientsRes.data ?? []) as { id: string; name: string }[];
    const known = topNames([...(exRes.data ?? []), ...(libRes.data ?? [])].map((r: any) => r.name));

    // Лимит считаем по московскому дню, чтобы смена пояса в телефоне его не обнуляла
    const usageDay = todayIn("Europe/Moscow");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: used, error: takeErr } = await admin.rpc("assistant_take", { p_trainer: uid, p_day: usageDay, p_limit: DAILY_LIMIT });
    if (takeErr) throw takeErr;
    if (used == null) return json({ error: "limit", usage: { used: DAILY_LIMIT, limit: DAILY_LIMIT } }, 429);
    const refund = () => admin.rpc("assistant_refund", { p_trainer: uid, p_day: usageDay });

    const messages: Msg[] = [{ role: "system", text: commandPrompt(today, known) }];
    if (prevText && prevResult) {
      messages.push({ role: "user", text: prevText }, { role: "assistant", text: prevResult }, { role: "user", text: `Поправка к команде: ${text}` });
    } else {
      messages.push({ role: "user", text });
    }

    let answer;
    try {
      answer = await askYandex(messages);
    } catch (e) {
      await refund();
      console.error("[assistant] yandex:", String((e as any)?.message || e));
      return json({ error: "Помощник сейчас недоступен, попробуй через минуту" }, 502);
    }
    const raw = parseModelJson(answer.text);
    if (!raw) {
      await refund();
      console.error("[assistant] не JSON, длина", answer.text.length);
      return json({ error: "Не получилось разобрать ответ, попробуй сказать иначе" }, 502);
    }
    const result = buildCommand(raw, today, clients, known);
    // Не команда («спасибо», шум) — разбор не засчитываем
    const usedNow = result.action === "unknown" ? (await refund(), used - 1) : used;
    console.log(`[assistant] command chars=${text.length} tokens=${answer.tokens} action=${result.action} ex=${result.exercises.length} client=${result.client.status}`);
    return json({ ok: true, result, usage: { used: usedNow, limit: DAILY_LIMIT } });
  } catch (e) {
    console.error("[assistant]", String((e as any)?.message || e));
    return json({ error: "Ошибка помощника" }, 500);
  }
});
