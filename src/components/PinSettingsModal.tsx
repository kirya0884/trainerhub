import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import ModalShell from "./ModalShell";
import { clearPin, fetchPinHash, setPin } from "../lib/pin";

export default function PinSettingsModal({ id, table = "trainers", onClose }: { id: string; table?: "trainers" | "clients"; onClose: () => void }) {
  const [hasPin, setHasPin] = useState(false);
  const [pin, setPinVal] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchPinHash(id, table).then((h) => setHasPin(!!h)); }, [id, table]);

  const save = async () => {
    if (pin.length < 4) { setErr("PIN должен быть не короче 4 цифр"); return; }
    if (pin !== confirm) { setErr("PIN не совпадает"); return; }
    setBusy(true);
    try { await setPin(id, pin, table); setHasPin(true); setPin(""); setConfirm(""); setErr(""); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    if (!window.confirm("Снять PIN-защиту входа?")) return;
    setBusy(true);
    try { await clearPin(id, table); setHasPin(false); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="PIN-код на вход" icon={<Lock size={17} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3 text-sm">
        <p className="text-zinc-400">{hasPin ? "PIN установлен. Можно сменить или снять." : "PIN не установлен — приложение открывается без доп. защиты."}</p>
        <input
          type="text" inputMode="numeric" placeholder="Новый PIN (4-8 цифр)" value={pin}
          onChange={(e) => { setPinVal(e.target.value.replace(/\D/g, "").slice(0, 8)); setErr(""); }}
          className="w-full bg-zinc-800 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-lime-400/40"
        />
        <input
          type="text" inputMode="numeric" placeholder="Повторите PIN" value={confirm}
          onChange={(e) => { setConfirm(e.target.value.replace(/\D/g, "").slice(0, 8)); setErr(""); }}
          className="w-full bg-zinc-800 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-lime-400/40"
        />
        {err && <p className="text-orange-400">{err}</p>}
        <button onClick={save} disabled={busy} className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 hover:bg-lime-300 transition disabled:opacity-50">{hasPin ? "Сменить PIN" : "Установить PIN"}</button>
        {hasPin && <button onClick={clear} disabled={busy} className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg py-2.5 transition disabled:opacity-50">Снять PIN-защиту</button>}
      </div>
    </ModalShell>
  );
}
