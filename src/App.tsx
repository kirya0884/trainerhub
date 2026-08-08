import { useEffect, useState } from "react";
import { LayoutDashboard, Users, CalendarDays, Sparkles, ClipboardList, User, Plus, X, Pin } from "lucide-react";
import { supabase } from "./lib/supabase";
import type { Session } from "@supabase/supabase-js";
import AuthScreen from "./AuthScreen";
import PlanEditor from "./components/PlanEditor";
import PlansOverview from "./components/PlansOverview";
import ClientsList from "./components/ClientsList";
import ClientProfile from "./components/ClientProfile";
import Dashboard from "./components/Dashboard";
import CalendarView from "./components/CalendarView";
import ClientPortal from "./components/ClientPortal";
import { useBookings } from "./hooks/useBookings";
import { useClients } from "./hooks/useClients";
import SubscriptionModal from "./components/SubscriptionModal";
import BackupModal from "./components/BackupModal";
import PinGate from "./components/PinGate";
import PinSettingsModal from "./components/PinSettingsModal";
import TrashModal from "./components/TrashModal";
import TrainerProfile from "./components/TrainerProfile";
import * as portalApi from "./lib/clientPortal";
import * as trainerApi from "./lib/trainer";
import SplashScreen from "./components/SplashScreen";
import type { SelfClient } from "./lib/clientPortal";
import type { Sub } from "./components/ClientProfile";

type View = { kind: "dashboard" } | { kind: "clients"; newForm?: boolean } | { kind: "calendar"; newBooking?: boolean; openOccurrence?: { id: string; occDate: string } } | { kind: "plans"; newPlan?: boolean } | { kind: "client"; clientId: string; sub?: Sub } | { kind: "plan"; planId: string; clientId: string; from?: "plans" } | { kind: "trainerProfile" };
type TabKind = "dashboard" | "plans" | "clients" | "calendar" | "trainerProfile";
const TAB_DEFS: Record<TabKind, { label: string; icon: typeof Users }> = {
  dashboard: { label: "Дашборд", icon: LayoutDashboard },
  clients: { label: "Подопечные", icon: Users },
  plans: { label: "Планы", icon: ClipboardList },
  calendar: { label: "Календарь", icon: CalendarDays },
  trainerProfile: { label: "Профиль", icon: User },
};
const DEFAULT_TAB_ORDER: TabKind[] = ["dashboard", "clients", "plans", "calendar", "trainerProfile"];
const RECENT_KEY = "trainerhub-recent-clients-v1";
const PINNED_KEY = "trainerhub-pinned-clients-v1";
const RECENT_MAX = 8;
// B10: недавние и закреплённые подопечные — личная настройка устройства,
// та же схема, что у порядка вкладок: localStorage, без бэкенда.
const loadIds = (key: string): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (Array.isArray(saved)) return saved.filter((x) => typeof x === "string");
  } catch {}
  return [];
};
const saveIds = (key: string, ids: string[]) => { try { localStorage.setItem(key, JSON.stringify(ids)); } catch {} };

const TAB_ORDER_KEY = "trainerhub-tab-order-v1";
const TAB_HIDDEN_KEY = "trainerhub-tab-hidden-v1";
// ponytail: порядок и видимость вкладок — личная настройка устройства, храним в localStorage, без бэкенда
const loadTabOrder = (): TabKind[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || "null") as TabKind[] | null;
    if (saved && saved.length === DEFAULT_TAB_ORDER.length && DEFAULT_TAB_ORDER.every((k) => saved.includes(k))) return saved;
  } catch {}
  return DEFAULT_TAB_ORDER;
};
const loadHiddenTabs = (): TabKind[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(TAB_HIDDEN_KEY) || "null") as TabKind[] | null;
    if (saved) return saved.filter((k) => DEFAULT_TAB_ORDER.includes(k));
  } catch {}
  return [];
};

