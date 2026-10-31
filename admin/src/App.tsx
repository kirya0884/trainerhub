import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BarChart3, Briefcase, Filter, Gauge, LogOut, Moon, Repeat2, Sparkles, Sun, Users, Zap } from "lucide-react";
import { supabase } from "./lib/supabase";
import * as api from "./lib/api";
import type { Grain, Range } from "./lib/api";
import { addDays, daysBetween, today, tz } from "./lib/format";
import { Seg } from "./components/ui";
import Overview from "./pages/Overview";
import Engagement from "./pages/Engagement";
import Retention from "./pages/Retention";
import FunnelPage from "./pages/FunnelPage";
import Features from "./pages/Features";
import Business from "./pages/Business";
import Trainers from "./pages/Trainers";

const PAGES = [
  ["overview", "Обзор", Gauge], ["engagement", "Вовлечённость", Zap], ["retention", "Удержание", Repeat2], ["funnel", "Воронка", Filter],
  ["features", "Функции", Sparkles], ["business", "Бизнес", Briefcase], ["trainers", "Тренеры", Users],
] as const;
type Page = (typeof PAGES)[number][0];
type Preset = "7" | "30" | "90" | "365" | "all" | "custom";
const PRESETS: [Preset, string][] = [["7", "7 дней"], ["30", "30 дней"], ["90", "90 дней"], ["365", "Год"], ["all", "Всё время"], ["custom", "Свой"]];
const START = "2026-06-01"; // запуск приложения — раньше данных нет

const readHash = (): Page => {
  const p = location.hash.replace(/^#\/?/, "").split("/")[0] as Page;
  return PAGES.some(([k]) => k === p) ? p : "overview";
};

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // undefined — проверяем; mfa — после пароля нужен код 2FA (п. 57)
  const [access, setAccess] = useState<"none" | "mfa" | "ok" | undefined>(undefined);
  // После ввода кода вход тот же (user.id не меняется) — проверку перезапускаем вручную
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    setAccess(undefined);
    if (session) api.adminAccess().then(setAccess).catch(() => setAccess("none"));
  }, [session?.user.id, recheck]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined || (session && access === undefined)) return <Splash />;
  if (!session) return <Login />;
  if (access === "none") return <NoAccess email={session.user.email ?? ""} />;
  if (access === "mfa") return <Mfa onDone={() => setRecheck((n) => n + 1)} />;
  return <Shell email={session.user.email ?? ""} />;
}

