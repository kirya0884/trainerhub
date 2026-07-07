import { useEffect, useState } from "react";
import { Activity, Apple, BarChart3, ChevronDown, ChevronRight, CheckCircle2, CreditCard, Dumbbell, Flame, Lock, LogOut, Menu, MessageCircle, MessageSquare, Phone, Play, Ruler, ScrollText, Settings, TrendingUp, User, X as XIcon } from "lucide-react";
import PinSettingsModal from "./PinSettingsModal";
import ClientSettingsModal from "./ClientSettingsModal";
import BodyTab from "./BodyTab";
import NutritionTab from "./NutritionTab";
import ActivityTab from "./ActivityTab";
import * as portalApi from "../lib/clientPortal";
import type { ClientActivity } from "../lib/clientPortal";
import * as clientsApi from "../lib/clients";
import { combinedRemaining } from "../lib/clients";
import * as nutritionApi from "../lib/nutrition";
import type { PlanListItem, Payment, Measurement } from "../lib/clients";
import type { NutritionLog } from "../lib/nutrition";
import { usePlan } from "../hooks/usePlan";
import { useProgress } from "../hooks/useProgress";
import { MOOD_EMOJI, WELL_EMOJI } from "../constants";
import MetricsView from "./MetricsView";
import { fmtDate, today as todayFn } from "../lib/format";
import { supabase } from "../lib/supabase";
import ClientSessionView from "./ClientSessionView";
import ChatThread from "./ChatThread";

type Tab = "profile" | "program" | "reporting" | "chat";
type ProgramSub = "active" | "completed" | "progress";
type ReportSub = "body" | "nutrition" | "activity";

const TAB_DEFS: Record<Tab, { label: string; icon: typeof User }> = {
  profile: { label: "Профиль", icon: User },
  program: { label: "Программа", icon: Dumbbell },
  reporting: { label: "Отчётность", icon: BarChart3 },
  chat: { label: "Чат", icon: MessageSquare },
};

const SUB_BTN = "px-3 py-1.5 rounded-lg text-sm font-medium transition shrink-0";

