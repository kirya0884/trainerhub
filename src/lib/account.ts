import { supabase } from "./supabase";
import { ask, askInput, notify } from "./dialog";
import { humanError } from "./errors";

// Удаление своего аккаунта (функция delete-account на сервере). Подтверждения: предупреждение,
// ввод слова и пароль (п. 59) — сервер проверяет пароль сам, без него чужой человек с открытым
// телефоном аккаунт не сотрёт.
export async function deleteMyAccount(role: "trainer" | "client") {
  const warn = role === "trainer"
    ? "Удалить аккаунт? Будут безвозвратно удалены все твои клиенты, планы, записи, оплаты и входы клиентов в кабинет. Перед этим можно сохранить бэкап в профиле."
    : "Удалить аккаунт? Будут удалены твой вход и дневник питания. Карточку с тренировками и замерами ведёт тренер — попроси его удалить её, если нужно.";
  if (!(await ask(warn, { danger: true, ok: "Продолжить" }))) return;
  const v = await askInput("Чтобы подтвердить, введи слово УДАЛИТЬ", [{ key: "word", label: "Подтверждение", placeholder: "УДАЛИТЬ" }], { ok: "Дальше" });
  if (!v) return;
  if (v.word.trim().toUpperCase() !== "УДАЛИТЬ") { notify("Слово не совпало — аккаунт не удалён."); return; }
  const p = await askInput("Введи пароль от аккаунта", [{ key: "password", label: "Пароль", password: true }], { ok: "Удалить навсегда" });
  if (!p) return;
  if (!p.password) { notify("Пароль не введён — аккаунт не удалён."); return; }
  const { data: { session } } = await supabase.auth.getSession();
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ confirm: "DELETE", password: p.password }),
    });
    const data = await res.json().catch(() => ({}));
    // 400 «Введи пароль», 403 «Неверный пароль», 429 «Слишком много попыток…» — текст сервера как есть.
    // Вошёл по ссылке и пароль так и не задал — подсказываем, где его задать.
    if (res.status === 400 || res.status === 403 || res.status === 429) {
      notify(`${data.error || "Неверный пароль"} — аккаунт не удалён.${res.status === 403 ? " Если пароля нет или ты его не помнишь — задай его через «Забыли пароль?» на экране входа." : ""}`, "error");
      return;
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  } catch (e) {
    console.error("[account] delete:", e);
    notify(humanError(e, "Не удалось удалить аккаунт. Попробуй ещё раз"), "error");
    return;
  }
  try { localStorage.clear(); } catch { /* приватный режим */ }
  // Вход на сервере уже удалён — достаточно стереть сессию на устройстве
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  notify("Аккаунт удалён.");
}
