import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import ModalShell from "./ModalShell";
import { clearMyPin, hasMyPin, setMyPin } from "../lib/pin";
import { ask } from "../lib/dialog";
import { isNetworkError } from "../lib/outbox";

// PIN текущего входа (тренер или клиент) — сервер сам знает, чей он.
// onChanged — задан ли теперь PIN: экран PIN в App должен знать об этом сразу
export default function PinSettingsModal({ onClose, onChanged }: { onClose: () => void; onChanged?: (hasPin: boolean) => void }) {
  // null — узнать не удалось (нет сети/сбой): не утверждаем, что PIN не задан
  const [hasPin, setHasPin] = useState<boolean | null | "loading">("loading");
  const [pin, setPinVal] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { hasMyPin().then(setHasPin).catch((e) => { console.error("[PinSettingsModal] чтение PIN:", e); setHasPin(null); }); }, []);

  const failText = (e: unknown, action: string) => {
    console.error(`[PinSettingsModal] ${action}:`, e);
    if (isNetworkError(e)) return "Нет интернета — PIN хранится на сервере, попробуй, когда появится сеть";
    if (/4–8 цифр/.test((e as { message?: string })?.message ?? "")) return "PIN должен состоять из 4–8 цифр";
    return `Не удалось ${action}, попробуй ещё раз`;
  };

  const save = async () => {
    if (pin.length < 4) { setErr("PIN должен быть не короче 4 цифр"); return; }
    if (pin !== confirm) { setErr("PIN не совпадает"); return; }
    setBusy(true);
    try { await setMyPin(pin); onChanged?.(true); setHasPin(true); setPinVal(""); setConfirm(""); setErr(""); }
    catch (e) { setErr(failText(e, "сохранить PIN")); }
    finally { setBusy(false); }
  };

  const clear = async () => {
    if (!(await ask("Снять PIN-защиту входа?", { danger: true, ok: "Снять" }))) return;
    setBusy(true);
    try { await clearMyPin(); onChanged?.(false); setHasPin(false); setErr(""); }
    catch (e) { setErr(failText(e, "снять PIN")); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="PIN-код на вход" icon={<Lock size={17} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3 text-sm">
        <p className="text-zinc-400">{
          hasPin === "loading" ? "Проверяем, установлен ли PIN…"
          : hasPin === null ? "Не удалось узнать, установлен ли PIN. Можно задать новый."
          : hasPin ? "PIN установлен. Можно сменить или снять." : "PIN не установлен — приложение открывается без доп. защиты."
        }</p>
        <input
          type="text" inputMode="numeric" placeholder="Новый PIN (4-8 цифр)" value={pin}
          onChange={(e) => { setPinVal(e.target.value.replace(/\D/g, "").slice(0, 8)); setErr(""); }}
          className="w-full bg-zinc-800 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-lime-400/40"
        />
        <input
          type="text" inputMode="numeric" placeholder="Повтори PIN" value={confirm}
          onChange={(e) => { setConfirm(e.target.value.replace(/\D/g, "").slice(0, 8)); setErr(""); }}
          className="w-full bg-zinc-800 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-lime-400/40"
        />
        {err && <p className="text-orange-400">{err}</p>}
        <button onClick={save} disabled={busy} className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-xl py-2.5 hover:bg-lime-300 transition disabled:opacity-50">{hasPin === true ? "Сменить PIN" : "Установить PIN"}</button>
        {(hasPin === true || hasPin === null) && <button onClick={clear} disabled={busy} className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl py-2.5 transition disabled:opacity-50">Снять PIN-защиту</button>}
      </div>
    </ModalShell>
  );
}
