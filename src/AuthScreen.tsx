import { useState } from "react";
import { supabase } from "./lib/supabase";
import ConsentModal from "./components/ConsentModal";

// Тренер — email+пароль (open signup, role:"trainer" в metadata создаёт строку в trainers через триггер).
// Клиент — пароль выдаёт тренер (логин/пароль приходят на почту); ссылка на почту (magic-link) — запасной вариант,
// например для клиентов, заведённых до перехода на пароли.
export default function AuthScreen() {
  const [mode, setMode] = useState<"trainer" | "client">("trainer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [useLink, setUseLink] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const needsConsent = mode === "trainer" && isSignup;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsConsent && !agreed) { setMsg("Нужно дать согласие на обработку персональных данных"); return; }
    setBusy(true); setMsg("");
    if (mode === "client" && useLink) {
      const { error } = await supabase.auth.signInWithOtp({ email });
      setMsg(error ? error.message : "Ссылка для входа отправлена на почту — проверь ящик.");
    } else if (mode === "client") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
    } else if (isSignup) {
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { role: "trainer" } } });
      setMsg(error ? error.message : "Регистрация прошла — проверь почту для подтверждения.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold text-center"><span className="text-lime-400">Trainer</span><span className="text-cyan-400">Hub</span></h1>

        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          <button type="button" onClick={() => { setMode("trainer"); setMsg(""); }} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${mode === "trainer" ? "bg-lime-400 text-zinc-950" : "text-zinc-400"}`}>Я тренер</button>
          <button type="button" onClick={() => { setMode("client"); setMsg(""); }} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${mode === "client" ? "bg-cyan-400 text-zinc-950" : "text-zinc-400"}`}>Я клиент</button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          {(mode === "trainer" || (mode === "client" && !useLink)) && (
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          )}
          {needsConsent && (
            <label className="flex items-start gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 accent-lime-400 shrink-0" />
              <span>
                <button type="button" onClick={() => setShowConsent(true)} className="text-lime-400 hover:text-lime-300 underline underline-offset-2">Даю согласие на обработку персональных данных</button>
              </span>
            </label>
          )}
          <button disabled={busy || (needsConsent && !agreed)} type="submit" className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 disabled:opacity-50">
            {mode === "client" ? (useLink ? "Получить ссылку для входа" : "Войти") : isSignup ? "Зарегистрироваться" : "Войти"}
          </button>
        </form>

        {mode === "trainer" && (
          <button type="button" onClick={() => setIsSignup((v) => !v)} className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300">
            {isSignup ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
          </button>
        )}
        {mode === "client" && (
          <button type="button" onClick={() => { setUseLink((v) => !v); setMsg(""); }} className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300">
            {useLink ? "У меня есть пароль" : "Нет пароля? Войти по ссылке на почту"}
          </button>
        )}

        {msg && <p className="text-xs text-center text-cyan-400">{msg}</p>}
      </div>
      {showConsent && <ConsentModal onClose={() => setShowConsent(false)} />}
    </div>
  );
}
