import { useEffect, useState } from "react";
import { LayoutDashboard, Users, CalendarDays, Database, Lock, Sparkles, Trash, ClipboardList, User, Settings } from "lucide-react";
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
import SubscriptionModal from "./components/SubscriptionModal";
import BackupModal from "./components/BackupModal";
import PinGate from "./components/PinGate";
import PinSettingsModal from "./components/PinSettingsModal";
import TrashModal from "./components/TrashModal";
import TrainerProfile from "./components/TrainerProfile";
import * as portalApi from "./lib/clientPortal";
import * as trainerApi from "./lib/trainer";
import type { SelfClient } from "./lib/clientPortal";
import type { Sub } from "./components/ClientProfile";

type View = { kind: "dashboard" } | { kind: "clients" } | { kind: "calendar" } | { kind: "plans" } | { kind: "client"; clientId: string; sub?: Sub } | { kind: "plan"; planId: string; clientId: string; from?: "plans" } | { kind: "trainerProfile" };
type TabKind = "dashboard" | "plans" | "clients" | "calendar" | "trainerProfile";
const TAB_DEFS: Record<TabKind, { label: string; icon: typeof Users }> = {
  dashboard: { label: "Дашборд", icon: LayoutDashboard },
  clients: { label: "Подопечные", icon: Users },
  plans: { label: "Планы", icon: ClipboardList },
  calendar: { label: "Календарь", icon: CalendarDays },
  trainerProfile: { label: "Профиль", icon: User },
};
const DEFAULT_TAB_ORDER: TabKind[] = ["dashboard", "clients", "plans", "calendar", "trainerProfile"];
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

