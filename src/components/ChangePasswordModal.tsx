import { useState } from "react";
import { KeyRound } from "lucide-react";
import ModalShell from "./ModalShell";
import { supabase } from "../lib/supabase";
import { notify } from "../lib/dialog";
import { humanError } from "../lib/errors";

// Разбор путей 1.5: сменить пароль в кабинете было негде — клиент, вошедший по ссылке
// и забывший пароль, не мог даже удалить аккаунт (там спрашивается пароль).
export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (pw.length < 8) { setErr("Минимум 8 символов"); return; }
    if (pw !== pw2) { setErr("Пароли не совпадают"); return; }
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      notify("Пароль изменён", "info");
      onClose();
    } catch (e2) {
      console.error("[ChangePasswordModal]", e2);
      setErr(humanError(e2, "Не удалось сменить пароль. Попробуй ещё раз"));
    } finally { setBusy(false); }
  };

  const inputCls = "w-full h-12 bg-zinc-800 rounded-xl px-3 outline-none focus:ring-2 focus:ring-lime-400/40";
  return (
    <ModalShell title="Сменить пароль" icon={<KeyRound size={16} className="text-lime-400" />} onClose={onClose}>
      <form onSubmit={save} className="p-4 space-y-3 text-sm">
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} placeholder="Новый пароль, минимум 8 символов" aria-label="Новый пароль" className={inputCls} />
        <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr(""); }} placeholder="Ещё раз" aria-label="Повтор пароля" className={inputCls} />
        {err && <p className="text-orange-400">{err}</p>}
        <button type="submit" disabled={busy} className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-50">{busy ? "Сохраняю…" : "Сохранить"}</button>
      </form>
    </ModalShell>
  );
}
