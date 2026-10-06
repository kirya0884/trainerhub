import { useState } from "react";
import { supabase } from "./lib/supabase";
import ConsentModal from "./components/ConsentModal";
import { ArrowLeft, Dumbbell, User } from "lucide-react";

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
  const [isSignup, setIsSignup] = useState(false);
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

  // Ш2 → вход по макету: знак и заголовок слева, роль — карточками, подписи над полями,
  // вход/регистрация — ссылкой внизу вместо второго ряда кнопок.
  const title = forgotPw ? "Сброс пароля" : mode === "trainer" && isSignup ? "Регистрация в Reps" : "Вход в Reps";
  const subtitle = forgotPw
    ? "Пришлём ссылку для сброса пароля на почту"
    : mode === "client" ? "Для подопечных: логин и пароль выдаёт тренер" : "Клиенты, планы и оплаты в одном месте";
  const inputCls = "w-full h-12 bg-zinc-900 border border-zinc-800 rounded-xl px-4 outline-none focus:border-lime-400/60 focus:ring-2 focus:ring-lime-400/30 placeholder:text-zinc-600 transition";
  const RoleCard = ({ value, icon: Icon, label, hint }: { value: "trainer" | "client"; icon: typeof Dumbbell; label: string; hint: string }) => {
    const on = mode === value;
    return (
      <button type="button" onClick={() => { setMode(value); resetMsg(); }} aria-pressed={on}
        className={`text-left rounded-2xl p-3.5 bg-zinc-900 transition ${on ? "ring-2 ring-lime-400" : "ring-1 ring-zinc-800 hover:ring-zinc-700"}`}>
        <Icon size={20} className={on ? "text-lime-400" : "text-zinc-500"} />
        <span className="block font-semibold mt-2">{label}</span>
        <span className="block text-xs text-zinc-500 mt-0.5">{hint}</span>
      </button>
    );
  };

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 flex flex-col justify-center px-5 py-10">
      <div className="w-full max-w-sm mx-auto">
        <img src="/icon-192.png" alt="Reps" className="w-16 h-16 rounded-[20px]" />
        <h1 className="text-3xl font-extrabold tracking-tight mt-6 leading-tight">{title}</h1>
        <p className="text-[15px] text-zinc-400 mt-2">{subtitle}</p>

        {forgotPw ? (
          <form onSubmit={submitForgot} className="mt-7 space-y-4">
            <div>
              <label htmlFor="auth-email" className="block text-sm font-medium mb-2">Email</label>
              <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mail.ru" className={inputCls} />
            </div>
            <button disabled={busy} type="submit" className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98] disabled:opacity-50">
              {busy ? "Отправка..." : "Отправить ссылку"}
            </button>
            {msg && <p className={`text-sm text-center ${msgIsError ? "text-red-400" : "text-cyan-400"}`}>{msg}</p>}
            <button type="button" onClick={() => { setForgotPw(false); resetMsg(); }} className="w-full flex items-center justify-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 py-2">
              <ArrowLeft size={16} /> Назад ко входу
            </button>
          </form>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 mt-7">
              <RoleCard value="trainer" icon={Dumbbell} label="Я тренер" hint="Веду подопечных" />
              <RoleCard value="client" icon={User} label="Я клиент" hint="Тренируюсь у тренера" />
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="auth-email" className="block text-sm font-medium mb-2">Email</label>
                <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mail.ru" className={inputCls} />
              </div>
              {(mode === "trainer" || (mode === "client" && !useLink)) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="auth-password" className="text-sm font-medium">Пароль</label>
                    {mode === "trainer" && !isSignup && (
                      <button type="button" onClick={() => { setForgotPw(true); resetMsg(); }} className="text-sm text-zinc-400 hover:text-zinc-100">Забыли?</button>
                    )}
                  </div>
                  <input id="auth-password" type="password" autoComplete={mode === "trainer" && isSignup ? "new-password" : "current-password"} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "trainer" && isSignup ? "Минимум 6 символов" : ""} className={inputCls} />
                </div>
              )}
              {needsConsent && (
                <label className="flex items-start gap-2.5 text-sm text-zinc-400">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 accent-lime-400 shrink-0 w-4 h-4" />
                  <span>
                    <button type="button" onClick={() => setShowConsent(true)} className="text-lime-400 hover:text-lime-300 underline underline-offset-2 text-left">Даю согласие на обработку персональных данных</button>
                  </span>
                </label>
              )}
              <button disabled={busy || (needsConsent && !agreed)} type="submit" className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98] disabled:opacity-50">
                {busy ? "..." : mode === "client" ? (useLink ? "Получить ссылку для входа" : "Войти") : isSignup ? "Зарегистрироваться" : "Войти"}
              </button>
              {msg && <p className={`text-sm text-center ${msgIsError ? "text-red-400" : "text-cyan-400"}`}>{msg}</p>}
            </form>

            <div className="mt-5 text-center text-sm text-zinc-400">
              {mode === "trainer" ? (
                <button type="button" onClick={() => { setIsSignup((v) => !v); resetMsg(); setPassword(""); }} className="py-2 hover:text-zinc-200">
                  {isSignup ? <>Уже есть аккаунт? <span className="font-semibold text-zinc-100">Войти</span></> : <>Нет аккаунта? <span className="font-semibold text-zinc-100">Зарегистрироваться</span></>}
                </button>
              ) : (
                <button type="button" onClick={() => { setUseLink((v) => !v); resetMsg(); }} className="py-2 hover:text-zinc-200">
                  {useLink ? <>У меня есть <span className="font-semibold text-zinc-100">пароль</span></> : <>Нет пароля? <span className="font-semibold text-zinc-100">Войти по ссылке на почту</span></>}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {showConsent && <ConsentModal onClose={() => setShowConsent(false)} />}
    </div>
  );
}
