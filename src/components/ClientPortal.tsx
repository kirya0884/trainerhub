import { useEffect, useState } from "react";
import { Apple, CalendarClock, CheckCircle2, CreditCard, Dumbbell, Flame, Home, Lock, LogOut, MessageSquare, Play, Ruler, Settings, TrendingUp, User } from "lucide-react";
import PinSettingsModal from "./PinSettingsModal";
import ClientSettingsModal from "./ClientSettingsModal";
import BodyTab from "./BodyTab";
import NutritionTab from "./NutritionTab";
import * as portalApi from "../lib/clientPortal";
import * as clientsApi from "../lib/clients";
import { combinedRemaining } from "../lib/clients";
import * as nutritionApi from "../lib/nutrition";
import type { PlanListItem, Payment, Measurement } from "../lib/clients";
import type { NutritionLog } from "../lib/nutrition";
import { usePlan } from "../hooks/usePlan";
import { useProgress } from "../hooks/useProgress";
import { MOOD_EMOJI, WELL_EMOJI } from "../constants";
import MetricsView from "./MetricsView";
import { fmtDate } from "../lib/format";
import { supabase } from "../lib/supabase";
import ClientSessionView from "./ClientSessionView";
import ChatThread from "./ChatThread";

type Tab = "overview" | "program" | "progress" | "body" | "nutrition" | "payment" | "profile" | "chat";
const TABS: { k: Tab; label: string; icon: typeof Home }[] = [
  { k: "program", label: "Программа", icon: Dumbbell },
  { k: "overview", label: "Обзор", icon: Home },
  { k: "progress", label: "Прогресс", icon: TrendingUp },
  { k: "body", label: "Замеры", icon: Ruler },
  { k: "nutrition", label: "Питание", icon: Apple },
  { k: "payment", label: "Оплата", icon: CreditCard },
  { k: "chat", label: "Чат", icon: MessageSquare },
  { k: "profile", label: "Профиль", icon: User },
];

