import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { checkMyPin, clearMyPin, hasMyPin, PinLockedError } from "../lib/pin";
import { supabase } from "../lib/supabase";
import { notify } from "../lib/dialog";
import { isNetworkError } from "../lib/outbox";
import { peekCache, signOutAndForget } from "../lib/offlineCache";

// Разбор путей 1.15 (решение владельца): после верного PIN этот телефон 4 часа не спрашивает его
// снова — ни после переключения на музыку, ни без сети (PIN проверяет сервер, без сети иначе не войти).
const TRUST_MS = 4 * 60 * 60 * 1000;
const trustKey = (id: string) => `trainerhub-pin-trust-${id}`;
const trusted = (id: string) => { try { return Number(localStorage.getItem(trustKey(id)) || 0) > Date.now(); } catch { return false; } };
const trust = (id: string) => { try { localStorage.setItem(trustKey(id), String(Date.now() + TRUST_MS)); } catch { /* приватный режим — спросим в следующий раз */ } };

// «Забыл PIN»: помечаем и выходим. После нового входа по паролю или ссылке (это сильнее PIN)
// снимаем PIN — иначе человек снова упирался бы в PIN-экран. Снимаем, только если вход свежий:
// одна пометка в хранилище без входа по паролю PIN не снимет.
const resetKey = (id: string) => `trainerhub-pin-reset-${id}`;
const RESET_TTL = 24 * 60 * 60 * 1000;
async function freshSignIn() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  try {
    const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const now = Date.now() / 1000;
    return (claims.amr ?? []).some((a: { method?: string; timestamp?: number }) =>
      ["password", "otp", "recovery", "magiclink", "invite"].includes(a.method ?? "") && now - (a.timestamp ?? 0) < 15 * 60);
  } catch { return false; }
}

