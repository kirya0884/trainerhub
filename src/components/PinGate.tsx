import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { fetchPinHash, verifyPin } from "../lib/pin";

const unlockKey = (id: string) => `trainerhub-pin-unlocked-${id}`;

// Гейт показывается между успешным входом (Supabase auth) и основным интерфейсом, если у трен./клиента задан PIN.
// Разблокировка живёт в sessionStorage — спрашиваем PIN заново при каждом новом открытии вкладки/браузера.
export default function PinGate({ id, table = "trainers", children }: { id: string; table?: "trainers" | "clients"; children: React.ReactNode }) {
  const [hash, setHash] = useState<string | null | "loading">("loading");
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(unlockKey(id)) === "1");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { fetchPinHash(id, table).then((h) => setHash(h || null)); }, [id, table]);

  if (hash === "loading" || unlocked || !hash) return <>{children}</>;

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
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-center text-2xl tracking-widest outline-none focus:ring-1 focus:ring-lime-400/40"
        />
        {err && <p className="text-orange-400 text-sm">{err}</p>}
        <button type="submit" className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 hover:bg-lime-300 transition">Войти</button>
      </form>
    </div>
  );
}