// ponytail: навигация — простой стейт-стек без роутера, пока приложение состоит из 3 экранов
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: "dashboard" });
  const [selfClient, setSelfClient] = useState<SelfClient | null | undefined>(undefined);
  const [isTrainer, setIsTrainer] = useState<boolean | undefined>(undefined);
  const [showBackup, setShowBackup] = useState(false);
  const [showPinSettings, setShowPinSettings] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showSubscription, setShowSubscription] = useState(false);
  const [trainerName, setTrainerName] = useState("");
  const [trainerAvatar, setTrainerAvatar] = useState("");
  const [tabOrder, setTabOrder] = useState<TabKind[]>(loadTabOrder);
  const [hiddenTabs, setHiddenTabs] = useState<TabKind[]>(loadHiddenTabs);
  const [dragTab, setDragTab] = useState<TabKind | null>(null);
  const [showTabSettings, setShowTabSettings] = useState(false);
  const reorderTabs = (target: TabKind) => {
    if (!dragTab || dragTab === target) return;
    const next = tabOrder.filter((k) => k !== dragTab);
    next.splice(next.indexOf(target), 0, dragTab);
    setTabOrder(next);
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(next));
  };
  const toggleTabVisible = (kind: TabKind) => {
    const isHidden = hiddenTabs.includes(kind);
    if (!isHidden && hiddenTabs.length >= tabOrder.length - 1) return; // хотя бы одна вкладка должна остаться видимой
    const next = isHidden ? hiddenTabs.filter((k) => k !== kind) : [...hiddenTabs, kind];
    setHiddenTabs(next);
    localStorage.setItem(TAB_HIDDEN_KEY, JSON.stringify(next));
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
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
    const id = setInterval(() => { portalApi.fetchSelfClient(session.user.id).then(setSelfClient); }, 15000);
    return () => clearInterval(id);
  }, [session, isTrainer]);

  useEffect(() => {
    if (isTrainer && session) trainerApi.fetchTrainerSelf(session.user.id).then((s) => { setTrainerName(s.profile.name); setTrainerAvatar(s.profile.avatarUrl); });
  }, [isTrainer, session]);

  if (loading) return <div className="min-h-screen bg-zinc-950" />;
  if (!session) return <AuthScreen />;
  if (selfClient === undefined || isTrainer === undefined) return <div className="min-h-screen bg-zinc-950" />;

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
    <PinGate id={session.user.id}>
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-3 sm:px-4 py-4 sm:py-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setView({ kind: "trainerProfile" })} className="flex items-center gap-2 text-lime-400 font-semibold text-sm hover:text-lime-300 transition truncate max-w-[55%] sm:max-w-none">
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
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button onClick={() => setShowPinSettings(true)} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300" title="PIN-код на вход"><Lock size={14} /><span className="hidden sm:inline">PIN</span></button>
            <button onClick={() => setShowTrash(true)} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300" title="Корзина"><Trash size={14} /><span className="hidden sm:inline">Корзина</span></button>
            <button onClick={() => setShowBackup(true)} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300" title="Бэкап"><Database size={14} /><span className="hidden sm:inline">Бэкап</span></button>
            <button onClick={() => supabase.auth.signOut()} className="text-sm text-zinc-500 hover:text-zinc-300">Выйти</button>
          </div>
        </div>
        {showBackup && <BackupModal trainerId={session.user.id} onClose={() => setShowBackup(false)} />}
        {showPinSettings && <PinSettingsModal id={session.user.id} onClose={() => setShowPinSettings(false)} />}
        {showTrash && <TrashModal trainerId={session.user.id} onClose={() => setShowTrash(false)} />}
        {showSubscription && <SubscriptionModal onClose={() => setShowSubscription(false)} />}
        {(view.kind === "dashboard" || view.kind === "plans" || view.kind === "clients" || view.kind === "calendar" || view.kind === "trainerProfile") && (
          <div className="flex items-center gap-1.5">
            <div className="relative shrink-0">
              <button onClick={() => setShowTabSettings((v) => !v)} title="Настроить вкладки" className={`p-2 rounded-lg transition ${showTabSettings ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                <Settings size={16} />
              </button>
              {showTabSettings && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowTabSettings(false)} />
                  <div className="absolute left-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-800 rounded-xl p-2 w-56 space-y-0.5 shadow-xl">
                    <p className="text-xs text-zinc-500 px-2 pb-1">Видимые вкладки</p>
                    {tabOrder.map((kind) => {
                      const t = TAB_DEFS[kind];
                      const visible = !hiddenTabs.includes(kind);
                      return (
                        <label key={kind} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 cursor-pointer text-sm text-zinc-300">
                          <input type="checkbox" checked={visible} onChange={() => toggleTabVisible(kind)} className="accent-lime-400" />
                          <t.icon size={14} className="text-zinc-500" /> {t.label}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 overflow-x-auto">
              {tabOrder.filter((kind) => !hiddenTabs.includes(kind)).map((kind) => {
                const t = TAB_DEFS[kind];
                return (
                  <button
                    key={kind}
                    draggable
                    onDragStart={() => setDragTab(kind)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); reorderTabs(kind); setDragTab(null); }}
                    onDragEnd={() => setDragTab(null)}
                    onClick={() => setView({ kind })}
                    title="Зажмите и перетащите, чтобы изменить порядок"
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition shrink-0 cursor-grab ${view.kind === kind ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"} ${dragTab === kind ? "opacity-40" : ""}`}
                  >
                    <t.icon size={15} /> {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {view.kind === "dashboard" && (
          <Dashboard trainerId={session.user.id} onOpenClient={(clientId) => setView({ kind: "client", clientId })} />
        )}
        {view.kind === "calendar" && (
          <CalendarView trainerId={session.user.id} onOpenClient={(clientId) => setView({ kind: "client", clientId })} onOpenClientPlans={(clientId) => setView({ kind: "client", clientId, sub: "plans" })} />
        )}
        {view.kind === "plans" && (
          <PlansOverview trainerId={session.user.id} onOpenPlan={(planId, clientId) => setView({ kind: "plan", planId, clientId, from: "plans" })} />
        )}
        {view.kind === "clients" && (
          <ClientsList trainerId={session.user.id} onOpenClient={(clientId) => setView({ kind: "client", clientId })} />
        )}
        {view.kind === "client" && (
          <ClientProfile trainerId={session.user.id} clientId={view.clientId} initialSub={view.sub} onBack={() => setView({ kind: "clients" })} onOpenPlan={(planId) => setView({ kind: "plan", planId, clientId: view.clientId })} />
        )}
        {view.kind === "trainerProfile" && (
          <TrainerProfile trainerId={session.user.id} email={session.user.email || ""} onSaved={(name, avatarUrl) => { setTrainerName(name); setTrainerAvatar(avatarUrl); }} />
        )}
        {view.kind === "plan" && (
          <div>
            <button onClick={() => setView(view.from === "plans" ? { kind: "plans" } : { kind: "client", clientId: view.clientId })} className="text-sm text-zinc-400 hover:text-zinc-100 mb-4 transition">{view.from === "plans" ? "← К планам" : "← К подопечному"}</button>
            <PlanEditor planId={view.planId} trainerId={session.user.id} clientId={view.clientId} />
          </div>
        )}
      </div>
    </div>
    </PinGate>
  );
}
