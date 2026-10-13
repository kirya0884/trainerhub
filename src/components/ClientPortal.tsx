import { useEffect, useRef, useState } from "react";
import { Activity, Home, Check, Apple, CheckCircle2, Dumbbell, Flame, Layers, Lock, LogOut, MessageCircle, MessageSquare, Play, Ruler, Settings, TrendingUp, User } from "lucide-react";
import PinSettingsModal from "./PinSettingsModal";
import ModalShell from "./ModalShell";
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
import { GROUP_COLORS } from "../constants";
import { FeelingBadge } from "./FeelingScale";
import MetricsView from "./MetricsView";
import { addDays, fmtDate, today as todayFn } from "../lib/format";
import { supabase } from "../lib/supabase";
import { notifyLowBalance, notifyRenewalSoon, notifyUpcomingBooking, requestNotifyPermission } from "../lib/notify";
import ClientSessionView from "./ClientSessionView";
import { lastTimeFor } from "../lib/sessionUtils";
import { SkeletonRows } from "./Skeleton";

type Tab = "profile" | "program" | "reporting";
type ProgramSub = "active" | "completed";
type ReportSub = "exercises" | "body" | "nutrition" | "activity";

// Нижняя панель — как у тренера; «Профиль» стал «Главной», «Отчётность» — «Прогрессом»
const TAB_DEFS: Record<Tab, { label: string; icon: typeof User }> = {
  profile: { label: "Главная", icon: Home },
  program: { label: "Программа", icon: Dumbbell },
  reporting: { label: "Прогресс", icon: TrendingUp },
};

const SUB_BTN = "px-3 py-1.5 rounded-lg text-sm font-medium transition shrink-0";