export default function ClientPortal({ client }: { client: portalApi.SelfClient }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [brand, setBrand] = useState({ brand: "TrainerHub", logoUrl: "" });
  const [upcoming, setUpcoming] = useState<portalApi.UpcomingBooking | null>(null);
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<NutritionLog[]>([]);
  const [activeSession, setActiveSession] = useState(client.activeSession);
  const [profile, setProfile] = useState({ phone: client.phone, telegram: client.telegram, whatsapp: client.whatsapp, avatarUrl: client.avatarUrl, accentColor: client.accentColor });
  const [showPinSettings, setShowPinSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openDetails, setOpenDetails] = useState<string | null>(null);

  useEffect(() => {
    portalApi.fetchTrainerBrand(client.trainerId).then(setBrand);
    const refresh = () => {
      portalApi.fetchUpcomingBooking(client.id).then(setUpcoming);
      clientsApi.fetchClientPlans(client.id).then(setPlans);
      clientsApi.fetchPayments(client.id).then(setPayments);
      clientsApi.fetchMeasurements(client.id).then(setMeasurements);
      nutritionApi.fetchNutritionLogs(client.id).then(setNutritionLogs);
    };
    refresh();
    // ponytail: поллинг раз в 20с — план/оплаты/замеры/питание тоже должны подхватывать правки
    // тренера во время открытой сессии клиента, см. App.tsx (тот же паттерн для membership).
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [client.id]);

  const currentPlan = plans?.find((p) => !p.archived) || null;
  const planHook = usePlan(currentPlan?.id || "");
  const progressHook = useProgress(currentPlan?.id || "");

  const startDay = async (dayId: string, dayName: string) => {
    if (!currentPlan) return;
    await portalApi.startSession(client.id, currentPlan.id, dayId, dayName);
    setActiveSession({ planId: currentPlan.id, dayId, dayName, startedAt: Date.now() });
  };

  if (activeSession) {
    const day = planHook.plan?.days.find((d) => d.id === activeSession.dayId);
    if (!day) return <div className="text-zinc-500 text-sm p-4">Загрузка тренировки...</div>;
    return (
      <ClientSessionView
        day={day} startedAt={activeSession.startedAt}
        onCancel={async () => { await portalApi.cancelSession(client.id); setActiveSession(null); }}
        onFinish={async (metrics, session) => {
          await portalApi.logClientSession(activeSession.planId, metrics, session);
          await portalApi.finishClientSession(client.id);
          setActiveSession(null);
          progressHook.reload();
        }}
      />
    );
  }


  const m = client.membership;

  return (
    <div className="max-w-2xl mx-auto space-y-4" style={{ "--accent": profile.accentColor } as React.CSSProperties}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {brand.logoUrl && <img src={brand.logoUrl} alt="" className="w-7 h-7 rounded-lg object-cover" />}
          <p className="font-bold" style={{ color: "var(--accent)" }}>{brand.brand}</p>
        </div>
        <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300"><LogOut size={14} /> Выйти</button>
      </div>

      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition shrink-0 ${tab === t.k ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`} style={tab === t.k ? { background: "var(--accent)" } : undefined}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-lg font-bold">Привет, {client.name.split(" ")[0]}!</p>
            <p className="text-sm text-zinc-500 mt-0.5">Цель: {client.goal || "не указана"}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <h3 className="font-semibold text-sm flex items-center gap-1.5 mb-2"><CalendarClock size={15} style={{ color: "var(--accent)" }} /> Ближайшая тренировка</h3>
            {upcoming ? <p className="text-sm text-zinc-300">{fmtDate(upcoming.date)} в {upcoming.time}</p> : <p className="text-sm text-zinc-600">Записей не найдено</p>}
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <h3 className="font-semibold text-sm mb-2">Абонемент</h3>
            <p className="text-sm text-zinc-300">{m.type === "subscription" ? "Подписка" : "По тренировкам"}{m.remaining !== "" && m.remaining != null && ` · осталось ${combinedRemaining(m)}`}</p>
          </div>
        </div>
      )}

      {tab === "program" && (
        <div className="space-y-3">
          {!currentPlan && <p className="text-sm text-zinc-600 text-center py-8">Тренер пока не назначил программу</p>}
          {currentPlan && !planHook.plan && <p className="text-sm text-zinc-500">Загрузка...</p>}
          {planHook.plan?.days.map((day) => {
            const done = [...progressHook.sessions].sort((a, b) => (a.date < b.date ? 1 : -1)).find((s) => s.dayName === day.name);
            const showDetails = openDetails === day.id;
            return (
            <div key={day.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{day.name}</h3>
                {done ? (
                  <button onClick={() => setOpenDetails(showDetails ? null : day.id)} className="flex items-center gap-1.5 bg-lime-400/15 text-lime-400 font-semibold rounded-lg px-3 py-1.5 text-sm hover:bg-lime-400/25 transition shrink-0"><CheckCircle2 size={14} /> Пройдено</button>
                ) : (
                  <button onClick={() => startDay(day.id, day.name)} className="flex items-center gap-1.5 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm hover:opacity-90 transition shrink-0" style={{ background: "var(--accent)" }}><Play size={14} /> Начать</button>
                )}
              </div>
              {done && showDetails ? (
                <div className="bg-zinc-800/40 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-zinc-500">{fmtDate(done.date)} · {done.done}/{done.total} упр.{done.fromClient && " · самостоятельно"}</p>
                  <div className="flex gap-4 text-sm flex-wrap">
                    <span className="text-zinc-400">Самочувствие <span className="text-base">{done.wellbeing ? WELL_EMOJI[done.wellbeing - 1] : "—"}</span></span>
                    <span className="text-zinc-400">Настроение <span className="text-base">{done.mood ? MOOD_EMOJI[done.mood - 1] : "—"}</span></span>
                    {!!done.clientRating && <span className="text-zinc-400">Оценка <span className="text-lime-400 font-semibold">{done.clientRating}/5</span></span>}
                  </div>
                  {done.items?.some((i) => i.effort) && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
                      {done.items.filter((i) => i.effort).map((i, idx) => <span key={idx} className="flex items-center gap-1">{i.name}: {Array.from({ length: i.effort }).map((_, k) => <Flame key={k} size={11} className="text-orange-400 inline" />)}</span>)}
                    </div>
                  )}
                  {done.review && <div className="text-sm text-zinc-300 bg-zinc-900/60 rounded-lg p-2 flex gap-1.5"><MessageSquare size={14} className="text-lime-400 shrink-0 mt-0.5" /> {done.review}</div>}
                </div>
              ) : (
                <div className="space-y-1">
                  {day.exercises.map((ex) => (
                    <div key={ex.id} className="bg-zinc-800/40 rounded-lg px-2.5 py-1.5 text-sm">
                      <p className="font-medium">{ex.name || "—"}</p>
                      <p className="text-xs text-zinc-500">{ex.detailed && ex.setRows?.length ? ex.setRows.map((s, i) => `${i + 1}) ${s.weight || "—"}×${s.reps || "—"}`).join(", ") : `${ex.sets}×${ex.reps}${ex.weight ? ` · ${ex.weight}` : ""}`}{ex.rest && ` · отдых ${ex.rest}`}</p>
                      {ex.note && <p className="text-xs text-zinc-600 mt-0.5">{ex.note}</p>}
                    </div>
                  ))}
                  {day.exercises.length === 0 && <p className="text-xs text-zinc-700">Нет упражнений</p>}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {tab === "progress" && (
        <div className="space-y-4">
          {planHook.plan && <MetricsView days={planHook.plan.days} metrics={progressHook.metrics} addMetric={progressHook.addMetric} deleteMetric={progressHook.deleteMetric} />}
          <div>
            <p className="text-sm text-zinc-400 mb-2">История тренировок</p>
            {progressHook.sessions.length === 0 && <p className="text-xs text-zinc-700 text-center py-4">Пока нет записей</p>}
            <div className="space-y-2">
              {[...progressHook.sessions].sort((a, b) => (a.date < b.date ? 1 : -1)).map((s) => (
                <div key={s.id} className="bg-zinc-800/40 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2 mb-2"><p className="font-semibold text-sm truncate">{s.dayName}</p><p className="text-xs text-zinc-500">{fmtDate(s.date)} · {s.done}/{s.total} упр.{s.fromClient && " · самостоятельно"}</p></div>
                  <div className="flex gap-4 mb-2 text-sm flex-wrap"><span className="text-zinc-400">Самочувствие <span className="text-base">{s.wellbeing ? WELL_EMOJI[s.wellbeing - 1] : "—"}</span></span><span className="text-zinc-400">Настроение <span className="text-base">{s.mood ? MOOD_EMOJI[s.mood - 1] : "—"}</span></span>{!!s.clientRating && <span className="text-zinc-400">Оценка <span className="text-lime-400 font-semibold">{s.clientRating}/5</span></span>}</div>
                  {s.items?.some((i) => i.effort) && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400 mb-2">{s.items.filter((i) => i.effort).map((i, idx) => <span key={idx} className="flex items-center gap-1">{i.name}: {Array.from({ length: i.effort }).map((_, k) => <Flame key={k} size={11} className="text-orange-400 inline" />)}</span>)}</div>}
                  {s.review && <div className="text-sm text-zinc-300 bg-zinc-900/60 rounded-lg p-2 flex gap-1.5"><MessageSquare size={14} className="text-lime-400 shrink-0 mt-0.5" /> {s.review}</div>}
                </div>
              ))}
            </div>
          </div>
          {progressHook.progress.length > 0 && (
            <div>
              <p className="text-sm text-zinc-400 mb-2">Заметки тренера</p>
              <div className="space-y-1.5">
                {progressHook.progress.map((p) => (
                  <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm"><p className="text-xs text-zinc-500">{fmtDate(p.date)}</p><p>{p.text}</p></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "chat" && <ChatThread trainerId={client.trainerId} clientId={client.id} self="client" accent={profile.accentColor} />}

      {tab === "body" && <BodyTab clientId={client.id} measurements={measurements} setMeasurements={setMeasurements} />}

      {tab === "nutrition" && <NutritionTab clientId={client.id} logs={nutritionLogs} setLogs={setNutritionLogs} />}

      {tab === "payment" && (
        <div className="space-y-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-1 text-sm">
            <p className="text-zinc-300">Тип: {m.type === "subscription" ? "Подписка" : "По тренировкам"}</p>
            {m.remaining !== "" && m.remaining != null && <p className="text-zinc-300">Осталось тренировок: {combinedRemaining(m)}</p>}
            {m.pricePerSession && <p className="text-zinc-300">Цена занятия: {m.pricePerSession} ₽</p>}
            {m.nextPaymentDate && <p className="text-zinc-300">Следующая оплата: {fmtDate(m.nextPaymentDate)}</p>}
          </div>
          <div>
            <p className="text-sm text-zinc-400 mb-2">История платежей</p>
            {payments.length === 0 && <p className="text-xs text-zinc-700">Платежей пока нет</p>}
            <div className="space-y-1.5">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
                  <span className="text-zinc-400">{fmtDate(p.date)}</span>
                  <span className="font-semibold text-lime-400">{p.amount.toLocaleString("ru-RU")} ₽</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "profile" && (
        <div className="space-y-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border border-zinc-700" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 text-xl font-bold">{client.name[0]}</div>
              )}
              <p className="font-semibold">{client.name}</p>
            </div>
            <div className="space-y-2">
              <p className="block text-xs text-zinc-500">Телефон</p>
              <p className="text-zinc-200">{profile.phone || "—"}</p>
            </div>
            <div className="space-y-2">
              <p className="block text-xs text-zinc-500">Telegram</p>
              <p className="text-zinc-200">{profile.telegram || "—"}</p>
            </div>
            <div className="space-y-2">
              <p className="block text-xs text-zinc-500">WhatsApp</p>
              <p className="text-zinc-200">{profile.whatsapp || "—"}</p>
            </div>
            <button onClick={() => setShowSettings(true)} className="w-full flex items-center justify-center gap-1.5 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 transition" style={{ background: "var(--accent)" }}><Settings size={15} /> Настройки</button>
            <button onClick={() => setShowPinSettings(true)} className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg py-2.5 text-sm transition"><Lock size={14} /> PIN-код на вход</button>
          </div>
        </div>
      )}
      {showPinSettings && <PinSettingsModal id={client.id} table="clients" onClose={() => setShowPinSettings(false)} />}
      {showSettings && (
        <ClientSettingsModal
          clientId={client.id} initial={profile} onClose={() => setShowSettings(false)}
          onSaved={(p) => setProfile(p)}
        />
      )}
    </div>
  );
}
