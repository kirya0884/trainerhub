import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { fetchPinHash, verifyPin } from "../lib/pin";
import { isNetworkError } from "../lib/outbox";

const unlockKey = (id: string) => `trainerhub-pin-unlocked-${id}`;

// Гейт показывается между успешным входом (Supabase auth) и основным интерфейсом, если у трен./клиента задан PIN.
// Разблокировка живёт в sessionStorage — спрашиваем PIN заново при каждом новом открытии вкладки/браузера.
// onUnlock — PIN не задан или уже введён: App по нему начинает грузить данные тренера.
// known — хэш уже прочитан вызывающим (null — PIN не задан): тогда свой запрос не делаем.
export default function PinGate({ id, table = "trainers", hash: known, onUnlock, children }: { id: string; table?: "trainers" | "clients"; hash?: string | null; onUnlock?: () => void; children: React.ReactNode }) {
  // "offline" — PIN неизвестен и сети нет: открыть без PIN нельзя (кабинет есть в кэше для зала)
  const [fetched, setHash] = useState<string | null | "loading" | "offline">("loading");
  const [attempt, setAttempt] = useState(0);
  const hash = known !== undefined ? known : fetched;
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(unlockKey(id)) === "1");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  // При ошибке чтения экран и раньше открывался без PIN — так и оставляем, но не при обрыве сети:
  // без сети кабинет открывается из кэша, и авиарежим обходил бы PIN
  const skipFetch = known !== undefined;
  useEffect(() => {
    if (skipFetch) return;
    setHash("loading");
    fetchPinHash(id, table).then((h) => setHash(h || null)).catch((e) => {
      console.error("[PinGate] чтение PIN:", e);
      setHash(isNetworkError(e) ? "offline" : null);
    });
  }, [id, table, skipFetch, attempt]);
  // Сеть вернулась — повторяем сами
  useEffect(() => {
    if (fetched !== "offline") return;
    const retry = () => setAttempt((n) => n + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [fetched]);
  useEffect(() => { if (unlocked || hash === null) onUnlock?.(); }, [unlocked, hash]); // eslint-disable-line react-hooks/exhaustive-deps
  // Вошли без PIN, а потом его поставили в настройках — этот запуск уже открыт, PIN спросим в следующий
  useEffect(() => { if (hash === null && !unlocked) { sessionStorage.setItem(unlockKey(id), "1"); setUnlocked(true); } }, [hash, unlocked, id]);

  if (unlocked || !hash) return <>{children}</>;
  // Пока не знаем, задан ли PIN, экран не показываем — иначе он успевает запросить данные до PIN
  if (hash === "loading") return <div className="min-h-screen bg-zinc-950" />;
  if (hash === "offline") return (
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
    if (await verifyPin(pin, hash)) {
      sessionStorage.setItem(unlockKey(id), "1");
      setUnlocked(true);
    } else {
      setErr("Неверный PIN");
      setPin("");
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-xs space-y-3 text-center">
        <Lock size={28} className="text-lime-400 mx-auto" />
        <p className="text-zinc-400 text-sm">Введите PIN-код</p>
        <input
          autoFocus type="text" inputMode="numeric" value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setErr(""); }}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-center text-2xl tracking-widest outline-none focus:ring-1 focus:ring-lime-400/40"
        />
        {err && <p className="text-orange-400 text-sm">{err}</p>}
        <button type="submit" className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-xl py-2.5 hover:bg-lime-300 transition">Войти</button>
      </form>
    </div>
  );
}
