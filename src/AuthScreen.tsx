import { useState } from "react";
import { supabase } from "./lib/supabase";
import ConsentModal from "./components/ConsentModal";

// Тренер — email+пароль (open signup, role:"trainer" в metadata создаёт строку в trainers через триггер).
// Клиент — пароль выдаёт тренер (логин/пароль приходят на почту); ссылка на почту (magic-link) — запасной вариант.
function localizeError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "Неверный email или пароль";
  if (/email not confirmed/i.test(msg)) return "Email не подтверждён — проверь почту и перейди по ссылке из письма.";
  if (/user already registered/i.test(msg)) return "Аккаунт с таким email уже существует — войдите.";
  if (/password should be/i.test(msg)) return "Пароль слишком короткий (минимум 6 символов)";
  if (/for security purposes/i.test(msg)) return "Слишком много попыток — подожди немного и попробуй снова";
  if (/rate limit/i.test(msg)) return "Слишком много запросов — подожди минуту";
  return msg;
}

export default function AuthScreen() {
  const [mode, setMode] = useState<"trainer" | "client">("trainer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(true);
  const [useLink, setUseLink] = useState(false);
  const [forgotPw, setForgotPw] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgIsError, setMsgIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const needsConsent = mode === "trainer" && isSignup;

  const resetMsg = () => { setMsg(""); setMsgIsError(false); };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); resetMsg();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) { setMsg(localizeError(error.message)); setMsgIsError(true); }
    else setMsg("Ссылка для сброса пароля отправлена — проверь почту.");
    setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsConsent && !agreed) { setMsg("Нужно дать согласие на обработку персональных данных"); setMsgIsError(true); return; }
    setBusy(true); resetMsg();
    let error: any = null;
    if (mode === "client" && useLink) {
      ({ error } = await supabase.auth.signInWithOtp({ email }));
      if (!error) setMsg("Ссылка для входа отправлена на почту — проверь ящик.");
    } else if (mode === "client") {
      ({ error } = await supabase.auth.signInWithPassword({ email, password }));
    } else if (isSignup) {
      ({ error } = await supabase.auth.signUp({ email, password, options: { data: { role: "trainer" } } }));
      if (!error) setMsg("Регистрация прошла — проверь почту для подтверждения.");
    } else {
      ({ error } = await supabase.auth.signInWithPassword({ email, password }));
    }
    if (error) { setMsg(localizeError(error.message)); setMsgIsError(true); }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold text-center"><span className="text-lime-400">Trainer</span><span className="text-cyan-400">Hub</span></h1>
        <p className="text-xs text-zinc-500 text-center -mt-2">Платформа для персональных тренеров</p>

        {forgotPw ? (
          <>
            <p className="text-sm text-zinc-400 text-center">Введи email — пришлём ссылку для сброса пароля.</p>
            <form onSubmit={submitForgot} className="space-y-3">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
              <button disabled={busy} type="submit" className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 disabled:opacity-50">
                {busy ? "Отправка..." : "Отправить ссылку"}
              </button>
            </form>
            <button type="button" onClick={() => { setForgotPw(false); resetMsg(); }} className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300">← Назад</button>
          </>
        ) : (
          <>
            <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
              <button type="button" onClick={() => { setMode("trainer"); resetMsg(); }} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${mode === "trainer" ? "bg-lime-400 text-zinc-950" : "text-zinc-400"}`}>Я тренер</button>
              <button type="button" onClick={() => { setMode("client"); resetMsg(); }} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${mode === "client" ? "bg-cyan-400 text-zinc-950" : "text-zinc-400"}`}>Я клиент</button>
            </div>

            {mode === "trainer" && (
              <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
                <button type="button" onClick={() => { setIsSignup(false); resetMsg(); setPassword(""); }} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${!isSignup ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>Войти</button>
                <button type="button" onClick={() => { setIsSignup(true); resetMsg(); setPassword(""); }} className={`flex-1 py-1.5 rounded-md text-sm font-medium transition ${isSignup ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>Регистрация</button>
              </div>
            )}
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
                {busy ? "..." : mode === "client" ? (useLink ? "Получить ссылку для входа" : "Войти") : isSignup ? "Зарегистрироваться" : "Войти"}
              </button>
            </form>

            <div className="space-y-1">
              {mode === "trainer" && !isSignup && (
                <button type="button" onClick={() => { setForgotPw(true); resetMsg(); }} className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300">
                  Забыл пароль?
                </button>
              )}

              {mode === "client" && (
                <button type="button" onClick={() => { setUseLink((v) => !v); resetMsg(); }} className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300">
                  {useLink ? "У меня есть пароль" : "Нет пароля? Войти по ссылке на почту"}
                </button>
              )}
            </div>
          </>
        )}

        {msg && <p className={`text-xs text-center ${msgIsError ? "text-red-400" : "text-cyan-400"}`}>{msg}</p>}
      </div>
      {showConsent && <ConsentModal onClose={() => setShowConsent(false)} />}
    </div>
  );
}