function PasswordResetScreen({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) { setMsg("Минимум 6 символов"); return; }
    if (pw !== pw2) { setMsg("Пароли не совпадают"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setMsg(error.message); setBusy(false); return; }
    setMsg("Пароль изменён!");
    setTimeout(onDone, 1200);
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold text-center"><span className="text-lime-400">Trainer</span><span className="text-cyan-400">Hub</span></h1>
        <p className="text-sm text-zinc-400 text-center">Придумай новый пароль</p>
        <form onSubmit={submit} className="space-y-3">
          <input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Новый пароль" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          <input type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Повтори пароль" className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          <button disabled={busy} type="submit" className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 disabled:opacity-50">
            {busy ? "Сохранение..." : "Сохранить новый пароль"}
          </button>
        </form>
        {msg && <p className="text-xs text-center text-cyan-400">{msg}</p>}
      </div>
    </div>
  );
}

// ponytail: навигация — простой стейт-стек без роутера, пока приложение состоит из 3 экранов
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [selfClient, setSelfClient] = useState<SelfClient | null | undefined>(undefined);
  const [isTrainer, setIsTrainer] = useState<boolean | undefined>(undefined);
  // B17: общие данные грузим один раз здесь, а не в каждой вкладке заново.
  // Хуки обязаны вызываться до ранних return ниже, поэтому пустой id = «пока не грузим».
  const dataTrainerId = isTrainer && session ? session.user.id : "";
  const bookingsHook = useBookings(dataTrainerId);
  const { clients, reload: reloadClients } = useClients(dataTrainerId);
  const [showBackup, setShowBackup] = useState(false);
  const [showPinSettings, setShowPinSettings] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showSubscription, setShowSubscription] = useState(false);
  const [trainerName, setTrainerName] = useState("");
  const [trainerAvatar, setTrainerAvatar] = useState("");
  const [trainerAccent, setTrainerAccent] = useState("#a3e635");
  const [themeMode, setThemeMode] = useState<"dark" | "light">(
    () => (localStorage.getItem("trainerhub-theme-v1") as "dark" | "light") || "dark"
  );
  const [tabOrder, setTabOrder] = useState<TabKind[]>(loadTabOrder);
  const [hiddenTabs, setHiddenTabs] = useState<TabKind[]>(loadHiddenTabs);
  const [splash, setSplash] = useState(true);
  const [dragTab, setDragTab] = useState<TabKind | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showFab, setShowFab] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>(loadIds(RECENT_KEY));
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadIds(PINNED_KEY));
  // Единая точка открытия карточки — здесь же копится история недавних.
  const openClient = (clientId: string, sub?: Sub) => {
    setRecentIds((prev) => { const next = [clientId, ...prev.filter((id) => id !== clientId)].slice(0, RECENT_MAX); saveIds(RECENT_KEY, next); return next; });
    setView({ kind: "client", clientId, sub });
  };
  const togglePinned = (clientId: string) => {
    setPinnedIds((prev) => { const next = prev.includes(clientId) ? prev.filter((id) => id !== clientId) : [clientId, ...prev]; saveIds(PINNED_KEY, next); return next; });
  };
  const reorderTabs = (target: TabKind) => {
    if (!dragTab || dragTab === target) return;
    const next = tabOrder.filter((k) => k !== dragTab);
    next.splice(next.indexOf(target), 0, dragTab);
    setTabOrder(next);
    try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(next)); } catch {}
  };
  const toggleTabVisible = (kind: TabKind) => {
    const isHidden = hiddenTabs.includes(kind);
    if (!isHidden && hiddenTabs.length >= tabOrder.length - 1) return; // хотя бы одна вкладка должна остаться видимой
    const next = isHidden ? hiddenTabs.filter((k) => k !== kind) : [...hiddenTabs, kind];
    setHiddenTabs(next);
    try { localStorage.setItem(TAB_HIDDEN_KEY, JSON.stringify(next)); } catch {}
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setIsRecovery(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // После входа клиента по magic-link — привязываем auth.uid() к его карточке, затем проверяем,
  // относится ли текущий вход к клиенту (подопечному) — тогда показываем ClientPortal вместо экранов тренера.
  // Если карточка не привязалась (email у клиента не указан/не совпадает) и это не аккаунт тренера —
  // показываем экран "нет доступа" вместо пустого тренерского интерфейса.
  const checkAccess = async (uid: string) => {
    // Тренера проверяем первым — если аккаунт тренерский, ошибочная привязка клиента по совпавшему email не перехватит вход.
    const { data: trainerRow } = await supabase.from("trainers").select("id").eq("id", uid).maybeSingle();
    if (trainerRow) { setIsTrainer(true); setSelfClient(null); return; }
    const { error } = await supabase.rpc("link_client_self");
    if (error) console.warn("link_client_self:", error.message);
    const self = await portalApi.fetchSelfClient(uid);
    setSelfClient(self);
    setIsTrainer(false);
  };
  useEffect(() => {
    if (!session) { setSelfClient(undefined); setIsTrainer(undefined); return; }
    checkAccess(session.user.id);
  }, [session]);

  // ponytail: поллинг раз в 15с — карточка клиента (абонемент/остаток тренировок и т.п.) должна
  // подхватывать правки тренера без перезахода, см. ChatThread (тот же паттерн для чата).
  useEffect(() => {
    if (!session || isTrainer) return;
    const id = setInterval(() => { portalApi.fetchSelfClient(session.user.id).then(setSelfClient).catch((e) => console.error("[App] pollSelfClient:", e)); }, 15000);
    return () => clearInterval(id);
  }, [session, isTrainer]);

  useEffect(() => {
    if (isTrainer && session) trainerApi.fetchTrainerSelf(session.user.id).then((s) => { setTrainerName(s.profile.name); setTrainerAvatar(s.profile.avatarUrl); setTrainerAccent(s.profile.accentColor || "#a3e635"); }).catch((e) => console.error("[App] fetchTrainerSelf:", e));
  }, [isTrainer, session]);
  useEffect(() => {
    document.documentElement.classList.toggle("light-theme", themeMode === "light");
    try { localStorage.setItem("trainerhub-theme-v1", themeMode); } catch {}
  }, [themeMode]);

  if (loading) return (<>{splash && <SplashScreen onDone={() => setSplash(false)} ready={false} />}<div className="min-h-screen bg-zinc-950" /></>);
  if (!session) return <AuthScreen />;

  if (isRecovery) return <PasswordResetScreen onDone={() => setIsRecovery(false)} />;
  if (selfClient === undefined || isTrainer === undefined) return (<>{splash && <SplashScreen onDone={() => setSplash(false)} ready={false} />}<div className="min-h-screen bg-zinc-950" /></>);

  if (selfClient) {
    return (
      <PinGate id={selfClient.id} table="clients">
        <div className="min-h-screen bg-zinc-950 text-zinc-100 px-3 sm:px-4 py-4 sm:py-6">
          <ClientPortal client={selfClient} />
        </div>
      </PinGate>
    );
  }

  if (!isTrainer) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-3">
          <p className="text-lg font-semibold">Нет доступа к аккаунту</p>
          <p className="text-sm text-zinc-500">
            Вход выполнен ({session.user.email}), но карточка подопечного не найдена. Проверьте у тренера, что в вашей карточке указан именно этот email для входа.
          </p>
          <div className="flex gap-2 justify-center pt-1">
            <button onClick={() => checkAccess(session.user.id)} className="bg-cyan-400 text-zinc-950 font-semibold rounded-lg px-3 py-2 text-sm hover:bg-cyan-300 transition">Повторить</button>
            <button onClick={() => supabase.auth.signOut()} className="text-sm text-zinc-500 hover:text-zinc-300 px-3 py-2">Выйти</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    {splash && <SplashScreen onDone={() => setSplash(false)} ready={!loading && selfClient !== undefined && isTrainer !== undefined} />}
    <PinGate id={session.user.id}>
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-3 sm:px-4 py-4 sm:py-6 pb-24 sm:pb-6" style={{ "--accent": trainerAccent } as React.CSSProperties}>
      <div className="max-w-2xl mx-auto space-y-4">
        {/* B30: одна строка вместо двух — логотип вместо надписи «Reps», профиль и подписка
            сразу справа. Меню «⋯» переехало в профиль тренера. */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView({ kind: "dashboard" })}
            title="На главный экран"
            aria-label="На главный экран"
            className={`shrink-0 rounded-lg p-1 transition ${view.kind === "dashboard" ? "opacity-60" : "hover:bg-zinc-800"}`}
          >
            <img src="/icon-512.png" alt="Reps" className="w-7 h-7 rounded-lg object-cover" />
          </button>
          <button onClick={() => setView({ kind: "trainerProfile" })} className="ml-auto flex items-center gap-2 min-w-0 text-lime-400 font-semibold text-sm hover:text-lime-300 transition">
            {trainerAvatar ? (
              <img src={trainerAvatar} alt="" className="w-7 h-7 rounded-full object-cover border border-zinc-700 shrink-0" />
            ) : (
              <span className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-[11px] text-zinc-500 shrink-0">{(trainerName || session.user.email || "?")[0]?.toUpperCase()}</span>
            )}
            <span className="truncate">{trainerName || session.user.email}</span>
          </button>
          {/* ponytail: план пока всегда «Старт» — подключится к биллингу при интеграции оплаты */}
          <button onClick={() => setShowSubscription(true)} className="flex items-center gap-1 shrink-0 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 text-[11px] font-semibold rounded-full px-2 py-0.5 transition">
            <Sparkles size={10} className="text-lime-400" /> Старт
          </button>
        </div>
        {showBackup && <BackupModal trainerId={session.user.id} onClose={() => setShowBackup(false)} />}
        {showPinSettings && <PinSettingsModal id={session.user.id} onClose={() => setShowPinSettings(false)} />}
        {showTrash && <TrashModal trainerId={session.user.id} onClose={() => setShowTrash(false)} />}
        {showSubscription && <SubscriptionModal onClose={() => setShowSubscription(false)} />}
        {/* B10: недавние и закреплённые подопечные. Под плитками — плитки остаются
            основной навигацией. Ряд появляется только при наличии истории, поэтому
            на чистом аккаунте первый экран не растёт. Id удалённых клиентов отсеиваются. */}
        {view.kind === "dashboard" && (() => {
          const byId = new Map((clients ?? []).map((c) => [c.id, c]));
          const ordered = [...pinnedIds, ...recentIds.filter((id) => !pinnedIds.includes(id))]
            .map((id) => byId.get(id)).filter(Boolean).slice(0, RECENT_MAX) as NonNullable<ReturnType<typeof byId.get>>[];
          if (!ordered.length) return null;
          return (
            <div>
              <p className="text-xs font-semibold tracking-widest text-zinc-500 mb-2">НЕДАВНИЕ</p>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                {ordered.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openClient(c.id)}
                    title={c.name}
                    className="flex flex-col items-center gap-1.5 shrink-0 w-16 group"
                  >
                    <span className="relative">
                      {c.avatarUrl
                        ? <img src={c.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover border-2 transition" style={{ borderColor: c.color }} />
                        : <span className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-zinc-950 transition" style={{ background: c.color }}>{c.name[0]?.toUpperCase()}</span>}
                      {pinnedIds.includes(c.id) && (
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                          <Pin size={9} className="text-lime-400" />
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-zinc-400 truncate w-full text-center leading-tight group-hover:text-zinc-200 transition">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
        {view.kind === "dashboard" && (
          <Dashboard trainerId={session.user.id} bookings={bookingsHook.bookings} onOpenClient={openClient} onOpenOccurrence={(id, occDate) => setView({ kind: "calendar", openOccurrence: { id, occDate } })} />
        )}
        {view.kind === "calendar" && (
          <CalendarView trainerId={session.user.id} bookingsHook={bookingsHook} clients={clients ?? []} reloadClients={reloadClients} openBooking={view.newBooking} openOccurrence={view.openOccurrence} onOpenClient={openClient} onOpenClientPlans={(clientId) => openClient(clientId, "plans")} />
        )}
        {view.kind === "plans" && (
          <PlansOverview trainerId={session.user.id} clients={clients ?? []} autoFocusNew={view.newPlan} onOpenPlan={(planId, clientId) => setView({ kind: "plan", planId, clientId, from: "plans" })} />
        )}
        {view.kind === "clients" && (
          <ClientsList trainerId={session.user.id} clients={clients} reloadClients={reloadClients} openForm={view.newForm} onOpenClient={openClient} />
        )}
        {view.kind === "client" && (
          <ClientProfile trainerId={session.user.id} clientId={view.clientId} initialSub={view.sub} pinned={pinnedIds.includes(view.clientId)} onTogglePinned={() => togglePinned(view.clientId)} onBack={() => setView({ kind: "clients" })} onOpenPlan={(planId) => setView({ kind: "plan", planId, clientId: view.clientId })} />
        )}
        {view.kind === "trainerProfile" && (
          <TrainerProfile trainerId={session.user.id} email={session.user.email || ""} themeMode={themeMode} onThemeChange={setThemeMode} tabs={tabOrder.map((kind) => ({ kind, label: TAB_DEFS[kind].label, icon: TAB_DEFS[kind].icon, visible: !hiddenTabs.includes(kind) }))} onToggleTab={(kind) => toggleTabVisible(kind as TabKind)} onOpenPin={() => setShowPinSettings(true)} onOpenTrash={() => setShowTrash(true)} onOpenBackup={() => setShowBackup(true)} onSignOut={() => supabase.auth.signOut()} onSaved={(name, avatarUrl, accentColor) => { setTrainerName(name); setTrainerAvatar(avatarUrl); if (accentColor) setTrainerAccent(accentColor); }} />
        )}
        {view.kind === "plan" && (
          <div>
            <button onClick={() => setView(view.from === "plans" ? { kind: "plans" } : { kind: "client", clientId: view.clientId })} className="text-sm text-zinc-400 hover:text-zinc-100 mb-4 transition">{view.from === "plans" ? "← К планам" : "← К подопечному"}</button>
               <PlanEditor planId={view.planId} trainerId={session.user.id} clientId={view.clientId} />
          </div>
        )}
      </div>

      {/* B13: создание сущностей было спрятано внутри разделов — после перехода на плитки
          путь до формы стал трёхтаповым. FAB даёт его из любого основного экрана.
          Формы живут в детях на локальном состоянии, поэтому открываем их флагом во View —
          новых модалок не создаём, переиспользуем существующие. */}
      {(view.kind === "dashboard" || view.kind === "clients" || view.kind === "plans" || view.kind === "calendar") && (
        <>
          {showFab && <div className="fixed inset-0 z-40" onClick={() => setShowFab(false)} />}
          <div className="fixed right-4 z-50" style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
            {showFab && (
              <div className="absolute bottom-full right-0 mb-3 w-56 bg-zinc-900 border border-zinc-800 rounded-2xl p-1.5 shadow-xl">
                <button onClick={() => { setShowFab(false); setView({ kind: "clients", newForm: true }); }} className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl text-sm text-zinc-200 hover:bg-zinc-800 transition">
                  <Users size={16} className="text-lime-400 shrink-0" /> Новый подопечный
                </button>
                <button onClick={() => { setShowFab(false); setView({ kind: "plans", newPlan: true }); }} className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl text-sm text-zinc-200 hover:bg-zinc-800 transition">
                  <ClipboardList size={16} className="text-lime-400 shrink-0" /> Новый план
                </button>
                <button onClick={() => { setShowFab(false); setView({ kind: "calendar", newBooking: true }); }} className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl text-sm text-zinc-200 hover:bg-zinc-800 transition">
                  <CalendarDays size={16} className="text-lime-400 shrink-0" /> Новая запись
                </button>
              </div>
            )}
            <button
              onClick={() => setShowFab((v) => !v)}
              aria-expanded={showFab}
              aria-label={showFab ? "Закрыть меню создания" : "Создать"}
              className="w-14 h-14 rounded-full flex items-center justify-center text-zinc-950 shadow-lg transition active:scale-95"
              style={{ background: "var(--accent)" }}
            >
              {showFab ? <X size={24} /> : <Plus size={26} />}
            </button>
          </div>
        </>
      )}
    </div>
    </PinGate>
    </>
  );
}
