import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { checkMyPin, hasMyPin, PinLockedError } from "../lib/pin";
import { isNetworkError } from "../lib/outbox";

const unlockKey = (id: string) => `trainerhub-pin-unlocked-${id}`;

// Гейт показывается между успешным входом (Supabase auth) и основным интерфейсом, если у трен./клиента задан PIN.
// Разблокировка живёт в sessionStorage — спрашиваем PIN заново при каждом новом открытии вкладки/браузера.
// onUnlock — PIN не задан или уже введён: App по нему начинает грузить данные тренера.
// hasPin — вызывающий уже знает, задан ли PIN: тогда свой запрос не делаем.
// PIN проверяет сервер (check_my_pin) — хэша на устройстве нет, поэтому без сети PIN не проверить.
export default function PinGate({ id, hasPin: known, onUnlock, children }: { id: string; hasPin?: boolean; onUnlock?: () => void; children: React.ReactNode }) {
  // "offline" — неизвестно, задан ли PIN, и сети нет: открыть без PIN нельзя (кабинет есть в кэше для зала)
  const [fetched, setFetched] = useState<boolean | "loading" | "offline">("loading");
  const [attempt, setAttempt] = useState(0);
  const has = known !== undefined ? known : fetched;
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(unlockKey(id)) === "1");
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
  // Вошли без PIN, а потом его поставили в настройках — этот запуск уже открыт, PIN спросим в следующий
  useEffect(() => { if (has === false && !unlocked) { sessionStorage.setItem(unlockKey(id), "1"); setUnlocked(true); } }, [has, unlocked, id]);

  if (unlocked || has === false) return <>{children}</>;
  // Пока не знаем, задан ли PIN, экран не показываем — иначе он успевает запросить данные до PIN
  if (has === "loading") return <div className="min-h-screen bg-zinc-950" />;
  if (has === "offline") return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4">
      <div role="alert" className="max-w-sm text-center space-y-3">
        <p className="text-lg font-semibold">Нет интернета</p>
        <p className="text-sm text-zinc-500">Чтобы открыть кабинет, нужна сеть. После этого он будет открываться и без неё.</p>
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
        sessionStorage.setItem(unlockKey(id), "1");
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
      </form>
    </div>
  );
}