function Shell({ email }: { email: string }) {
  const [page, setPage] = useState<Page>(readHash);
  useEffect(() => { const f = () => setPage(readHash()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  const go = (p: Page) => { location.hash = `#/${p}`; };

  // Период: пресет или свои даты; детализация; без своего аккаунта
  const [preset, setPreset] = useState<Preset>(() => (localStorage.getItem("adm-preset") as Preset) || "30");
  const [from, setFrom] = useState(addDays(today(), -29));
  const [to, setTo] = useState(today());
  const [grain, setGrain] = useState<Grain | "auto">("auto");
  const [ex, setEx] = useState(() => localStorage.getItem("adm-ex") !== "0");
  const [light, setLight] = useState(() => localStorage.getItem("adm-theme") === "light");
  useEffect(() => { document.documentElement.classList.toggle("light", light); localStorage.setItem("adm-theme", light ? "light" : "dark"); }, [light]);
  useEffect(() => { localStorage.setItem("adm-ex", ex ? "1" : "0"); }, [ex]);
  useEffect(() => {
    localStorage.setItem("adm-preset", preset);
    if (preset === "custom") return;
    setTo(today());
    setFrom(preset === "all" ? START : addDays(today(), -(Number(preset) - 1)));
  }, [preset]);

  const range: Range = useMemo(() => {
    const len = daysBetween(from, to);
    const g: Grain = grain !== "auto" ? grain : len <= 45 ? "day" : len <= 200 ? "week" : "month";
    return { from, to, grain: g, ex, tz: tz() };
  }, [from, to, grain, ex]);

  const P = { overview: Overview, engagement: Engagement, retention: Retention, funnel: FunnelPage, features: Features, business: Business, trainers: Trainers }[page];

  return (
    <div className="min-h-screen lg:flex">
      <aside className="lg:w-60 lg:shrink-0 lg:h-screen lg:sticky lg:top-0 border-b lg:border-b-0 lg:border-r border-line bg-surface/60 backdrop-blur">
        <div className="flex items-center gap-2.5 px-4 h-14">
          <span className="w-8 h-8 rounded-xl bg-accent text-onaccent flex items-center justify-center font-extrabold">R</span>
          <div className="leading-tight"><b>Reps</b><div className="text-[12px] text-ink3">админ-панель</div></div>
          <div className="ml-auto flex lg:hidden gap-1">
            <button onClick={() => setLight((v) => !v)} aria-label="Тема" className="w-9 h-9 rounded-lg hover:bg-surface2 flex items-center justify-center text-ink2">{light ? <Moon size={17} /> : <Sun size={17} />}</button>
            <button onClick={() => supabase.auth.signOut()} aria-label="Выйти" className="w-9 h-9 rounded-lg hover:bg-surface2 flex items-center justify-center text-ink2"><LogOut size={17} /></button>
          </div>
        </div>
        <nav className="flex lg:flex-col gap-1 px-2 pb-2 overflow-x-auto">
          {PAGES.map(([k, l, Icon]) => (
            <button key={k} onClick={() => go(k)} aria-current={page === k ? "page" : undefined}
              className={`h-10 px-3 rounded-xl flex items-center gap-2.5 text-sm font-semibold whitespace-nowrap transition ${page === k ? "bg-accent text-onaccent" : "text-ink2 hover:bg-surface2 hover:text-ink"}`}>
              <Icon size={17} /> {l}
            </button>
          ))}
        </nav>
        <div className="hidden lg:block absolute bottom-0 inset-x-0 p-3 border-t border-line">
          <p className="text-[12px] text-ink3 truncate px-1 mb-2">{email}</p>
          <div className="flex gap-1">
            <button onClick={() => setLight((v) => !v)} className="flex-1 h-9 rounded-lg bg-surface2 text-ink2 hover:text-ink text-[13px] font-semibold flex items-center justify-center gap-1.5">{light ? <Moon size={15} /> : <Sun size={15} />}{light ? "Тёмная" : "Светлая"}</button>
            <button onClick={() => supabase.auth.signOut()} className="h-9 px-3 rounded-lg bg-surface2 text-ink2 hover:text-ink flex items-center" aria-label="Выйти"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {/* Фильтры — одной строкой над всеми графиками */}
        <div className="sticky top-0 z-20 bg-bg/85 backdrop-blur border-b border-line">
          <div className="max-w-[1400px] mx-auto px-4 py-3 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-extrabold tracking-tight mr-2">{PAGES.find(([k]) => k === page)![1]}</h1>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <Seg value={preset} options={PRESETS} onChange={setPreset} />
              {preset === "custom" && (
                <div className="flex items-center gap-1.5 text-[13px]">
                  <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-8 px-2 rounded-lg bg-surface2 border border-line" aria-label="С" />
                  <span className="text-ink3">—</span>
                  <input type="date" value={to} min={from} max={today()} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-8 px-2 rounded-lg bg-surface2 border border-line" aria-label="По" />
                </div>
              )}
              <Seg value={grain} options={[["auto", "Авто"], ["day", "Дни"], ["week", "Недели"], ["month", "Месяцы"]]} onChange={setGrain} />
              <label className="h-8 px-3 rounded-xl bg-surface2 border border-line flex items-center gap-2 text-[13px] font-semibold cursor-pointer select-none" title="Ваш собственный аккаунт тренера (админа) не учитывается в цифрах">
                <input type="checkbox" checked={ex} onChange={(e) => setEx(e.target.checked)} className="accent-[rgb(var(--accent))]" /> Без моего аккаунта
              </label>
            </div>
          </div>
        </div>
        <div className="max-w-[1400px] mx-auto px-4 py-5 pb-16">
          <P range={range} />
        </div>
      </main>
    </div>
  );
}

function Splash() {
  return <div className="min-h-screen flex items-center justify-center text-ink3"><BarChart3 className="animate-pulse" size={28} /></div>;
}

// Вход тем же аккаунтом, что в Reps. Доступ — только у тех, кто в списке админов.
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message === "Invalid login credentials" ? "Неверная почта или пароль" : error.message);
    setBusy(false);
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-surface border border-line rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-xl bg-accent text-onaccent flex items-center justify-center font-extrabold text-lg">R</span>
          <div><b className="text-lg">Reps · админ</b><div className="text-[13px] text-ink3">Вход аккаунтом Reps</div></div>
        </div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="Почта" required className="w-full h-12 px-3.5 rounded-xl bg-surface2 border border-line outline-none focus:ring-2 focus:ring-accent/50" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="Пароль" required className="w-full h-12 px-3.5 rounded-xl bg-surface2 border border-line outline-none focus:ring-2 focus:ring-accent/50" />
        {error && <p className="text-sm text-bad">{error}</p>}
        <button disabled={busy} className="w-full h-12 rounded-xl bg-accent text-onaccent font-bold disabled:opacity-50">{busy ? "Входим…" : "Войти"}</button>
      </form>
    </div>
  );
}