export default function ClientPortal({ client }: { client: portalApi.SelfClient }) {
  const [tab, setTab] = useState<Tab>("profile");
  const [programSub, setProgramSub] = useState<ProgramSub>("active");
  const [reportSub, setReportSub] = useState<ReportSub>("body");
  const [showNav, setShowNav] = useState(false);
  const [brand, setBrand] = useState({ brand: "TrainerHub", logoUrl: "", trainingRules: "" });
  const [upcoming, setUpcoming] = useState<portalApi.UpcomingBooking | null>(null);
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<NutritionLog[]>([]);
  const [activities, setActivities] = useState<ClientActivity[]>([]);
  const [activeSession, setActiveSession] = useState(client.activeSession);
  const [profile, setProfile] = useState({ phone: client.phone, telegram: client.telegram, whatsapp: client.whatsapp, avatarUrl: client.avatarUrl, accentColor: client.accentColor, name: client.name, goal: client.goal, health: client.health });
  const [showPinSettings, setShowPinSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const toggleDay = (id: string) => setExpandedDays((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  useEffect(() => {
    portalApi.fetchTrainerBrand(client.trainerId).then(setBrand);
    const refresh = () => {
      portalApi.fetchUpcomingBooking(client.id).then(setUpcoming);
      clientsApi.fetchClientPlans(client.id).then(setPlans);
      clientsApi.fetchPayments(client.id).then(setPayments);
      clientsApi.fetchMeasurements(client.id).then(setMeasurements);
      nutritionApi.fetchNutritionLogs(client.id).then(setNutritionLogs);
      portalApi.fetchClientActivities(client.id).then(setActivities);
    };
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [client.id]);

  const currentPlan = plans?.find((p) => !p.archived && p.visibleToClient !== false) || null;
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
        accent={profile.accentColor}
        day={day} startedAt={activeSession.startedAt}
        onCancel={async () => { await portalApi.cancelSession(client.id); setActiveSession(null); }}
        onFinish={async (metrics, session) => {
          await portalApi.logClientSession(activeSession.planId, metrics, session);
          await portalApi.finishClientSession(client.id);
          portalApi.markClientBookingDone(client.trainerId, client.id, activeSession.dayName, session.date); // fire-and-forget
          setActiveSession(null);
          progressHook.reload();
        }}
      />
    );
  }

  const m = client.membership;
  const sortedSessions = [...progressHook.sessions].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="max-w-2xl mx-auto space-y-4" style={{ "--accent": profile.accentColor } as React.CSSProperties}>
      {/* Drawer overlay */}
      {showNav && <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setShowNav(false)} />}
      {/* Nav drawer */}
      <div className={`fixed top-0 right-0 h-full z-50 w-56 bg-zinc-900 border-l border-zinc-800 flex flex-col transition-transform duration-200 ${showNav ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <p className="font-semibold text-sm" style={{ color: "var(--accent)" }}>{brand.brand}</p>
          <button onClick={() => setShowNav(false)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400"><XIcon size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {(Object.keys(TAB_DEFS) as Tab[]).map((k) => {
            const t = TAB_DEFS[k];
            return (
              <button key={k} onClick={() => { setTab(k); setShowNav(false); }} className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition ${tab === k ? "font-semibold" : "text-zinc-400 hover:text-zinc-100"}`} style={tab === k ? { color: "var(--accent)" } : undefined}>
                <t.icon size={16} className="shrink-0" /> {t.label}
                {tab === k && <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />}
              </button>
            );
          })}
        </div>
        <div className="border-t border-zinc-800 px-4 py-3 shrink-0">
          <button onClick={() => supabase.auth.signOut()} className="w-full flex items-center gap-2 text-sm text-zinc-500 hover:text-red-400 transition"><LogOut size={14} /> Выйти</button>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowNav(true)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition"><Menu size={20} /></button>
          {brand.logoUrl && <img src={brand.logoUrl} alt="" className="w-7 h-7 rounded-lg object-cover" />}
          <p className="font-bold" style={{ color: "var(--accent)" }}>{brand.brand}</p>
        </div>
        <p className="text-sm font-medium text-zinc-400">{TAB_DEFS[tab].label}</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto bg-zinc-900 border border-zinc-800 rounded-xl p-1">
        {(Object.keys(TAB_DEFS) as Tab[]).map((k) => {
          const t = TAB_DEFS[k];
          return (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition shrink-0 ${tab === k ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`} style={tab === k ? { background: "var(--accent)" } : undefined}>
              <t.icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ── ПРОФИЛЬ ── */}
      {tab === "profile" && (
        <div className="space-y-3">
          {/* Hero */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex items-center gap-4">
            {profile.avatarUrl
              ? <img src={profile.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border-2 shrink-0" style={{ borderColor: "var(--accent)" }} />
              : <div className="w-16 h-16 rounded-full shrink-0 flex items-center justify-center text-2xl font-bold border-2" style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "#18181b" }}>{(profile.name || client.name)[0]}</div>
            }
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-widest" style={{ color: "var(--accent)" }}>ПРИВЕТ 👋</p>
              <p className="text-xl font-bold text-zinc-50 mt-0.5 truncate">{(profile.name || client.name).split(" ")[0]}</p>
              {profile.goal && <p className="text-xs text-zinc-500 mt-0.5 truncate">{profile.goal}</p>}
            </div>
          </div>
          {/* Ближайшая + Абонемент */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 border-t-2" style={{ borderTopColor: "var(--accent)" }}>
              <p className="text-[10px] font-semibold tracking-widest text-zinc-500 mb-2">БЛИЖАЙШАЯ</p>
              {upcoming
                ? <div><p className="text-sm font-bold text-zinc-100">{fmtDate(upcoming.date)}</p><p className="text-xs text-zinc-400 mt-0.5">в {upcoming.time}</p></div>
                : <p className="text-sm text-zinc-600 mt-1">Нет записей</p>
              }
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 border-t-2 border-t-cyan-400">
              <p className="text-[10px] font-semibold tracking-widest text-zinc-500 mb-2">АБОНЕМЕНТ</p>
              <p className="text-sm font-bold text-zinc-100">{m.type === "subscription" ? "Подписка" : "Занятия"}</p>
              {m.remaining !== "" && m.remaining != null
                ? <p className="text-xs text-zinc-400 mt-0.5">осталось {combinedRemaining(m as clientsApi.Membership)}</p>
                : <p className="text-xs text-zinc-600 mt-0.5">активен</p>
              }
            </div>
          </div>
          {/* Платежи */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
            <p className="text-xs text-zinc-500 font-semibold tracking-widest flex items-center gap-1.5"><CreditCard size={13} /> ОПЛАТА</p>
            <div className="text-sm space-y-0.5">
              <p className="text-zinc-300">Тип: {m.type === "subscription" ? "Подписка" : "По тренировкам"}</p>
              {m.remaining !== "" && m.remaining != null && <p className="text-zinc-300">Осталось: {combinedRemaining(m as clientsApi.Membership)} тр.</p>}
              {m.pricePerSession && <p className="text-zinc-300">Цена занятия: {m.pricePerSession} ₽</p>}
              {m.nextPaymentDate && <p className="text-zinc-300">След. оплата: {fmtDate(m.nextPaymentDate)}</p>}
            </div>
            {payments.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-zinc-800">
                {payments.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">{fmtDate(p.date)}</span>
                    <span style={{ color: "var(--accent)" }} className="font-semibold">{p.amount.toLocaleString("ru-RU")} ₽</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Контакты + здоровье */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
            {(profile.phone || profile.telegram || profile.whatsapp) && (
              <div className="flex flex-wrap gap-2">
                {profile.phone && <a href={`tel:${profile.phone}`} className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 py-1.5 text-sm transition text-zinc-300"><Phone size={14} /> {profile.phone}</a>}
                {profile.telegram && <a href={profile.telegram.startsWith("http") ? profile.telegram : `https://t.me/${profile.telegram.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 rounded-lg px-3 py-1.5 text-sm transition"><MessageSquare size={14} /> {profile.telegram}</a>}
                {profile.whatsapp && <a href={`https://wa.me/${profile.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-green-500/15 text-green-300 hover:bg-green-500/25 rounded-lg px-3 py-1.5 text-sm transition"><MessageCircle size={14} /> WhatsApp</a>}
              </div>
            )}
            {(profile.health.injuries || profile.health.restrictions || profile.health.notes) && (
              <div className="bg-zinc-800/50 rounded-lg p-2.5 space-y-1 text-xs text-zinc-400">
                {profile.health.injuries && <p><span className="text-zinc-500">Травмы:</span> {profile.health.injuries}</p>}
                {profile.health.restrictions && <p><span className="text-zinc-500">Противопоказания:</span> {profile.health.restrictions}</p>}
                {profile.health.notes && <p><span className="text-zinc-500">Заметки:</span> {profile.health.notes}</p>}
              </div>
            )}
            {brand.trainingRules && (
              <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-zinc-500 flex items-center gap-1.5 font-medium"><ScrollText size={13} /> Правила тренировок</p>
                <p className="text-xs text-zinc-300 whitespace-pre-line">{brand.trainingRules}</p>
              </div>
            )}
            <button onClick={() => setShowSettings(true)} className="w-full flex items-center justify-center gap-1.5 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 transition" style={{ background: "var(--accent)" }}><Settings size={15} /> Редактировать профиль</button>
            <button onClick={() => setShowPinSettings(true)} className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg py-2.5 text-sm transition"><Lock size={14} /> PIN-код на вход</button>
            <button onClick={() => supabase.auth.signOut()} className="w-full flex items-center justify-center gap-1.5 text-sm text-zinc-500 hover:text-red-400 transition py-1"><LogOut size={14} /> Выйти</button>
          </div>
        </div>
      )}

      {/* ── ПРОГРАММА ── */}
      {tab === "program" && (
        <div className="space-y-3">
          {/* Program sub-tabs */}
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
            {(["active", "completed", "progress"] as ProgramSub[]).map((k) => {
              const labels: Record<ProgramSub, string> = { active: "Активные", completed: "Пройденные", progress: "Прогресс" };
              return (
                <button key={k} onClick={() => setProgramSub(k)} className={`${SUB_BTN} flex-1 ${programSub === k ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`} style={programSub === k ? { background: "var(--accent)" } : undefined}>
                  {labels[k]}
                </button>
              );
            })}
          </div>

          {/* Активные — current plan days */}
          {programSub === "active" && (
            <div className="space-y-3">
              {!currentPlan && <p className="text-sm text-zinc-600 text-center py-8">Тренер пока не назначил программу</p>}
              {currentPlan && !planHook.plan && <p className="text-sm text-zinc-500">Загрузка...</p>}
              {currentPlan && planHook.plan && (
                <p className="text-xs text-zinc-500 font-medium">{currentPlan.name}</p>
              )}
              {(() => {
                const todayDay = planHook.plan?.days.find((d) => d.dateOf === todayFn());
                return todayDay ? (
                  <div className="border rounded-xl p-3 flex items-center gap-3" style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold tracking-widest mb-0.5" style={{ color: "var(--accent)" }}>СЕГОДНЯ</p>
                      <p className="font-semibold text-zinc-100 truncate">{todayDay.name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{todayDay.exercises.length} упр.</p>
                    </div>
                    <button onClick={() => startDay(todayDay.id, todayDay.name)} className="flex items-center gap-1.5 text-zinc-950 font-semibold rounded-lg px-4 py-2 text-sm hover:opacity-90 transition shrink-0" style={{ background: "var(--accent)" }}>
                      <Play size={14} /> Начать
                    </button>
                  </div>
                ) : null;
              })()}
              {(() => {
                const visibleDays = (planHook.plan?.days ?? []).filter((d) => d.visibleToClient !== false);
                const mesocycles = planHook.plan?.mesocycles ?? [];
                const hasMesos = mesocycles.length > 0;
                // Group days: with meso first (sorted by meso position), then ungrouped
                const renderDay = (day: (typeof visibleDays)[0]) => {
                  const dayOpen = expandedDays.has(day.id);
                  return (
                    <div key={day.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <button onClick={() => toggleDay(day.id)} className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 shrink-0 transition">
                          {dayOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        <h3 className="font-semibold flex-1 min-w-0 truncate">{day.name}</h3>
                        {day.dateOf && <span className="text-xs text-zinc-500 shrink-0">{fmtDate(day.dateOf)}</span>}
                        <span className="text-xs text-zinc-600 shrink-0">{day.exercises.length} упр.</span>
                        <button onClick={() => startDay(day.id, day.name)} className="flex items-center gap-1.5 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm hover:opacity-90 transition shrink-0" style={{ background: "var(--accent)" }}><Play size={14} /> Начать</button>
                      </div>
                      {dayOpen && (
                        <div className="border-t border-zinc-800 p-3 space-y-1">
                          {day.exercises.map((ex) => (
                            <div key={ex.id} className="bg-zinc-800/40 rounded-lg px-3 py-2 text-sm">
                              <p className="font-medium">{ex.name || "—"}</p>
                              {ex.detailed && ex.setRows?.length ? (
                                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-zinc-400">
                                  {ex.setRows.map((sr, i) => (
                                    <span key={i}><span className="text-zinc-500">{i + 1})</span> <span className="text-zinc-100">{sr.weight || "—"}</span> × <span className="text-zinc-100">{sr.reps || "—"}</span></span>
                                  ))}
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-xs">
                                  {ex.sets && <span className="text-zinc-400"><span className="text-zinc-100">{ex.sets}</span> подх.</span>}
                                  {ex.reps && <span className="text-zinc-400">× <span className="text-zinc-100">{ex.reps}</span> повт.</span>}
                                  {ex.weight && <span className="text-zinc-400">· <span className="text-zinc-100">{ex.weight}</span></span>}
                                  {ex.rest && <span className="text-zinc-400">· отдых <span className="text-zinc-100">{ex.rest}</span></span>}
                                </div>
                              )}
                              {ex.note && <p className="text-xs text-zinc-600 mt-1">{ex.note}</p>}
                            </div>
                          ))}
                          {day.exercises.length === 0 && <p className="text-xs text-zinc-700">Нет упражнений</p>}
                        </div>
                      )}
                    </div>
                  );
                };
                if (!hasMesos) return <>{visibleDays.map(renderDay)}</>;
                // Render grouped by mesocycle
                const sorted = [...mesocycles].sort((a, b) => a.position - b.position);
                const ungrouped = visibleDays.filter((d) => !d.mesocycleId || !mesocycles.find((m) => m.id === d.mesocycleId));
                return (
                  <>
                    {sorted.map((meso) => {
                      const days = visibleDays.filter((d) => d.mesocycleId === meso.id);
                      if (days.length === 0) return null;
                      return (
                        <div key={meso.id} className="space-y-2">
                          <div className="flex items-center gap-2 px-1">
                            <div className="h-px flex-1 bg-cyan-400/20" />
                            <span className="text-xs font-semibold text-cyan-400/70 uppercase tracking-wider">{meso.name}</span>
                            <div className="h-px flex-1 bg-cyan-400/20" />
                          </div>
                          {days.map(renderDay)}
                        </div>
                      );
                    })}
                    {ungrouped.length > 0 && (
                      <div className="space-y-2">
                        {mesocycles.length > 0 && (
                          <div className="flex items-center gap-2 px-1">
                            <div className="h-px flex-1 bg-zinc-700/50" />
                            <span className="text-xs text-zinc-600 uppercase tracking-wider">Без блока</span>
                            <div className="h-px flex-1 bg-zinc-700/50" />
                          </div>
                        )}
                        {ungrouped.map(renderDay)}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* Пройденные — session history */}
          {programSub === "completed" && (
            <div className="space-y-2">
              {sortedSessions.length === 0 && <p className="text-sm text-zinc-600 text-center py-8">Пройденных тренировок пока нет</p>}
              {sortedSessions.map((s) => {
                const isOpen = openDetails === s.id;
                return (
                  <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <button onClick={() => setOpenDetails(isOpen ? null : s.id)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-zinc-800/40 transition text-left">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{s.dayName}</p>
                        <p className="text-xs text-zinc-500">{fmtDate(s.date)} · {s.done}/{s.total} упр.{s.fromClient && " · сам"}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {s.wellbeing ? <span className="text-base">{WELL_EMOJI[s.wellbeing - 1]}</span> : null}
                        {!!s.clientRating && <span style={{ color: "var(--accent)" }} className="text-xs font-semibold">{s.clientRating}/5</span>}
                        <CheckCircle2 size={15} style={{ color: "var(--accent)" }} />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t border-zinc-800 px-3 py-3 space-y-3 bg-zinc-800/20">
                        <div className="flex gap-4 text-sm flex-wrap">
                          {s.wellbeing ? <span className="text-zinc-400">Самочувствие <span className="text-base">{WELL_EMOJI[s.wellbeing - 1]}</span></span> : null}
                          {s.mood ? <span className="text-zinc-400">Настроение <span className="text-base">{MOOD_EMOJI[s.mood - 1]}</span></span> : null}
                          {!!s.clientRating && <span className="text-zinc-400">Оценка <span style={{ color: "var(--accent)" }} className="font-semibold">{s.clientRating}/5</span></span>}
                        </div>
                        {s.items && s.items.length > 0 && (
                          <div className="space-y-2">
                            {s.items.map((item, idx) => {
                              const hasActual = item.actualSets && item.actualSets.some((r) => r.weight || r.reps);
                              return (
                                <div key={idx} className="bg-zinc-900 rounded-lg px-3 py-2 text-xs space-y-1">
                                  <p className="font-medium text-sm text-zinc-200">{item.name}</p>
                                  {item.plannedSummary && (
                                    <p className="text-zinc-500">План: {item.plannedSummary}</p>
                                  )}
                                  {hasActual && (
                                    <p className="text-zinc-300">Факт: {item.actualSets!.map((r, i) => `${i + 1}) ${r.weight || "—"}×${r.reps || "—"}`).join(" · ")}</p>
                                  )}
                                  {item.effort > 0 && (
                                    <p className="text-zinc-500 flex items-center gap-1">
                                      Нагрузка: {Array.from({ length: item.effort }).map((_, k) => <Flame key={k} size={11} className="text-orange-400 inline" />)}
                                    </p>
                                  )}
                                  {item.note && <p className="text-zinc-500 italic">{item.note}</p>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {s.review && <div className="text-sm text-zinc-300 bg-zinc-900/60 rounded-lg p-2 flex gap-1.5"><MessageSquare size={14} style={{ color: "var(--accent)" }} className="shrink-0 mt-0.5" /> {s.review}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Прогресс */}
          {programSub === "progress" && (
            <div className="space-y-4">
              {planHook.plan && <MetricsView days={planHook.plan.days} metrics={progressHook.metrics} addMetric={progressHook.addMetric} deleteMetric={progressHook.deleteMetric} />}
              {progressHook.progress.length > 0 && (
                <div>
                  <p className="text-sm text-zinc-400 mb-2">Заметки тренера</p>
                  <div className="space-y-1.5">
                    {progressHook.progress.map((p) => (
                      <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
                        <p className="text-xs text-zinc-500">{fmtDate(p.date)}</p><p>{p.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!planHook.plan && <p className="text-sm text-zinc-600 text-center py-8">Нет активного плана</p>}
            </div>
          )}
        </div>
      )}

      {/* ── ОТЧЁТНОСТЬ ── */}
      {tab === "reporting" && (
        <div className="space-y-3">
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
            {(["body", "nutrition", "activity"] as ReportSub[]).map((k) => {
              const meta: Record<ReportSub, { label: string; icon: typeof Ruler }> = {
                body: { label: "Замеры", icon: Ruler },
                nutrition: { label: "Питание", icon: Apple },
                activity: { label: "Активность", icon: Activity },
              };
              const t = meta[k];
              return (
                <button key={k} onClick={() => setReportSub(k)} className={`${SUB_BTN} flex-1 flex items-center justify-center gap-1.5 ${reportSub === k ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`} style={reportSub === k ? { background: "var(--accent)" } : undefined}>
                  <t.icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>
          {reportSub === "body" && <BodyTab clientId={client.id} measurements={measurements} setMeasurements={setMeasurements} />}
          {reportSub === "nutrition" && <NutritionTab clientId={client.id} logs={nutritionLogs} setLogs={setNutritionLogs} />}
          {reportSub === "activity" && <ActivityTab clientId={client.id} activities={activities} setActivities={setActivities} accent={profile.accentColor} />}
        </div>
      )}

      {/* ── ЧАТ ── */}
      {tab === "chat" && <ChatThread trainerId={client.trainerId} clientId={client.id} self="client" accent={profile.accentColor} />}

      {showPinSettings && <PinSettingsModal id={client.id} table="clients" onClose={() => setShowPinSettings(false)} />}
      {showSettings && (
        <ClientSettingsModal clientId={client.id} initial={profile} onClose={() => setShowSettings(false)} onSaved={(p) => setProfile(p)} />
      )}
    </div>
  );
}