// Гейт показывается между успешным входом (Supabase auth) и основным интерфейсом, если у трен./клиента задан PIN.
// Разблокировка — на 4 часа на этом устройстве (см. TRUST_MS), потом PIN спрашивается снова.
// onUnlock — PIN не задан или уже введён: App по нему начинает грузить данные тренера.
// hasPin — вызывающий уже знает, задан ли PIN: тогда свой запрос не делаем.
// PIN проверяет сервер (check_my_pin) — хэша на устройстве нет, поэтому без сети PIN не проверить.
export default function PinGate({ id, hasPin: known, onUnlock, children }: { id: string; hasPin?: boolean; onUnlock?: () => void; children: React.ReactNode }) {
  // "offline" — неизвестно, задан ли PIN, и сети нет: открыть без PIN нельзя (кабинет есть в кэше для зала)
  const [fetched, setFetched] = useState<boolean | "loading" | "offline">("loading");
  const [attempt, setAttempt] = useState(0);
  // PIN сняли в этом запуске («Забыл PIN») — известное снаружи «PIN есть» уже неверно
  const [cleared, setCleared] = useState(false);
  const has = cleared ? false : known !== undefined ? known : fetched;
  const [unlocked, setUnlocked] = useState(() => trusted(id));
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // При ошибке чтения экран и раньше открывался без PIN — так и оставляем, но не при обрыве сети:
  // без сети кабинет открывается из кэша, и авиарежим обходил бы PIN
  const skipFetch = known !== undefined;
  useEffect(() => {
    if (skipFetch) return;
    setFetched("loading");
    hasMyPin().then(setFetched).catch((e) => {
      console.error("[PinGate] чтение PIN:", e);
      setFetched(isNetworkError(e) ? "offline" : false);
    });
  }, [skipFetch, attempt]);
  // Сеть вернулась — повторяем сами
  useEffect(() => {
    if (fetched !== "offline") return;
    const retry = () => setAttempt((n) => n + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [fetched]);
  useEffect(() => { if (unlocked || has === false) onUnlock?.(); }, [unlocked, has]); // eslint-disable-line react-hooks/exhaustive-deps
  // Вернулись после «Забыл PIN» и вошли заново — снимаем PIN
  useEffect(() => {
    let at = 0;
    try { at = Number(localStorage.getItem(resetKey(id)) || 0); } catch { /* нет доступа */ }
    if (!at) return;
    if (Date.now() - at > RESET_TTL) { try { localStorage.removeItem(resetKey(id)); } catch { /* нет доступа */ } return; }
    (async () => {
      if (!(await freshSignIn())) return;
      try {
        await clearMyPin();
        localStorage.removeItem(resetKey(id));
        setCleared(true);
        setUnlocked(true);
        notify("PIN снят. Новый можно задать в меню «PIN-код на вход».", "info");
      } catch (e) { console.error("[PinGate] сброс PIN:", e); }
    })();
  }, [id]);
  // Приложение висит в памяти сутками — 4 часа считаем и при возврате в него, а не только при запуске
  useEffect(() => {
    // Перед замком спрашиваем сервер, есть ли PIN: его могли снять в меню, а снаружи об этом не знают.
    // Без сети — замок, как при запуске (узнать нельзя, а открыть без PIN — обойти его авиарежимом)
    const check = () => {
      if (document.visibilityState !== "visible" || !unlocked || has !== true || trusted(id)) return;
      // Закрываем сразу, чтобы кабинет не мелькнул без PIN; PIN сняли — откроется сам (has станет false)
      setUnlocked(false);
      hasMyPin().then((h) => { if (!h) setCleared(true); })
        .catch((e) => {
          if (!isNetworkError(e)) { console.error("[PinGate] перепроверка PIN:", e); return; }
          // Без сети — по сохранённому: PIN сняли в меню (кэш знает) — не запираем
          if (peekCache<{ hasPin?: boolean }>("access")?.data?.hasPin === false) setCleared(true);
        });
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [id, unlocked, has]);
  // Вошли без PIN, а потом его поставили в настройках — этот запуск уже открыт, PIN спросим в следующий
  useEffect(() => { if (has === false && !unlocked) setUnlocked(true); }, [has, unlocked]);

  if (unlocked || has === false) return <>{children}</>;
  // Пока не знаем, задан ли PIN, экран не показываем — иначе он успевает запросить данные до PIN
  if (has === "loading") return <div className="min-h-screen bg-zinc-950" />;
  if (has === "offline") return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4">
      <div role="alert" className="max-w-sm text-center space-y-3">
        <p className="text-lg font-semibold">Нет интернета</p>
        <p className="text-sm text-zinc-500">Чтобы проверить PIN, нужна сеть. После ввода PIN приложение 4 часа открывается и без неё.</p>
        <button onClick={() => setAttempt((n) => n + 1)} className="bg-lime-400 text-zinc-950 font-semibold rounded-xl px-3 py-2 text-sm hover:bg-lime-300 transition">Повторить</button>
      </div>
    </div>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (await checkMyPin(pin)) {
        trust(id);
        setUnlocked(true);
        return;
      }
      setErr("Неверный PIN");
    } catch (e) {
      if (e instanceof PinLockedError) setErr("Слишком много попыток. Попробуй через 5 минут");
      else if (isNetworkError(e)) setErr("Нет интернета — PIN проверяется на сервере");
      else { console.error("[PinGate] проверка PIN:", e); setErr("Не удалось проверить PIN, попробуй ещё раз"); }
    } finally {
      setBusy(false);
    }
    setPin("");
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-xs space-y-3 text-center">
        <Lock size={28} className="text-lime-400 mx-auto" />
        <p className="text-zinc-400 text-sm">Введи PIN-код</p>
        <input
          autoFocus type="text" inputMode="numeric" value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setErr(""); }}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-center text-2xl tracking-widest outline-none focus:ring-1 focus:ring-lime-400/40"
        />
        {err && <p className="text-orange-400 text-sm">{err}</p>}
        <button type="submit" disabled={busy} className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-xl py-2.5 hover:bg-lime-300 transition disabled:opacity-50">Войти</button>
        {/* Разбор путей 1.14: раньше выхода не было — после попыток «через 5 минут» по кругу */}
        <button type="button" onClick={() => { try { localStorage.setItem(resetKey(id), String(Date.now())); } catch { /* нет доступа */ } signOutAndForget(); }} className="w-full h-11 text-sm text-zinc-400 hover:text-zinc-100 transition">Забыл PIN — выйти и войти по паролю</button>
      </form>
    </div>
  );
}