// Второй шаг входа: код из приложения-аутентификатора (TOTP). Фактора ещё нет — подключаем:
// QR и секрет текстом, первый код подтверждает подключение и сразу поднимает вход до aal2.
function Mfa({ onDone }: { onDone: () => void }) {
  const [factorId, setFactorId] = useState("");
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoadError("");
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const verified = data.totp[0];
      if (verified) { if (alive) setFactorId(verified.id); return; }
      // Брошенное подключение (закрыли вкладку до кода) — убираем, иначе новое может не создаться
      for (const f of data.all) if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (!alive) return;
      const { data: en, error: enErr } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "Reps админ" });
      if (enErr) throw enErr;
      if (alive) { setFactorId(en.id); setSetup({ qr: en.totp.qr_code, secret: en.totp.secret }); }
    })().catch((e) => { console.error("[admin] mfa:", e); if (alive) setLoadError(e?.message || "Не удалось подготовить вход"); });
    return () => { alive = false; };
  }, [attempt]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError("Нужно 6 цифр"); return; }
    setBusy(true); setError("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) { setError(/invalid|code/i.test(error.message) ? "Неверный код. Проверь, что время на телефоне точное, и введи новый код." : error.message); setCode(""); return; }
    onDone();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-surface border border-line rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-xl bg-accent text-onaccent flex items-center justify-center font-extrabold text-lg">R</span>
          <div><b className="text-lg">Двухфакторный вход</b><div className="text-[13px] text-ink3">{setup ? "Подключи приложение-аутентификатор" : "Код из приложения-аутентификатора"}</div></div>
        </div>
        {loadError ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-bad">{loadError}</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="h-11 px-5 rounded-xl bg-surface2 font-semibold">Повторить</button>
          </div>
        ) : !factorId ? (
          <p className="text-sm text-ink3" aria-busy="true">Готовим вход…</p>
        ) : (
          <>
            {setup && (
              <div className="space-y-2">
                <p className="text-sm text-ink2">Отсканируй QR в Google Authenticator, 1Password или похожем приложении и введи код из него.</p>
                <img src={setup.qr} alt="QR-код для приложения-аутентификатора" className="w-48 h-48 mx-auto rounded-xl bg-white p-2" />
                <p className="text-[13px] text-ink3">Не сканируется — введи ключ вручную:</p>
                <code className="block text-sm break-all select-all bg-surface2 border border-line rounded-xl px-3 py-2">{setup.secret}</code>
              </div>
            )}
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus
              placeholder="6 цифр" aria-label="Код из приложения" required className="w-full h-12 px-3.5 rounded-xl bg-surface2 border border-line outline-none focus:ring-2 focus:ring-accent/50 tracking-[0.3em] text-center text-lg" />
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <button disabled={busy || code.length !== 6} className="w-full h-12 rounded-xl bg-accent text-onaccent font-bold disabled:opacity-50">{busy ? "Проверяем…" : "Подтвердить"}</button>
          </>
        )}
        <button type="button" onClick={() => supabase.auth.signOut()} className="w-full text-sm text-ink3 hover:text-ink">Выйти</button>
      </form>
    </div>
  );
}

function NoAccess({ email }: { email: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 text-center">
      <div className="max-w-sm space-y-3">
        <p className="text-lg font-bold">Нет доступа</p>
        <p className="text-sm text-ink2">Аккаунт {email} не в списке админов панели.</p>
        <button onClick={() => supabase.auth.signOut()} className="h-11 px-5 rounded-xl bg-surface2 font-semibold">Выйти</button>
      </div>
    </div>
  );
}