export default function ClientPortal({ client }: { client: portalApi.SelfClient }) {
  const [tab, setTab] = useState<Tab>("profile");
  const [programSub, setProgramSub] = useState<ProgramSub>("active");
  const [reportSub, setReportSub] = useState<ReportSub>("exercises");
  const [showNav, setShowNav] = useState(false);
  const [brand, setBrand] = useState({ brand: "Reps", logoUrl: "", trainingRules: "" });
  const [upcoming, setUpcoming] = useState<portalApi.UpcomingBooking | null>(null);
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<NutritionLog[]>([]);
  const [activities, setActivities] = useState<ClientActivity[]>([]);
  // П9: у подопечного не было индикатора непрочитанных — он не узнавал, что тренер написал.
  const [activeSession, setActiveSession] = useState(client.activeSession);
  const [profile, setProfile] = useState({ phone: client.phone, telegram: client.telegram, whatsapp: client.whatsapp, avatarUrl: client.avatarUrl, accentColor: client.accentColor, name: client.name, goal: client.goal, health: client.health });
  const [showPinSettings, setShowPinSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionMinimized, setSessionMinimized] = useState(false);
  // Запись тренировки уже сохранена, а завершение сорвалось — повтор не пишет её второй раз
  const sessionLoggedRef = useRef(false);
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const toggleDay = (id: string) => setExpandedDays((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Высота нижней панели — плашка свёрнутой тренировки поднимается над ней
  useEffect(() => {
    document.documentElement.style.setProperty("--tabbar-h", "calc(4rem + env(safe-area-inset-bottom))");
    return () => { document.documentElement.style.removeProperty("--tabbar-h"); };
  }, []);

  const activeSessionRef = useRef<typeof activeSession>(null);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  useEffect(() => {
    portalApi.fetchTrainerBrand(client.trainerId).then(setBrand).catch((e) => console.error("[ClientPortal] fetchBrand:", e));
    // #6 merged notify check into first fetch; #8+#9 pause when hidden or active session
    const refresh = (notifyOnLoad = false) => {
      portalApi.fetchUpcomingBooking(client.id).then((ub) => {
        setUpcoming(ub);
        if (notifyOnLoad && ub) {
          const todayStr = todayFn();
          if (ub.date === todayStr && ub.time) {
            const [hh, mm] = ub.time.split(":").map(Number);
            const occMs = new Date(todayStr + "T00:00:00").getTime() + (hh * 60 + mm) * 60000;
            const diffMin = (occMs - Date.now()) / 60000;
            if (diffMin >= 110 && diffMin <= 130) notifyUpcomingBooking("client", client.id, todayStr, ub.time);
          }
        }
      }).catch((e) => console.error("[ClientPortal] fetchUpcoming:", e));
      clientsApi.fetchClientPlans(client.id).then(setPlans).catch((e) => console.error("[ClientPortal] fetchPlans:", e));
      clientsApi.fetchPayments(client.id).then(setPayments).catch((e) => console.error("[ClientPortal] fetchPayments:", e));
      clientsApi.fetchMeasurements(client.id).then(setMeasurements).catch((e) => console.error("[ClientPortal] fetchMeasurements:", e));
      nutritionApi.fetchNutritionLogs(client.id).then(setNutritionLogs).catch((e) => console.error("[ClientPortal] fetchNutrition:", e));
      portalApi.fetchClientActivities(client.id).then(setActivities).catch((e) => console.error("[ClientPortal] fetchActivities:", e));
    };
    refresh(true);
    const id = setInterval(() => {
      if (document.hidden || activeSessionRef.current) return;
      refresh();
    }, 20000);

    // Уведомления клиенту
    requestNotifyPermission();
    const m = client.membership as any;
    if (m?.type === "sessions" && m.remaining !== "" && m.remaining != null) {
      const rem = (Number(m.remaining) || 0) + (Number(m.extraRemaining) || 0);
      if (rem >= 1 && rem <= 2) notifyLowBalance(client.id, rem);
    }
    if (m?.type === "subscription" && m.nextPaymentDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const due = new Date(m.nextPaymentDate + "T00:00:00");
      const days = Math.round((due.getTime() - today.getTime()) / 86400000);
      if (days >= 0 && days <= 2) notifyRenewalSoon(client.id, days, m.nextPaymentDate);
    }

    return () => clearInterval(id);
  }, [client.id]);

  const currentPlan = plans?.find((p) => !p.archived && p.visibleToClient !== false) || null;
  const planHook = usePlan(currentPlan?.id || "");
  const progressHook = useProgress(currentPlan?.id || "");

  const startDay = async (dayId: string, dayName: string) => {
    if (!currentPlan) return;
    try {
      await portalApi.startSession(client.id, currentPlan.id, dayId, dayName);
      setActiveSession({ planId: currentPlan.id, dayId, dayName, startedAt: Date.now() });
    } catch (e) { console.error("[ClientPortal] startDay:", e); alert("Не удалось начать тренировку. Попробуй ещё раз."); }
  };

  // #6 activeDay derived here so portal always renders; CSV renders on top when not minimized
  const activeDay = activeSession ? (planHook.plan?.days.find((d) => d.id === activeSession.dayId) ?? null) : null;

  // Как у тренера: проведённый день остаётся в списке с датой и галочкой
  const lastDone = new Map<string, string>();
  for (const s of progressHook.sessions) if (!lastDone.has(s.dayName) || s.date > lastDone.get(s.dayName)!) lastDone.set(s.dayName, s.date);
  const mesoList = planHook.plan?.mesocycles ?? [];
  // Видимые дни: не скрыты тренером и не из скрытого или архивного блока
  const hiddenMeso = (id?: string | null) => { const x = id ? mesoList.find((mm) => mm.id === id) : undefined; return !!x && (x.visibleToClient === false || !!x.archivedAt); };
  const portalDays = (planHook.plan?.days ?? []).filter((d) => d.visibleToClient !== false && !hiddenMeso(d.mesocycleId));
  // Следующая тренировка на главной — первый ещё не пройденный день
  const nextDay = progressHook.loading ? null : portalDays.find((d) => !lastDone.has(d.name)) ?? null;
  const lastWeight = [...measurements].filter((x) => Number(String(x.weight).replace(",", ".")) > 0).sort((a, b) => (a.date < b.date ? -1 : 1)).pop();

  const m = client.membership;
  const sortedSessions = [...progressHook.sessions].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className={`max-w-2xl mx-auto space-y-4 ${activeSession && sessionMinimized ? "pb-40" : "pb-24"}`} style={{ "--accent": profile.accentColor } as React.CSSProperties}>
      {/* Аккаунт — по аватару на главной: настройки, PIN, выход */}
      {showNav && (
        <ModalShell title={profile.name || client.name} onClose={() => setShowNav(false)}>
          <div className="p-3 space-y-1">
            <button onClick={() => { setShowNav(false); setShowSettings(true); }} className="w-full flex items-center gap-3 px-3 h-12 rounded-xl hover:bg-zinc-800 transition text-left"><Settings size={18} className="text-zinc-400" /> <span className="font-medium">Мои данные и здоровье</span></button>
            <button onClick={() => { setShowNav(false); setShowPinSettings(true); }} className="w-full flex items-center gap-3 px-3 h-12 rounded-xl hover:bg-zinc-800 transition text-left"><Lock size={18} className="text-zinc-400" /> <span className="font-medium">PIN-код на вход</span></button>
            <button onClick={() => supabase.auth.signOut()} className="w-full flex items-center gap-3 px-3 h-12 rounded-xl hover:bg-zinc-800 transition text-left text-red-400"><LogOut size={18} /> <span className="font-medium">Выйти</span></button>
          </div>
        </ModalShell>
      )}

      {/* Нижняя панель — одна навигация, как у тренера */}
      <nav aria-label="Разделы" className="fixed inset-x-0 bottom-0 z-40 bg-zinc-950/85 backdrop-blur-xl border-t border-zinc-800" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="max-w-2xl mx-auto h-16 grid grid-cols-3">
          {(Object.keys(TAB_DEFS) as Tab[]).map((k) => {
            const t = TAB_DEFS[k];
            const on = tab === k;
            return (
              <button key={k} onClick={() => { setTab(k); window.scrollTo(0, 0); }} aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${on ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                <t.icon size={22} style={on ? { color: "var(--accent)" } : undefined} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── ГЛАВНАЯ ── */}
      {tab === "profile" && (
        <div className="space-y-3">
          {(brand.logoUrl || brand.brand) && (
            <div className="flex items-center gap-2 pt-1">
              {brand.logoUrl && <img src={brand.logoUrl} alt="" className="w-7 h-7 rounded-lg object-cover" />}
              <p className="font-bold text-sm" style={{ color: "var(--accent)" }}>{brand.brand}</p>
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-500">{(() => { const w = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }); return w.charAt(0).toUpperCase() + w.slice(1); })()}</p>
              <h1 className="text-2xl font-extrabold tracking-tight truncate">Привет, {(profile.name || client.name).split(" ")[0]}</h1>
            </div>
            <button onClick={() => setShowNav(true)} aria-label="Мои данные, PIN и выход" title="Аккаунт" className="shrink-0 rounded-full">
              {profile.avatarUrl
                ? <img src={profile.avatarUrl} alt="" className="w-14 h-14 rounded-full object-cover" />
                : <span className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-zinc-950" style={{ background: "var(--accent)" }}>{(profile.name || client.name)[0]}</span>}
            </button>
          </div>

          {/* Следующая тренировка — главный блок; кнопка сразу начинает следующий день */}
          <div className="relative overflow-hidden bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
            <div className="pointer-events-none absolute -right-16 -top-16 w-48 h-48 rounded-full blur-3xl" style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }} />
            <p className="text-sm text-zinc-400">Следующая тренировка</p>
            {upcoming ? (
              <div className="flex items-end gap-3 mt-2">
                <p className="text-5xl font-extrabold tracking-tight leading-none">{upcoming.time || "—"}</p>
                <p className="text-base font-semibold text-zinc-300 pb-0.5">{upcoming.date === todayFn() ? "Сегодня" : upcoming.date === addDays(todayFn(), 1) ? "Завтра" : fmtDate(upcoming.date)}</p>
              </div>
            ) : <p className="text-lg font-semibold text-zinc-300 mt-2">Пока нет записей</p>}
            {nextDay ? (
              <button onClick={() => startDay(nextDay.id, nextDay.name)} className="relative mt-4 w-full h-12 rounded-2xl text-zinc-950 font-bold flex items-center justify-center gap-2 hover:opacity-90 transition active:scale-[0.98] px-3" style={{ background: "var(--accent)" }}>
                <Play size={18} className="shrink-0" /> <span className="truncate">{nextDay.name}</span>
              </button>
            ) : (
              <button onClick={() => setTab("program")} className="relative mt-4 w-full h-12 rounded-2xl bg-zinc-800 font-semibold flex items-center justify-center gap-2 hover:bg-zinc-700 transition">
                <Dumbbell size={18} /> К программе
              </button>
            )}
          </div>

          {/* Остаток и вес — плитками */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <p className="text-sm text-zinc-400">{m.type === "subscription" ? "Подписка" : "Осталось"}</p>
              {m.type !== "subscription" && m.remaining !== "" && m.remaining != null ? (
                <p className={`text-[28px] font-extrabold tracking-tight mt-0.5 ${combinedRemaining(m as clientsApi.Membership) <= 2 ? "text-orange-400" : ""}`}>
                  {combinedRemaining(m as clientsApi.Membership)}{Number(m.remainingTotal || m.total) ? <span className="text-sm font-semibold text-zinc-500"> из {m.remainingTotal || m.total}</span> : null}
                </p>
              ) : <p className="text-base font-semibold mt-1.5">{m.nextPaymentDate ? `оплата ${fmtDate(m.nextPaymentDate, true)}` : "активна"}</p>}
            </div>
            <button onClick={() => { setTab("reporting"); setReportSub("body"); }} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-left hover:border-zinc-700 transition">
              <p className="text-sm text-zinc-400">Вес</p>
              {lastWeight
                ? <p className="text-[28px] font-extrabold tracking-tight mt-0.5">{String(lastWeight.weight).replace(".", ",")} <span className="text-sm font-semibold text-zinc-500">кг</span></p>
                : <p className="text-base font-semibold mt-1.5 text-zinc-500">добавить замер</p>}
            </button>
          </div>

          {brand.trainingRules && (
            <div>
              <h3 className="text-[17px] font-bold mt-2 mb-2 px-0.5">Правила тренера</h3>
              <p className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-300 whitespace-pre-line">{brand.trainingRules}</p>
            </div>
          )}

          {payments.length > 0 && (
            <div>
              <h3 className="text-[17px] font-bold mt-2 mb-2 px-0.5">Оплаты</h3>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800">
                {payments.slice(0, 3).map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 h-12 text-sm">
                    <span className="text-zinc-400">{fmtDate(p.date)}</span>
                    <span className="font-semibold">{p.amount.toLocaleString("ru-RU")} ₽</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ПРОГРАММА ── */}
      {tab === "program" && (
        <div className="space-y-3">
          <h2 className="text-2xl font-extrabold tracking-tight pt-1">Программа</h2>
          {/* Program sub-tabs */}
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
            {(["active", "completed"] as ProgramSub[]).map((k) => {
              const labels: Record<ProgramSub, string> = { active: "Тренировки", completed: "История" };
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
              {currentPlan && !planHook.plan && <SkeletonRows />}
              {currentPlan && planHook.plan && (
                <p className="text-xs text-zinc-500 font-medium">{currentPlan.name}</p>
              )}
              {(() => {
                const todayStr = todayFn();
                const mesocycles = planHook.plan?.mesocycles ?? [];
                // #5 Wait for sessions to load before computing doneEver — prevents flash of all days
                if (progressHook.loading) return null;
                const visibleDays = portalDays;
                const todayDay = visibleDays.find((d) => d.dateOf === todayStr && !lastDone.has(d.name)) ?? null;
                const hasMesos = mesocycles.filter((m) => m.visibleToClient !== false).length > 0;

                // Вспомогательные функции для групповых отображений
                const exLbl = (exs: typeof visibleDays[0]["exercises"], idx: number) => {
                  const ex = exs[idx];
                  if (!ex.group) return String(idx + 1);
                  let pos = 0;
                  for (let i = 0; i <= idx; i++) if (exs[i].group === ex.group) pos++;
                  return `${ex.group}${pos}`;
                };
                const groupBlks = (exs: typeof visibleDays[0]["exercises"]) => {
                  const blocks: { group: string | null; startIdx: number; items: typeof exs }[] = [];
                  exs.forEach((ex, idx) => {
                    const last = blocks[blocks.length - 1];
                    if (ex.group && last?.group === ex.group) last.items.push(ex);
                    else blocks.push({ group: ex.group || null, startIdx: idx, items: [ex] });
                  });
                  return blocks;
                };
                // Упражнение строкой, как в редакторе тренера: «5 × 5 · 80 кг»; разные подходы — списком
                const renderEx = (ex: typeof visibleDays[0]["exercises"][0], label: string) => {
                  const summary = [ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : ex.sets || ex.reps, ex.weight].filter(Boolean).join(" · ");
                  return (
                    <div key={ex.id} className="px-1.5 py-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 shrink-0 rounded-lg bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">{label}</span>
                        <span className="flex-1 min-w-0 font-semibold truncate">{ex.name || "—"}</span>
                        {!(ex.detailed && ex.setRows?.length) && summary && <span className="shrink-0 text-sm font-semibold text-zinc-400 whitespace-nowrap">{summary}</span>}
                      </div>
                      {ex.detailed && ex.setRows?.length ? (
                        <p className="text-[13px] text-zinc-400 pl-[2.375rem] mt-0.5">{ex.setRows.map((sr, i) => `${i + 1}) ${sr.weight || "—"} × ${sr.reps || "—"}`).join(" · ")}</p>
                      ) : null}
                      {(ex.rest || ex.note) && <p className="text-[13px] text-zinc-500 pl-[2.375rem] mt-0.5">{[ex.rest && `отдых ${ex.rest}`, ex.note].filter(Boolean).join(" · ")}</p>}
                    </div>
                  );
                };
                const renderDayExpanded = (day: typeof visibleDays[0]) => {
                  const blocks = groupBlks(day.exercises);
                  return (
                    <div className="border-t border-zinc-800 p-3 space-y-1.5">
                      {blocks.map((block, bi) => {
                        const color = block.group ? (GROUP_COLORS[block.group] ?? null) : null;
                        const rows = block.items.map((ex, k) => renderEx(ex, exLbl(day.exercises, block.startIdx + k)));
                        if (color && block.items.length > 1) {
                          return (
                            <div key={bi} className="rounded-xl border-2 overflow-hidden" style={{ borderColor: color }}>
                              <div className="px-2.5 py-1 text-xs font-bold" style={{ background: `${color}26`, color }}>
                                Суперсет {block.group} · {block.items.length} упр.
                              </div>
                              <div className="p-1.5 space-y-1">{rows}</div>
                            </div>
                          );
                        }
                        return <div key={bi} className="space-y-1">{rows}</div>;
                      })}
                      {day.exercises.length === 0 && <p className="text-xs text-zinc-700">Нет упражнений</p>}
                    </div>
                  );
                };
                // Карточка дня — как в редакторе у тренера: нажатие на название раскрывает
                // упражнения, справа ▶ «начать» или галочка у пройденного (повтор — с подтверждением)
                const renderDay = (day: typeof visibleDays[0]) => {
                  const dayOpen = expandedDays.has(day.id);
                  const done = lastDone.get(day.name);
                  const meta = [`${day.exercises.length} упр.`, day.dateOf ? fmtDate(day.dateOf, true) : null].filter(Boolean).join(" · ");
                  return (
                    <div key={day.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                      <div className="flex items-center gap-2 pl-4 pr-2 py-2">
                        <button onClick={() => toggleDay(day.id)} aria-expanded={dayOpen} className="flex-1 min-w-0 text-left py-1">
                          <span className="block font-bold truncate">{day.name}</span>
                          <span className="block text-[13px] text-zinc-400 truncate">{meta}{done && <span style={{ color: "var(--accent)" }}> · пройдена {fmtDate(done, true)}</span>}</span>
                        </button>
                        {done ? (
                          <button onClick={() => { if (window.confirm(`«${day.name}» уже пройдена ${fmtDate(done, true)}. Пройти ещё раз?`)) startDay(day.id, day.name); }}
                            title={`Пройдена ${fmtDate(done, true)} — пройти ещё раз`} aria-label={`Пройдена ${fmtDate(done, true)}. Пройти ещё раз`}
                            className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-zinc-950 hover:opacity-90 transition" style={{ background: "var(--accent)" }}>
                            <Check size={19} strokeWidth={2.75} />
                          </button>
                        ) : (
                          <button onClick={() => startDay(day.id, day.name)} aria-label={`Начать: ${day.name}`} title="Начать тренировку"
                            className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center hover:opacity-90 transition" style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 16%, transparent)" }}>
                            <Play size={18} />
                          </button>
                        )}
                      </div>
                      {dayOpen && renderDayExpanded(day)}
                    </div>
                  );
                };

                const sortedMesos = [...mesocycles].sort((a, b) => a.position - b.position).filter((m) => m.visibleToClient !== false && !m.archivedAt);

                return (
                  <>
                    {todayDay && (
                      <div className="border rounded-xl p-3 flex items-center gap-3" style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--accent)" }}>Сегодня</p>
                          <p className="font-semibold text-zinc-100 truncate">{todayDay.name}</p>
                          <p className="text-xs text-zinc-500 mt-0.5">{todayDay.exercises.length} упр.</p>
                        </div>
                        <button onClick={() => startDay(todayDay.id, todayDay.name)} className="flex items-center gap-1.5 text-zinc-950 font-bold rounded-xl px-4 h-11 text-sm hover:opacity-90 transition shrink-0" style={{ background: "var(--accent)" }}>
                          <Play size={16} /> Начать
                        </button>
                      </div>
                    )}
                    {!hasMesos ? (
                      visibleDays.map(renderDay)
                    ) : (
                      <>
                        {sortedMesos.map((meso) => {
                          const days = visibleDays.filter((d) => d.mesocycleId === meso.id);
                          if (days.length === 0) return null;
                          return (
                            <div key={meso.id} className="rounded-xl border border-cyan-400/20 overflow-hidden">
                              <div className="px-3 py-2 flex items-center gap-1.5 bg-cyan-400/5 border-b border-cyan-400/15">
                                <Layers size={12} className="text-cyan-400/70 shrink-0" />
                                <span className="text-sm font-semibold text-cyan-300">{meso.name}</span>
                              </div>
                              <div className="p-2 space-y-2">
                                {days.map(renderDay)}
                              </div>
                            </div>
                          );
                        })}
                        {visibleDays.filter((d) => !d.mesocycleId || !mesocycles.find((m) => m.id === d.mesocycleId)).map(renderDay)}
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* Пройденные — session history */}
          {programSub === "completed" && (
            <div className="space-y-2">
              {sortedSessions.length === 0 && <p className="text-sm text-zinc-600 text-center py-8">Проведённых тренировок пока нет</p>}
              {sortedSessions.map((s) => {
                const isOpen = openDetails === s.id;
                return (
                  <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <button onClick={() => setOpenDetails(isOpen ? null : s.id)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-zinc-800/40 transition text-left">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{s.dayName}</p>
                        <p className="text-xs text-zinc-500">{fmtDate(s.date, true)} · {s.done}/{s.total} упр.{s.fromClient && " · сам"}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {s.wellbeing ? <FeelingBadge kind="wellbeing" value={s.wellbeing} withLabel={false} /> : null}
                        {!!s.clientRating && <span style={{ color: "var(--accent)" }} className="text-xs font-semibold">{s.clientRating}/5</span>}
                        <CheckCircle2 size={15} style={{ color: "var(--accent)" }} />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t border-zinc-800 px-3 py-3 space-y-3 bg-zinc-800/20">
                        <div className="flex gap-4 text-sm flex-wrap">
                          {s.wellbeing ? <span className="text-zinc-400">Самочувствие <FeelingBadge kind="wellbeing" value={s.wellbeing} /></span> : null}
                          {s.mood ? <span className="text-zinc-400">Настроение <FeelingBadge kind="mood" value={s.mood} /></span> : null}
                          {!!s.clientRating && <span className="text-zinc-400">Оценка <span style={{ color: "var(--accent)" }} className="font-semibold">{s.clientRating}/5</span></span>}
                        </div>
                        {s.items && s.items.length > 0 && (
                          <div className="space-y-2">
                            {s.items.map((item, idx) => {
                              const hasActual = item.actualSets && item.actualSets.some((r) => r.weight || r.reps);
                              return (
                                <div key={idx} className="bg-zinc-900 rounded-xl px-3 py-2 text-xs space-y-1">
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

        </div>
      )}

      {/* ── ОТЧЁТНОСТЬ ── */}
      {tab === "reporting" && (
        <div className="space-y-3">
          <h2 className="text-2xl font-extrabold tracking-tight pt-1">Прогресс</h2>
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
            {(["exercises", "body", "nutrition", "activity"] as ReportSub[]).map((k) => {
              const meta: Record<ReportSub, { label: string; icon: typeof Ruler }> = {
                exercises: { label: "Веса", icon: TrendingUp },
                body: { label: "Замеры", icon: Ruler },
                nutrition: { label: "Питание", icon: Apple },
                activity: { label: "Активность", icon: Activity },
              };
              const t = meta[k];
              return (
                <button key={k} onClick={() => setReportSub(k)} className={`${SUB_BTN} flex-1 !px-1 flex items-center justify-center ${reportSub === k ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`} style={reportSub === k ? { background: "var(--accent)" } : undefined}>
                  {t.label}
                </button>
              );
            })}
          </div>
          {/* Упражнения: веса по тренировкам и заметки тренера (раньше — в «Программе») */}
          {reportSub === "exercises" && (
            <div className="space-y-4">
              {planHook.plan && <MetricsView days={planHook.plan.days} metrics={progressHook.metrics} addMetric={progressHook.addMetric} deleteMetric={progressHook.deleteMetric} />}
              {progressHook.progress.length > 0 && (
                <div>
                  <p className="text-sm text-zinc-400 mb-2">Заметки тренера</p>
                  <div className="space-y-1.5">
                    {progressHook.progress.map((p) => (
                      <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm">
                        <p className="text-xs text-zinc-500">{fmtDate(p.date)}</p><p>{p.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!planHook.plan && <p className="text-sm text-zinc-600 text-center py-8">Нет активного плана</p>}
            </div>
          )}
          {reportSub === "body" && <BodyTab clientId={client.id} measurements={measurements} setMeasurements={setMeasurements} />}
          {reportSub === "nutrition" && <NutritionTab clientId={client.id} logs={nutritionLogs} setLogs={setNutritionLogs} />}
          {reportSub === "activity" && <ActivityTab clientId={client.id} activities={activities} setActivities={setActivities} accent={profile.accentColor} />}
        </div>
      )}

      {/* #6 Session overlay — renders on top; minimized shows bottom bar only */}
      {activeSession && activeDay && (
        <ClientSessionView
          minimized={sessionMinimized}
          onMinimize={() => setSessionMinimized(true)}
          onExpand={() => setSessionMinimized(false)}
          accent={profile.accentColor}
          day={activeDay}
          lastTime={lastTimeFor(progressHook.sessions, activeDay)}
          startedAt={activeSession.startedAt}
          onProgress={(p) => portalApi.updateSessionProgress(client.id, p).catch((e) => console.error("[ClientPortal] прогресс тренировки не ушёл тренеру:", e))}
          onCancel={async () => { try { await portalApi.cancelSession(client.id); } catch (e) { console.error("[ClientPortal] cancelSession:", e); } finally { sessionLoggedRef.current = false; setActiveSession(null); setSessionMinimized(false); } }}
          onFinish={async (metrics, session) => {
            try {
              if (!sessionLoggedRef.current) {
                await portalApi.logClientSession(activeSession.planId, metrics, session);
                sessionLoggedRef.current = true;
              }
              await portalApi.finishClientSession(client.id);
              sessionLoggedRef.current = false;
              portalApi.markClientBookingDone(client.trainerId, client.id, activeSession.dayName, session.date);
              await progressHook.reload();
              setActiveSession(null);
              setSessionMinimized(false);
            } catch (e) {
              console.error("[ClientPortal] finish session:", e);
              alert("Не удалось сохранить тренировку. Проверь соединение и попробуй ещё раз.");
              throw e;
            }
          }}
        />
      )}
      {activeSession && !activeDay && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-700 px-4 py-3 text-sm text-zinc-400">
          Загрузка тренировки…
        </div>
      )}
      {showPinSettings && <PinSettingsModal id={client.id} table="clients" onClose={() => setShowPinSettings(false)} />}
      {showSettings && (
        <ClientSettingsModal clientId={client.id} initial={profile} onClose={() => setShowSettings(false)} onSaved={(p) => setProfile(p)} />
      )}
    </div>
  );
}
