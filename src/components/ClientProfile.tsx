import { ArrowLeft, Check, CloudOff, Settings2, Apple, MoreHorizontal, CalendarCheck, Camera, Clock, ClipboardList, HeartPulse, MessageCircle, MessageSquare, Pencil, Percent, Phone, Pin, Play, Plus, Printer, Ruler, Scissors, Send, SplitSquareVertical, Trash2, TrendingUp, Users, Wallet, Images, X, Target, Copy, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GOALS } from "../constants";
import * as api from "../lib/clients";
import { onWorkoutFinished } from "../lib/clientsBus";
import type { ClientFull, ClientNote, Measurement, Payment, PlanListItem, Photo } from "../lib/clients";
import * as paymentsApi from "../lib/payments";
import type { PackageTemplate, Promotion } from "../lib/payments";
import { fmtDate, today, addDays } from "../lib/format";
import { fileToThumb } from "../lib/thumb";
import { useDebouncedPersist } from "../hooks/useDebouncedPersist";
import NumField from "./NumField";
import DateField from "./DateField";
import PromotionsModal from "./PromotionsModal";
import ModalShell from "./ModalShell";
import ReceiptPrintView from "./ReceiptPrintView";
import ClientProgressPrintView from "./ClientProgressPrintView";
import BodyTab from "./BodyTab";
import NutritionDiary from "./NutritionDiary";
import * as nutritionApi from "../lib/nutrition";
import type { NutritionLog } from "../lib/nutrition";
import SessionHistoryModal from "./SessionHistoryModal";
import { BOOKING_STATUS_COLOR, BOOKING_STATUS_LABEL } from "./BookingModal";
import { expandBookings } from "../lib/bookings";
import { duplicatePlan } from "../lib/plans";
import PlanCreateModal from "./PlanCreateModal";
import type { PlanOverviewItem } from "../lib/clients";
import type { Booking } from "../lib/bookings";
import ActivityTab from "./ActivityTab";
import GoalsDashboard from "./GoalsDashboard";
import * as portalApi from "../lib/clientPortal";
import { cached, fmtSavedAt, onRevalidate, releaseStale, revalidate, staleAtOf } from "../lib/offlineCache";
import { isNetworkError } from "../lib/outbox";

// Отказ правки карточки из кэша — не чаще раза в 4 с (иначе сообщение на каждую букву)
let lockedToastAt = 0;
// Сообщение о несохранённой правке — тоже не чаще раза в 4 с
let saveErrToastAt = 0;
import type { ClientActivity } from "../lib/clientPortal";
import { ScreenSkeleton, SkeletonRows } from "./Skeleton";
import StartWorkoutModal from "./StartWorkoutModal";
import { ask, askInput, notify } from "../lib/dialog";
import { checkEmail } from "../lib/emailCheck";
import { track } from "../lib/events";

export type Sub = "overview" | "bookings" | "payments" | "reporting" | "plans";

// Порядок задан владельцем: обзор — отчёты — записи — планы. Оплаты открываются карточкой абонемента.
const TABS: { k: Sub; label: string; icon: typeof Users }[] = [
  { k: "overview", label: "Обзор", icon: Users },
  { k: "reporting", label: "Отчёты", icon: TrendingUp },
  { k: "bookings", label: "Записи", icon: CalendarCheck },
  { k: "plans", label: "Планы", icon: ClipboardList },
];
export default function ClientProfile({ trainerId, clientId, onBack, onOpenPlan, initialSub, pinned, onTogglePinned, onBookClient, bookings, allPlans, onOpenOccurrence }: { trainerId: string; clientId: string; onBack: () => void; onOpenPlan: (id: string) => void; initialSub?: Sub; pinned?: boolean; onTogglePinned?: () => void; onBookClient?: (clientId: string) => void; bookings?: Booking[]; allPlans?: PlanOverviewItem[]; onOpenOccurrence?: (id: string, occDate: string) => void }) {
  const [sub, setSub] = useState<Sub>(initialSub || "overview");
  const [showSubSettings, setShowSubSettings] = useState(false);
  // Имя — крупным заголовком; правка по тапу (у полей ввода на iOS шрифт не меньше 16 px — см. index.css)
  const [editingName, setEditingName] = useState(false);
  const [client, setClient] = useState<ClientFull | null>(null);
  // Карточка с телефона (нет сети) — время копии; тогда только просмотр: правки ушли бы в никуда
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<NutritionLog[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [showStart, setShowStart] = useState(false);
  const [activities, setActivities] = useState<ClientActivity[]>([]);
  const [showReport, setShowReport] = useState(false);
  // П19: правка не сохранилась и карточку не удалось перечитать — на экране не то, что в базе
  const [unsaved, setUnsaved] = useState(false);
  const persist = useDebouncedPersist();

  useEffect(() => {
    let alive = true;
    // Карточка и планы без сети — последние сохранённые, чтобы начать тренировку в зале
    // Без сети замеры, фото, заметки не грузятся — это ожидаемо: одно предупреждение, а не шквал ошибок
    let warned = false;
    const fail = (what: string) => (e: unknown) => {
      if (!isNetworkError(e)) { console.error(`[ClientProfile] ${what}:`, e); return; }
      if (!warned) { warned = true; console.warn("[ClientProfile] нет сети — часть карточки не загружена"); }
    };
    const loadClient = () => cached(`client:${clientId}`, () => api.fetchClient(clientId))
      .then((v) => { if (alive) { setClient(v); setCachedAt(staleAtOf(`client:${clientId}`)); } }).catch(fail("карточка"));
    const loadPlans = () => cached(`cplans:${clientId}`, () => api.fetchClientPlans(clientId)).then((v) => { if (alive) setPlans(v); }).catch(fail("планы"));
    loadClient();
    api.fetchMeasurements(clientId).then((v) => { if (alive) setMeasurements(v); }).catch(fail("замеры"));
    nutritionApi.fetchNutritionLogs(clientId).then((v) => { if (alive) setNutritionLogs(v); }).catch(fail("питание"));
    api.fetchPhotos(clientId).then((v) => { if (alive) setPhotos(v); }).catch(fail("фото"));
    api.fetchNotes(clientId).then((v) => { if (alive) setNotes(v); }).catch(fail("заметки"));
    loadPlans();
    portalApi.fetchClientActivities(clientId).then((v) => { if (alive) setActivities(v); }).catch(fail("активность"));
    // Завершённая тренировка списала занятие — подтягиваем только абонемент. Не onClientsChanged:
    // он приходит и от собственных сохранений карточки и перечитал бы абонемент посреди ввода
    const off = onWorkoutFinished(() => api.fetchClient(clientId).then((v) => { if (alive) setClient((c) => (c ? { ...c, membership: v.membership } : v)); }).catch((e) => console.error("[ClientProfile] обновление абонемента:", e)));
    // Перечитываем то, что пришло с телефона (карточка тогда только для просмотра — правок в ней нет)
    const offOnline = onRevalidate(() => {
      if (staleAtOf(`client:${clientId}`) !== null) loadClient();
      if (staleAtOf(`cplans:${clientId}`) !== null) loadPlans();
    });
    return () => { alive = false; off(); offOnline(); releaseStale(`client:${clientId}`); releaseStale(`cplans:${clientId}`); };
  }, [clientId]);

  if (!client) return <div className="p-4"><ScreenSkeleton avatar /></div>;
  const activePlans = (plans ?? []).filter((p) => !p.archived);

  const locked = () => {
    if (cachedAt === null) return false;
    if (Date.now() - lockedToastAt > 4000) { lockedToastAt = Date.now(); notify("Нет сети: карточка открыта с телефона, только для просмотра. Править можно, когда появится интернет."); }
    return true;
  };
  // П19: запись не прошла — раньше на экране оставалось новое, в базе старое, без сообщения.
  // Теперь: сообщение и карточка перечитывается из базы (экран = база); не перечиталась
  // (нет сети) — плашка «не сохранено» с кнопкой «Обновить».
  const reloadClient = () => api.fetchClient(clientId).then((v) => { setClient(v); setUnsaved(false); }).catch((e) => { console.error("[ClientProfile] перечитать карточку:", e); setUnsaved(true); });
  const saveFailed = (e: unknown) => {
    console.error("[ClientProfile] сохранение карточки:", e);
    if (Date.now() - saveErrToastAt > 4000) {
      saveErrToastAt = Date.now();
      notify(isNetworkError(e) ? "Нет связи с сервером — изменение карточки не сохранилось." : "Не удалось сохранить изменение карточки. Показываю сохранённые данные.");
    }
    // Недосохранённый ввод отбрасываем, иначе он записался бы поверх перечитанной карточки
    persist.cancel("client"); persist.cancel("health"); persist.cancel("membership");
    reloadClient();
  };
  const save = (write: () => Promise<unknown>) => { write().catch(saveFailed); };
  // Текстовые поля — debounce per-field, чтобы не слать запрос на каждую букву. Чекбоксы/селекты — сразу.
  const patch = (p: Partial<ClientFull>, immediate = false) => {
    if (locked()) return;
    setClient((c) => (c ? { ...c, ...p } : c));
    if (immediate) save(() => api.updateClient(clientId, p));
    else persist("client", p, (pp) => save(() => api.updateClient(clientId, pp)));
  };
  const patchHealth = (p: Partial<ClientFull["health"]>) => {
    if (locked()) return;
    const merged = { ...client.health, ...p };
    setClient({ ...client, health: merged });
    persist("health", { health: merged }, (pp) => save(() => api.updateClient(clientId, pp)));
  };
  // П18: абонемент больше не пишется целиком из экрана (затирал списание клиентом/календарём) —
  // на сервер уходят только изменённые настройки, сервер сливает их с тем, что в базе.
  // immediate — отправить сразу вместе с накопленным вводом (cancel потерял бы его).
  const patchMembership = (p: paymentsApi.MembershipSettings, immediate = false) => {
    if (locked()) return;
    setClient((c) => (c ? { ...c, membership: { ...c.membership, ...p } } : c));
    persist("membership", p, (pp) => save(() => paymentsApi.patchMembership(clientId, pp)));
    if (immediate) persist.flush("membership");
  };
  // Абонемент, который вернул сервер после оплаты/удаления/сплита, — только на экран
  const setMembership = (m: ClientFull["membership"]) => setClient((c) => (c ? { ...c, membership: m } : c));

  const tgLink = client.telegram ? (client.telegram.startsWith("http") ? client.telegram : `https://t.me/${client.telegram.replace(/^@/, "")}`) : "";
  const waLink = client.whatsapp ? `https://wa.me/${client.whatsapp.replace(/\D/g, "")}` : "";
  const remainingNum = api.combinedRemaining(client.membership);
  const lowStock = client.membership.type !== "subscription" && client.membership.remaining !== "" && remainingNum > 0 && remainingNum <= 2;
  const outOfStock = client.membership.type !== "subscription" && client.membership.remaining !== "" && remainingNum <= 0;
  const overdue = client.membership.type === "subscription" && client.membership.nextPaymentDate && client.membership.nextPaymentDate < today();
  const deleteClient = async () => {
    if (locked()) return;
    if (!(await ask(`Удалить «${client.name}»? Карточка переместится в корзину — её можно восстановить позже.`, { danger: true, ok: "Удалить" }))) return;
    try { await api.deleteClient(clientId); onBack(); }
    catch (e) { console.error("[ClientProfile] deleteClient:", e); notify("Не удалось удалить карточку. Попробуй ещё раз."); }
  };

  // Абонемент под именем: остаток кольцом, нажатие — вкладка оплат
  const isSessions = client.membership.type !== "subscription";
  const remTotal = Number(client.membership.remainingTotal) || Number(client.membership.total) || 0;
  const hasRemaining = isSessions && client.membership.remaining !== "";
  const ringPct = hasRemaining && remTotal > 0 ? Math.max(0, Math.min(1, remainingNum / remTotal)) : 0;
  const ringColor = outOfStock ? "text-red-400" : lowStock ? "text-orange-400" : "text-lime-400";

  return (
    <div>
      {cachedAt !== null && (
        <div role="status" className="mb-3 flex items-start gap-2 bg-zinc-900 border border-zinc-800 rounded-2xl px-3 py-2.5 text-sm text-zinc-300">
          <CloudOff size={16} className="text-zinc-400 shrink-0 mt-0.5" />
          <span className="flex-1">Нет сети — карточка с телефона на {fmtSavedAt(cachedAt)}. Только просмотр; тренировку начать можно.</span>
          <button onClick={revalidate} className="shrink-0 text-lime-400 font-semibold hover:text-lime-300 transition">Обновить</button>
        </div>
      )}
      {unsaved && (
        <div role="alert" className="mb-3 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-2xl px-3 py-2.5 text-sm text-red-200">
          <CloudOff size={16} className="text-red-300 shrink-0 mt-0.5" />
          <span className="flex-1">Последнее изменение карточки не сохранилось — на экране может быть не то, что в базе.</span>
          <button onClick={reloadClient} className="shrink-0 text-lime-400 font-semibold hover:text-lime-300 transition">Обновить</button>
        </div>
      )}
      {showReport && <ClientProgressPrintView clientId={clientId} planIds={(plans ?? []).map((p) => p.id)} clientName={client.name} trainerId={trainerId} onClose={() => setShowReport(false)} />}

      {/* Шапка: назад, закрепить, меню действий (отчёт, удаление) */}
      <div className="flex items-center justify-between -mx-2 -mt-1">
        <button onClick={onBack} aria-label="К подопечным" title="К подопечным" className="w-11 h-11 flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"><ArrowLeft size={22} /></button>
        <div className="flex items-center">
          {onTogglePinned && (
            <button onClick={onTogglePinned} aria-label={pinned ? "Открепить" : "Закрепить"} title={pinned ? "Открепить" : "Закрепить"} aria-pressed={!!pinned}
              className={`w-11 h-11 flex items-center justify-center rounded-xl transition hover:bg-zinc-900 ${pinned ? "text-lime-400" : "text-zinc-400 hover:text-zinc-100"}`}><Pin size={20} /></button>
          )}
          {/* B30: действия над карточкой. Список раскрывается влево (right-0), иначе вылез бы за экран */}
          <div className="relative">
            <button onClick={() => setShowSubSettings((v) => !v)} title="Действия" aria-label="Действия" aria-expanded={showSubSettings}
              className={`w-11 h-11 flex items-center justify-center rounded-xl transition ${showSubSettings ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"}`}>
              <MoreHorizontal size={22} />
            </button>
            {showSubSettings && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSubSettings(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 w-56 shadow-xl">
                  <button onClick={() => { setShowSubSettings(false); setShowReport(true); }} className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-sm text-zinc-300 hover:bg-zinc-800 transition">
                    <Printer size={15} className="text-zinc-500 shrink-0" /> Отчёт по прогрессу
                  </button>
                  <div className="my-1 border-t border-zinc-800" />
                  <button onClick={() => { setShowSubSettings(false); deleteClient(); }} className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition">
                    <Trash2 size={15} className="shrink-0" /> Удалить подопечного
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Аватар, имя (редактируется на месте) и цель — по центру */}
      <div className="flex flex-col items-center text-center pt-1">
        {/* Фото подопечного ставит тренер: нажатие на аватар → выбор снимка (сжимается до превью) */}
        <label className="relative cursor-pointer group" title="Сменить фото">
          {client.avatarUrl
            ? <img src={client.avatarUrl} alt="" className="w-20 h-20 rounded-full object-cover" />
            : <div className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold text-zinc-950" style={{ background: client.color }}>{client.name.charAt(0).toUpperCase()}</div>}
          <span className="absolute -bottom-0.5 -right-0.5 w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-950 flex items-center justify-center text-zinc-200 group-hover:bg-zinc-700 transition"><Camera size={15} /></span>
          <input type="file" accept="image/*" aria-label="Сменить фото подопечного" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            try { patch({ avatarUrl: await fileToThumb(f, 320) }, true); }
            catch (err) { console.error("[ClientProfile] фото:", err); notify("Не удалось загрузить фото."); }
          }} />
        </label>
        {editingName ? (
          <input autoFocus value={client.name} onChange={(e) => patch({ name: e.target.value })} onBlur={() => setEditingName(false)} onKeyDown={(e) => e.key === "Enter" && setEditingName(false)} aria-label="Имя подопечного"
            className="mt-3 w-full max-w-xs h-11 bg-zinc-900 border border-zinc-700 rounded-xl text-center font-bold outline-none focus:border-lime-400/60 px-3" />
        ) : (
          <button onClick={() => setEditingName(true)} title="Изменить имя" className="mt-3 group flex items-center gap-1.5 max-w-full px-2 rounded-lg">
            <span className="text-2xl font-extrabold tracking-tight truncate">{client.name}</span>
            <Pencil size={14} className="shrink-0 text-zinc-600 group-hover:text-zinc-400" />
          </button>
        )}
        <select value={client.goal} onChange={(e) => patch({ goal: e.target.value }, true)} aria-label="Цель"
          className="mt-0.5 bg-transparent text-sm text-zinc-400 outline-none cursor-pointer text-center">
          {GOALS.map((g) => <option key={g} className="bg-zinc-900">{g}</option>)}
        </select>
      </div>

      {/* Абонемент под именем: остаток тренировок; нажатие — оплаты */}
      <button onClick={() => setSub("payments")} aria-current={sub === "payments" ? "page" : undefined} className={`mt-4 w-full flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-left hover:border-zinc-700 transition ${sub === "payments" ? "border-lime-400/50" : ""}`}>
        {hasRemaining ? (
          <span className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90" aria-hidden="true">
              <circle cx="32" cy="32" r="27" fill="none" strokeWidth="7" className="stroke-current text-zinc-800" />
              <circle cx="32" cy="32" r="27" fill="none" strokeWidth="7" strokeLinecap="round" className={`stroke-current ${ringColor}`}
                strokeDasharray={`${ringPct * 169.6} 169.6`} />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-lg font-extrabold ${outOfStock ? "text-red-400" : ""}`}>{remainingNum}</span>
          </span>
        ) : (
          <span className="w-16 h-16 shrink-0 rounded-full bg-zinc-800 flex items-center justify-center"><Wallet size={24} className="text-zinc-400" /></span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-bold">
            {hasRemaining
              ? outOfStock ? (remainingNum < 0 ? `Долг: ${-remainingNum} тр.` : "Тренировки закончились") : `Осталось ${remainingNum}${remTotal ? ` из ${remTotal}` : ""}`
              : !isSessions ? "Подписка" : "Абонемент не оформлен"}
          </span>
          <span className={`block text-sm truncate ${overdue ? "text-red-400" : "text-zinc-500"}`}>
            {!isSessions
              ? client.membership.nextPaymentDate ? `${overdue ? "Просрочена с" : "Следующая оплата"} ${fmtDate(client.membership.nextPaymentDate)}` : "Дата оплаты не указана"
              : client.membership.packagePrice ? `Пакет за ${Number(client.membership.packagePrice).toLocaleString("ru-RU")} ₽` : "Нажмите, чтобы оформить"}
          </span>
        </span>
        <span className={`shrink-0 h-9 px-3 rounded-xl text-sm font-semibold flex items-center ${outOfStock || lowStock || overdue ? "bg-orange-400/15 text-orange-300" : "bg-zinc-800 text-zinc-300"}`}>
          {outOfStock || lowStock || overdue ? "Продлить" : "Оплаты"}
        </span>
      </button>

      {/* Начать тренировку по одному из действующих планов — без захода в редактор плана */}
      {activePlans.length > 0 && (
        <button onClick={() => setShowStart(true)}
          className="mt-3 w-full h-12 rounded-2xl bg-lime-400 text-zinc-950 font-bold flex items-center justify-center gap-2 hover:bg-lime-300 transition active:scale-[0.98]">
          <Play size={18} /> Начать тренировку
        </button>
      )}
      {showStart && <StartWorkoutModal trainerId={trainerId} self={{ id: clientId, name: client.name, color: client.color, remaining: api.remainingOf(client.membership) }}
        partner={client.membership.split && client.membership.partnerClientId ? { id: client.membership.partnerClientId, name: client.membership.partnerName || "партнёр" } : null}
        plans={activePlans} onClose={() => setShowStart(false)} />}

      {!!client.activeSession && (
        <div className="w-full flex items-center gap-2 rounded-xl px-3.5 py-2.5 mt-4 text-sm bg-cyan-400/10 text-cyan-300 border border-cyan-400/20">
          <Play size={14} className="shrink-0 text-cyan-400" />
          <span className="flex-1 font-medium">Сейчас тренируется: <span className="text-cyan-100">{client.activeSession.dayName}</span></span>
          <span className="text-xs text-cyan-500">{(() => { const s = Math.floor((Date.now() - client.activeSession.startedAt) / 1000); const m = Math.floor(s / 60); return m > 0 ? `${m} мин` : "только начал"; })()}</span>
        </div>
      )}

      {/* Разделы карточки — четыре плитки в ряд, порядок фиксирован */}
      <div className="grid grid-cols-4 gap-1.5 mt-4 mb-4 p-1.5 bg-zinc-900 border border-zinc-800 rounded-2xl">
        {TABS.map((t) => {
          const active = sub === t.k;
          return (
            <button key={t.k} onClick={() => setSub(t.k)} aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 h-14 rounded-xl text-[13px] font-semibold transition ${active ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"}`}>
              <t.icon size={18} className="shrink-0" />
              <span className="truncate max-w-full px-0.5">{t.label}</span>
            </button>
          );
        })}
      </div>

      {sub === "bookings" && <BookingsTab clientId={clientId} bookings={bookings ?? []} onOpenOccurrence={onOpenOccurrence} onBook={onBookClient ? () => onBookClient(clientId) : undefined} />}
      {sub === "payments" && <MembershipTab client={client} patchMembership={patchMembership} setMembership={setMembership} clientId={clientId} trainerId={trainerId} />}
      {sub === "overview" && <OverviewTab client={client} patch={patch} patchHealth={patchHealth} notes={notes} clientId={clientId} setNotes={setNotes} tgLink={tgLink} waLink={waLink} trainerId={trainerId} />}
      {sub === "reporting" && <ReportingTab clientId={clientId} measurements={measurements} setMeasurements={setMeasurements} nutritionLogs={nutritionLogs} photos={photos} setPhotos={setPhotos} activities={activities} setActivities={setActivities} />}
      {sub === "plans" && <PlansTab trainerId={trainerId} clientId={clientId} clientName={client.name} allPlans={allPlans ?? []} plans={plans} setPlans={setPlans} onOpenPlan={onOpenPlan} />}
    </div>
  );
}

function InviteBlock({ clientId, email, hasAccount, onFixEmail }: { clientId: string; email: string; hasAccount: boolean; onFixEmail: (email: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [created, setCreated] = useState(false);
  const check = checkEmail(email);
  const issued = hasAccount || created;

  // Письмо не дошло — пароль пришёл в ответе один раз: показываем его тренеру, чтобы передал сам.
  const showCreds = async (res: api.InviteResult, resend: boolean) => {
    const creds = `Логин: ${res.email}\nПароль: ${res.password}\nВход: ${window.location.origin} → «Я клиент»`;
    const copy = await ask(`${resend ? "Пароль обновлён" : "Аккаунт создан"}, но письмо не дошло.\nПричина: ${res.warning}\n\n${creds}\n\nПароль показан один раз — скопируйте и передайте клиенту сами (например, в мессенджере).`, { ok: "Скопировать", cancel: "Закрыть" });
    if (!copy) return;
    try { await navigator.clipboard.writeText(creds); notify("Логин и пароль скопированы"); }
    catch { await askInput("Скопируйте вручную", [{ key: "creds", label: "Логин и пароль", value: creds }], { ok: "Готово" }); }
  };

  const invite = async (resend: boolean) => {
    if (resend && !(await ask("Выслать доступ заново? Будет создан новый пароль, старый перестанет работать. Сработает, только если клиент ещё ни разу не входил.", { ok: "Выслать" }))) return;
    setBusy(true); setMsg("");
    try {
      // Почта в поле сохраняется с задержкой — записываем сразу, функция читает адрес из базы.
      await api.updateClient(clientId, { email });
      const res = await api.inviteClient(clientId, resend);
      setCreated(true);
      if (res.emailFailed && res.password) {
        setMsg(`Письмо не дошло: ${res.warning}`);
        await showCreds(res, resend);
      } else setMsg(`Логин и пароль отправлены на ${email}. Если письма нет — пусть клиент проверит «Спам».`);
    } catch (e: any) {
      setMsg(e.message || "Не удалось отправить доступ");
    } finally { setBusy(false); }
  };

  const btn = "flex items-center gap-1.5 font-semibold rounded-lg px-3 py-1.5 text-sm transition disabled:opacity-40";
  return (
    <div className="space-y-1">
      {check.error && (
        <p className="text-[11px] text-amber-400">
          {check.error}
          {check.suggestion && <> Возможно, <button type="button" onClick={() => onFixEmail(check.suggestion!)} className="underline font-semibold">{check.suggestion}</button>?</>}
        </p>
      )}
      {!issued ? (
        <button onClick={() => invite(false)} disabled={!email || !!check.error || busy} className={`${btn} bg-lime-400 text-zinc-950 hover:bg-cyan-300`}>
          <Send size={14} /> {busy ? "Отправка..." : "Отправить доступ клиенту"}
        </button>
      ) : (
        <button onClick={() => invite(true)} disabled={!email || !!check.error || busy} className={`${btn} bg-zinc-800 text-zinc-100 hover:bg-zinc-700`}>
          <Send size={14} /> {busy ? "Отправка..." : "Выслать доступ заново"}
        </button>
      )}
      {msg && <p className="text-[11px] text-cyan-400">{msg}</p>}
    </div>
  );
}

function OverviewTab({ client, patch, patchHealth, notes, setNotes, clientId, tgLink, waLink }: {
  client: ClientFull; patch: (p: Partial<ClientFull>, immediate?: boolean) => void; patchHealth: (p: Partial<ClientFull["health"]>) => void;
  notes: ClientNote[]; setNotes: (n: ClientNote[]) => void; clientId: string; tgLink: string; waLink: string;
  trainerId: string;
}) {
  const [noteText, setNoteText] = useState("");
  const addNote = async () => {
    if (!noteText.trim()) return;
    try {
      await api.addNote(clientId, noteText.trim());
      setNoteText("");
      api.fetchNotes(clientId).then(setNotes).catch((e) => console.error("[ClientProfile] fetchNotes:", e));
    } catch (e) { console.error("[ClientProfile] addNote:", e); }
  };
  const deleteNote = async (id: string) => {
    try { await api.deleteNote(id); setNotes(notes.filter((n) => n.id !== id)); }
    catch (e) { console.error("[ClientProfile] deleteNote:", e); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Users size={15} className="text-cyan-400" /> Статус и источник</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-zinc-500">Статус
            <select value={client.status} onChange={(e) => patch({ status: e.target.value, ...(e.target.value !== "paused" ? { pauseReason: "" } : {}) }, true)} className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40">
              <option value="active" className="bg-zinc-900">Активен</option>
              <option value="paused" className="bg-zinc-900">Приостановил</option>
              <option value="left" className="bg-zinc-900">Ушёл</option>
              <option value="archived" className="bg-zinc-900">Архив</option>
            </select>
          </label>
          <label className="text-xs text-zinc-500">Источник (как нашёл)
            <input value={client.source} onChange={(e) => patch({ source: e.target.value })} placeholder="реклама, рекомендация, соцсети..." className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
          <label className="text-xs text-zinc-500">Формат
            <select value={client.format ?? ""} onChange={(e) => patch({ format: e.target.value }, true)} className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40">
              <option value="" className="bg-zinc-900">Не указан</option>
              <option value="online" className="bg-zinc-900">Онлайн</option>
              <option value="offline" className="bg-zinc-900">Офлайн</option>
            </select>
          </label>
        </div>
        {client.status === "paused" && (
          <label className="text-xs text-zinc-500 block">Причина паузы
            <input value={client.pauseReason} onChange={(e) => patch({ pauseReason: e.target.value })} placeholder="напр. травма, отпуск" className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={client.trial} onChange={(e) => patch({ trial: e.target.checked }, true)} className="accent-lime-400 w-4 h-4" /> Пришёл на пробную тренировку
        </label>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Phone size={15} className="text-lime-400" /> Контакты</h3>
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-xs text-zinc-500">Телефон<input value={client.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="+7..." className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" /></label>
          <label className="text-xs text-zinc-500">Telegram<input value={client.telegram} onChange={(e) => patch({ telegram: e.target.value })} placeholder="@username" className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" /></label>
          <label className="text-xs text-zinc-500">WhatsApp<input value={client.whatsapp} onChange={(e) => patch({ whatsapp: e.target.value })} placeholder="79001234567" className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" /></label>
        </div>
        <label className="text-xs text-zinc-500 block">Email для входа в портал клиента<input type="email" value={client.email} onChange={(e) => patch({ email: e.target.value.trim() })} placeholder="client@mail.com" className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-cyan-400/40" /></label>
        <InviteBlock clientId={clientId} email={client.email} hasAccount={client.hasAccount} onFixEmail={(email) => patch({ email })} />
        <p className="text-[11px] text-zinc-600 -mt-1">{client.hasAccount ? "Доступ уже выдан. Если письмо не пришло и клиент ещё не входил — вышлите доступ заново (будет новый пароль)." : "Сгенерируем логин/пароль и отправим клиенту на почту."}</p>
        <div className="flex flex-wrap gap-2">
          {client.phone && <a href={`tel:${client.phone}`} className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 py-1.5 text-sm transition"><Phone size={14} /> Позвонить</a>}
          {tgLink && <a href={tgLink} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 rounded-lg px-3 py-1.5 text-sm transition"><Send size={14} /> Telegram</a>}
          {waLink && <a href={waLink} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-green-500/15 text-green-300 hover:bg-green-500/25 rounded-lg px-3 py-1.5 text-sm transition"><MessageCircle size={14} /> WhatsApp</a>}
          {!client.phone && !tgLink && !waLink && <p className="text-xs text-zinc-600">Заполни контакты, чтобы появились кнопки быстрой связи</p>}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><HeartPulse size={15} className="text-amber-400" /> Анкета здоровья / противопоказания</h3>
        <label className="text-xs text-zinc-500 block">Травмы / диагнозы<textarea value={client.health.injuries} onChange={(e) => patchHealth({ injuries: e.target.value })} rows={2} placeholder="напр. грыжа L4–L5, проблемы с коленом" className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" /></label>
        <label className="text-xs text-zinc-500 block">Ограничения (что нельзя)<textarea value={client.health.restrictions} onChange={(e) => patchHealth({ restrictions: e.target.value })} rows={2} placeholder="напр. без осевой нагрузки, без прыжков" className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" /></label>
        <label className="text-xs text-zinc-500 block">Прочее<textarea value={client.health.notes} onChange={(e) => patchHealth({ notes: e.target.value })} rows={2} placeholder="аллергии, особенности, цели по самочувствию" className="w-full mt-0.5 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" /></label>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><MessageSquare size={15} className="text-cyan-400" /> Заметки / история общения</h3>
        <div className="flex gap-2">
          <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} placeholder="Что обсудили, договорённости..." className="flex-1 bg-zinc-800 rounded-xl px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          <button onClick={addNote} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg px-3 text-sm transition">Добавить</button>
        </div>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {notes.length === 0 && <p className="text-xs text-zinc-600">Заметок пока нет</p>}
          {notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 bg-zinc-800/40 rounded-xl px-3 py-2 text-sm">
              <span className="text-zinc-500 text-xs shrink-0 w-20">{fmtDate(n.date)}</span>
              <span className="flex-1 text-zinc-200">{n.text}</span>
              <button onClick={() => deleteNote(n.id)} className="p-1 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportingTab({ clientId, measurements, setMeasurements, nutritionLogs, photos, setPhotos, activities, setActivities, measureTick }: {
  measureTick?: number;
  clientId: string;
  measurements: Measurement[]; setMeasurements: (m: Measurement[]) => void;
  nutritionLogs: NutritionLog[];
  photos: Photo[]; setPhotos: (p: Photo[]) => void;
  activities: ClientActivity[]; setActivities: (a: ClientActivity[]) => void;
}) {
  type ReportSub = "body" | "nutrition" | "activity" | "photos" | "goals";
  const REPORT_TABS: { key: ReportSub; label: string; icon: typeof Ruler }[] = [
    { key: "goals", label: "Цели", icon: Target },
    { key: "body", label: "Замеры", icon: Ruler },
    { key: "nutrition", label: "Питание", icon: Apple },
    { key: "activity", label: "Активность", icon: TrendingUp },
    { key: "photos", label: "Фото", icon: Images },
  ];
  const [reportSub, setReportSub] = useState<ReportSub>("goals");
  // B03: кнопка «Замер» в шапке карточки — переключаем на «Замеры» и просим раскрыть форму.
  useEffect(() => { if (measureTick) setReportSub("body"); }, [measureTick]);
  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5 overflow-x-auto">
        {REPORT_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setReportSub(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition whitespace-nowrap shrink-0 ${reportSub === key ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {reportSub === "body" && <BodyTab clientId={clientId} measurements={measurements} setMeasurements={setMeasurements} openForm={!!measureTick} />}
      {reportSub === "nutrition" && <NutritionDiary clientId={clientId} legacyLogs={nutritionLogs} measurements={measurements} asTrainer />}
      {reportSub === "activity" && <ActivityTab clientId={clientId} activities={activities} setActivities={setActivities} readOnly />}
      {reportSub === "photos" && <PhotosTab clientId={clientId} photos={photos} setPhotos={setPhotos} />}
      {reportSub === "goals" && <GoalsDashboard clientId={clientId} />}
    </div>
  );
}

function MembershipTab({ client, patchMembership, setMembership, clientId, trainerId }: { client: ClientFull; patchMembership: (p: paymentsApi.MembershipSettings, immediate?: boolean) => void; setMembership: (m: ClientFull["membership"]) => void; clientId: string; trainerId: string }) {
  const m = client.membership;
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [showPromotions, setShowPromotions] = useState(false);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const [otherClients, setOtherClients] = useState<api.ClientListItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Дата нового платежа — по умолчанию сегодня. Раньше поле показывало и отправляло
  // дату прошлой оплаты из абонемента, и продление записывалось задним числом.
  const [payDate, setPayDate] = useState(today);
  const [showPkg, setShowPkg] = useState(false);
  const [payMenu, setPayMenu] = useState<string | null>(null);

  const load = () => {
    paymentsApi.fetchPackageTemplates(trainerId).then(setTemplates).catch((e) => console.error("[PaymentsTab] fetchTemplates:", e));
    paymentsApi.fetchPromotions(clientId).then(setPromotions).catch((e) => console.error("[ClientProfile] акции:", e));
    api.fetchPayments(clientId).then(setPayments).catch((e) => console.error("[PaymentsTab] fetchPayments:", e));
    api.fetchClients(trainerId).then((cs) => setOtherClients(cs.filter((c) => c.id !== clientId))).catch((e) => console.error("[ClientProfile] список подопечных:", e));
  };
  useEffect(load, [clientId, trainerId]);

  const linkPartner = async (partnerId: string) => {
    const partner = otherClients.find((c) => c.id === partnerId);
    if (!partner) return;
    try { setMembership(await paymentsApi.linkSplit(clientId, partnerId)); }
    catch (e) { console.error("[PaymentsTab] linkPartner:", e); notify("Не удалось привязать партнёра."); }
  };
  const unlinkPartner = async () => {
    if (!(await ask("Отвязать сплит-партнёра?", { ok: "Отвязать" }))) return;
    try { setMembership(await paymentsApi.unlinkSplit(clientId)); }
    catch (e) { console.error("[PaymentsTab] unlinkPartner:", e); notify("Не удалось отвязать партнёра."); }
  };

  const activePromo = promotions.find((p) => p.active && p.appliesTo === (m.type === "subscription" ? "subscription" : "sessions"));
  const basePrice = m.type === "subscription" ? Number(m.pricePerSession) || 0 : Number(m.packagePrice) || 0;
  const preview = activePromo ? paymentsApi.applyPromotion(basePrice, promotions, m.type === "subscription" ? "subscription" : "sessions") : null;

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const finalPrice = t.discount ? Math.round(t.price * (1 - t.discount / 100)) : t.price;
    patchMembership({ total: String(t.sessions), packagePrice: String(finalPrice), split: t.split }, true);
  };
  const saveAsTemplate = async () => {
    const r = await askInput("Сохранить как шаблон", [{ key: "name", label: "Название шаблона", placeholder: "Например, «10 тренировок»" }], { ok: "Сохранить" });
    const name = r?.name.trim();
    if (!name) return;
    try {
      await paymentsApi.savePackageTemplate(trainerId, { name, sessions: Number(m.total) || 0, price: Number(m.packagePrice) || 0, discount: 0, split: m.split });
      paymentsApi.fetchPackageTemplates(trainerId).then(setTemplates).catch((e) => console.error("[PaymentsTab] fetchTemplates:", e));
    } catch (e) { console.error("[PaymentsTab] saveAsTemplate:", e); notify("Не удалось сохранить шаблон."); }
  };

  // Запись оплаты может идти секунды (запись без таймаута, см. lib/supabase): пока она идёт,
  // кнопки неактивны, а флаг в ref ставится до первого await — второе нажатие не создаст
  // второй платёж и второе начисление пакета.
  const payLock = useRef(false);
  const [paying, setPaying] = useState(false);
  // П17: ключ от повторов. Живёт до успешной записи: если ответ потерялся и тренер жмёт
  // «Оплачено» ещё раз, сервер узнает тот же id и второй платёж не создаст.
  const payKey = useRef<string | null>(null);
  const doMarkPaid = async (payStatus: paymentsApi.PayStatus) => {
    if (payLock.current) return;
    payLock.current = true; setPaying(true);
    if (!payKey.current) payKey.current = crypto.randomUUID();
    try {
      // Настройки пакета оплата берёт с экрана (p_package) — недосохранённый ввод не мешает
      const res = await paymentsApi.markPaid(clientId, { ...m, paymentDate: payDate }, promotions, payStatus, payKey.current);
      payKey.current = null;
      setMembership(res.membership);
      if (res.duplicate) notify("Эта оплата уже была записана — повтор не создан.");
      else track("action", "payment", { status: payStatus, via: "profile" });
      api.fetchPayments(clientId).then(setPayments).catch((e) => console.error("[PaymentsTab] fetchPayments:", e));
    }
    catch (e) { console.error("[PaymentsTab] doMarkPaid:", e); notify("Не удалось записать оплату."); }
    finally { payLock.current = false; setPaying(false); }
  };
  const paidLock = useRef(new Set<string>());
  const [markingIds, setMarkingIds] = useState<string[]>([]);
  const doMarkPaymentPaid = async (id: string) => {
    if (paidLock.current.has(id)) return;
    paidLock.current.add(id); setMarkingIds((l) => [...l, id]);
    try { await paymentsApi.markPaymentPaid(id); api.fetchPayments(clientId).then(setPayments).catch((e) => console.error("[PaymentsTab] fetchPayments:", e)); }
    catch (e) { console.error("[PaymentsTab] markPaymentPaid:", e); notify("Не удалось обновить платёж."); }
    finally { paidLock.current.delete(id); setMarkingIds((l) => l.filter((x) => x !== id)); }
  };

  const editPayment = async (p: Payment) => {
    const r = await askInput("Изменить платёж", [
      { key: "amount", label: "Сумма, ₽", value: String(p.amount), numeric: true },
      { key: "note", label: "Примечание", value: p.note, placeholder: "Необязательно" },
    ], { ok: "Сохранить" });
    if (!r) return;
    const amount = Number(r.amount.replace(",", ".").replace(/\s/g, "")) || p.amount;
    try { await paymentsApi.updatePayment(p.id, { amount, note: r.note.trim() }); api.fetchPayments(clientId).then(setPayments).catch((e) => console.error("[PaymentsTab] fetchPayments:", e)); }
    catch (e) { console.error("[PaymentsTab] editPayment:", e); notify("Не удалось обновить платёж."); }
  };
  const splitKeys = useRef(new Map<string, string[]>());
  const splitPayment = async (p: Payment) => {
    const r = await askInput("Разбить платёж", [{ key: "parts", label: "На сколько частей", value: "2", numeric: true }], { ok: "Разбить" });
    if (!r) return;
    const parts = Math.round(Number(r.parts));
    if (!parts || parts < 2) { notify("Нужно 2 части или больше."); return; }
    if (parts > 50) { notify("Не больше 50 частей."); return; }
    // Ключ от повторов: те же id частей до успеха — повтор после ошибки не разобьёт платёж ещё раз
    const k = `${p.id}:${parts}`;
    const ids = splitKeys.current.get(k) ?? Array.from({ length: parts - 1 }, () => crypto.randomUUID());
    splitKeys.current.set(k, ids);
    try { await paymentsApi.splitPayment(p.id, ids); splitKeys.current.delete(k); api.fetchPayments(clientId).then(setPayments).catch((e) => console.error("[PaymentsTab] fetchPayments:", e)); }
    catch (e) { console.error("[PaymentsTab] splitPayment:", e); notify("Не удалось разбить платёж."); }
  };
  const deletePayment = async (id: string) => {
    if (!(await ask("Удалить платёж из журнала? Если он добавлял тренировки в остаток, остаток тоже уменьшится обратно.", { danger: true, ok: "Удалить" }))) return;
    try { setMembership(await paymentsApi.deletePayment(id, clientId)); api.fetchPayments(clientId).then(setPayments).catch((e) => console.error("[PaymentsTab] fetchPayments:", e)); }
    catch (e) { console.error("[PaymentsTab] deletePayment:", e); notify("Не удалось удалить платёж."); }
  };

  const isSub = m.type === "subscription";
  const total = Number(m.total) || 0;
  const pkgPrice = Number(m.packagePrice) || 0;
  const perSession = !isSub && total > 0 && pkgPrice > 0 ? Math.round(pkgPrice / total) : 0;
  const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
  const tplPrice = (t: PackageTemplate) => (t.discount ? Math.round(t.price * (1 - t.discount / 100)) : t.price);
  // Выбранный пакет: шаблон, совпавший с текущим пакетом абонемента, иначе — сам текущий
  const matchedTpl = templates.find((t) => t.sessions === total && tplPrice(t) === pkgPrice && !!t.split === !!m.split);
  const payAmount = preview ? preview.amount : basePrice;

  return (
    <div className="space-y-4">
      {/* Пакет: что куплено и за сколько; редкие настройки — под ⚙ */}
      <button onClick={() => setShowPkg(true)} className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3.5 text-left hover:border-zinc-700 transition">
        <span className="w-10 h-10 shrink-0 rounded-xl bg-zinc-800 flex items-center justify-center"><Wallet size={19} className="text-zinc-300" /></span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold truncate">
            {isSub ? `Подписка${Number(m.pricePerSession) ? ` · ${rub(Number(m.pricePerSession))}` : ""}` : total ? `Пакет ${total} тр.${pkgPrice ? ` · ${rub(pkgPrice)}` : ""}` : "Пакет не настроен"}
          </span>
          <span className="block text-[13px] text-zinc-400 truncate">
            {isSub
              ? m.nextPaymentDate ? `Следующий платёж ${fmtDate(m.nextPaymentDate)}` : "Дата платежа не указана"
              : [perSession ? `${rub(perSession)} за тренировку` : "Нажмите, чтобы указать количество и цену", m.split ? (m.partnerName ? `сплит с ${m.partnerName}` : "сплит") : ""].filter(Boolean).join(" · ")}
          </span>
        </span>
        <Settings2 size={19} className="text-zinc-500 shrink-0" />
      </button>
      {Number(m.extraRemaining) > 0 && (
        <p className="text-[13px] text-cyan-300/90 px-1 -mt-2">+ {m.extraRemaining} тр. доп. блока по {rub(Math.round(Number(m.extraPricePerSession) || 0))} — старый пакет с другой ценой</p>
      )}

      {/* Принять оплату: пакет, дата, одна главная кнопка */}
      <div>
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <h3 className="text-[17px] font-bold">Принять оплату</h3>
          <button onClick={() => setShowPromotions(true)} className={`flex items-center gap-1 h-8 px-2.5 rounded-lg text-[13px] font-semibold transition ${activePromo ? "bg-orange-400/15 text-orange-300" : "text-zinc-400 hover:text-zinc-100"}`}><Percent size={14} /> {activePromo ? "Акция" : "Акции"}</button>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 space-y-3">
          {!isSub && (
            <div className="flex gap-2 overflow-x-auto -mx-3.5 px-3.5 pb-0.5">
              {!matchedTpl && total > 0 && (
                <span className="shrink-0 min-w-[8.5rem] rounded-xl bg-zinc-800 px-3 py-2.5 ring-2 ring-inset ring-lime-400">
                  <span className="block font-semibold">{total} тренировок</span>
                  <span className="block text-[13px] text-zinc-400">{pkgPrice ? rub(pkgPrice) : "цена не указана"} · текущий</span>
                </span>
              )}
              {templates.map((t) => (
                <button key={t.id} onClick={() => applyTemplate(t.id)}
                  className={`shrink-0 min-w-[8.5rem] text-left rounded-xl bg-zinc-800 px-3 py-2.5 transition ${matchedTpl?.id === t.id ? "ring-2 ring-inset ring-lime-400" : "hover:bg-zinc-700"}`}>
                  <span className="block font-semibold truncate">{t.name}</span>
                  <span className="block text-[13px] text-zinc-400">{t.sessions} тр. · {rub(tplPrice(t))}{t.discount ? ` · −${t.discount}%` : ""}</span>
                </button>
              ))}
              <button onClick={() => setShowPkg(true)} className="shrink-0 min-w-[6.5rem] text-left rounded-xl bg-zinc-800 px-3 py-2.5 hover:bg-zinc-700 transition">
                <span className="block font-semibold">Свой</span>
                <span className="block text-[13px] text-zinc-400">кол-во и цена</span>
              </button>
            </div>
          )}
          <DateField label="Дата оплаты" value={payDate} onChange={(e) => setPayDate(e.target.value || today())} />
          <button onClick={() => doMarkPaid("paid")} disabled={!basePrice || paying}
            className="w-full h-12 flex items-center justify-center gap-2 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98] disabled:opacity-40">
            <Check size={18} strokeWidth={2.75} /> {paying ? "Сохраняю…" : basePrice ? `Оплачено · ${rub(payAmount)}` : "Укажите цену пакета"}
          </button>
          {preview && preview.amount !== basePrice && <p className="text-[13px] text-orange-300 text-center -mt-1">{preview.label}: вместо {rub(basePrice)}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => doMarkPaid("deferred")} disabled={!basePrice || paying} title="Блок начислен, оплата ожидается"
              className="h-11 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold transition disabled:opacity-40"><Clock size={16} className="text-orange-300" /> Позже</button>
            <button onClick={() => doMarkPaid("installment")} disabled={!basePrice || paying} title="Блок начислен, оплата разбита на части"
              className="h-11 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold transition disabled:opacity-40"><SplitSquareVertical size={16} className="text-cyan-300" /> Частями</button>
          </div>
        </div>
      </div>

      {/* Журнал: сумма, дата, статус; действия — в меню «⋯» */}
      <div>
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <h3 className="text-[17px] font-bold">Журнал платежей</h3>
          <button onClick={() => setShowHistory(true)} className="h-8 px-2 rounded-lg text-[13px] font-semibold text-zinc-400 hover:text-zinc-100 transition">Даты тренировок</button>
        </div>
        {payments.length === 0 ? (
          <p className="text-sm text-zinc-500 px-0.5">Платежей пока нет</p>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800">
            {payments.map((p) => (
              <div key={p.id} className="relative flex items-center gap-2 pl-4 pr-1.5 min-h-[60px] py-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold flex items-center gap-1.5 flex-wrap">
                    {rub(p.amount)}
                    {p.payStatus === "deferred" && <span className="h-5 px-2 rounded-full text-xs font-semibold bg-orange-400/15 text-orange-300 inline-flex items-center">ожидается</span>}
                    {p.payStatus === "installment" && <span className="h-5 px-2 rounded-full text-xs font-semibold bg-cyan-400/15 text-cyan-300 inline-flex items-center">частями</span>}
                  </p>
                  <p className="text-[13px] text-zinc-400 truncate">{[fmtDate(p.date), p.type === "subscription" ? "подписка" : "пакет", p.promoApplied, p.note].filter(Boolean).join(" · ")}</p>
                </div>
                {p.payStatus !== "paid" && (
                  <button onClick={() => doMarkPaymentPaid(p.id)} disabled={markingIds.includes(p.id)} title="Отметить оплаченным" className="h-9 px-2.5 rounded-lg text-[13px] font-semibold text-lime-400 hover:bg-lime-400/10 transition shrink-0 disabled:opacity-50">{markingIds.includes(p.id) ? "Сохраняю…" : "Оплачен"}</button>
                )}
                <button onClick={() => setPayMenu(payMenu === p.id ? null : p.id)} aria-label="Действия с платежом" aria-expanded={payMenu === p.id}
                  className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition"><MoreHorizontal size={19} /></button>
                {payMenu === p.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPayMenu(null)} />
                    <div className="absolute right-2 top-full -mt-1 z-20 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 w-48 shadow-xl">
                      <button onClick={() => { setPayMenu(null); setReceipt(p); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition"><Printer size={15} className="text-zinc-500" /> Чек</button>
                      <button onClick={() => { setPayMenu(null); editPayment(p); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition"><Pencil size={15} className="text-zinc-500" /> Изменить</button>
                      <button onClick={() => { setPayMenu(null); splitPayment(p); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition"><Scissors size={15} className="text-zinc-500" /> Разбить</button>
                      <div className="my-1 border-t border-zinc-800" />
                      <button onClick={() => { setPayMenu(null); deletePayment(p.id); }} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-red-400 hover:bg-zinc-800 transition"><Trash2 size={15} /> Удалить</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Пакет и абонемент — меняют редко */}
      {showPkg && (
        <ModalShell title="Пакет и абонемент" icon={<Wallet size={17} className="text-lime-400" />} onClose={() => setShowPkg(false)}>
          <div className="p-4 space-y-3.5">
            <div className="flex p-1 rounded-xl bg-zinc-800">
              {([["sessions", "По тренировкам"], ["subscription", "Подписка"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => patchMembership({ type: k }, true)} aria-pressed={(k === "subscription") === isSub}
                  className={`flex-1 h-10 rounded-lg text-sm font-semibold transition ${(k === "subscription") === isSub ? "bg-zinc-900 text-zinc-100 shadow" : "text-zinc-400"}`}>{l}</button>
              ))}
            </div>
            {isSub ? (
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Сумма ₽" value={m.pricePerSession} onChange={(e) => patchMembership({ pricePerSession: e.target.value })} placeholder="5000" />
                <DateField label="След. платёж" value={m.nextPaymentDate} onChange={(e) => patchMembership({ nextPaymentDate: e.target.value })} />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <NumField label="Тренировок" value={m.total} onChange={(e) => patchMembership({ total: e.target.value })} placeholder="10" />
                  <NumField label="Цена пакета ₽" value={m.packagePrice} onChange={(e) => patchMembership({ packagePrice: e.target.value })} placeholder="24000" />
                </div>
                <label className="flex items-center gap-3 min-h-[52px] cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={!!m.split} onChange={() => (m.split ? unlinkPartner() : patchMembership({ split: true }, true))} />
                  <span className="relative w-11 h-7 shrink-0 rounded-full bg-zinc-700 peer-checked:bg-lime-400 transition after:content-[''] after:absolute after:top-1 after:left-1 after:w-5 after:h-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
                  <span className="flex-1"><span className="block font-semibold">Сплит на двоих</span><span className="block text-[13px] text-zinc-400">{m.split && m.partnerName ? `Общий остаток и оплата 50/50 с ${m.partnerName}` : "Общий остаток, оплата 50/50"}</span></span>
                </label>
                {m.split && !m.partnerClientId && (
                  <select onChange={(e) => e.target.value && linkPartner(e.target.value)} defaultValue="" className="w-full h-11 bg-zinc-800 rounded-xl px-3 outline-none">
                    <option value="" className="bg-zinc-900">Выбрать партнёра по сплиту…</option>
                    {otherClients.map((c) => <option key={c.id} value={c.id} className="bg-zinc-900">{c.name}</option>)}
                  </select>
                )}
              </>
            )}
            <label className="block text-sm font-semibold">Заметка
              <input value={m.note} onChange={(e) => patchMembership({ note: e.target.value })} placeholder="Необязательно" className="mt-1.5 w-full h-11 bg-zinc-800 rounded-xl px-3 font-normal outline-none focus:ring-1 focus:ring-lime-400/40" />
            </label>
            <button onClick={() => setShowPkg(false)} className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition">Готово</button>
            {!isSub && <button onClick={saveAsTemplate} className="w-full h-11 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold transition">Сохранить как шаблон пакета</button>}
          </div>
        </ModalShell>
      )}
      {showHistory && <SessionHistoryModal trainerId={trainerId} clientId={clientId} onClose={() => setShowHistory(false)} />}
      {showPromotions && <PromotionsModal clientId={clientId} onClose={() => { setShowPromotions(false); load(); }} />}
      {receipt && <ReceiptPrintView payment={receipt} trainerId={trainerId} clientName={client.name} onClose={() => setReceipt(null)} />}
    </div>
  );
}

// B02: записи клиента в карточке. Данные уже загружены в App (B17) и приходят пропом —
// новых запросов нет. Тап открывает запись в календаре механизмом из B24.
// ponytail: разворачиваем повторы на год назад и вперёд — этого хватает для карточки,
// полный горизонт живёт в календаре.
function BookingsTab({ clientId, bookings, onOpenOccurrence, onBook }: {
  clientId: string; bookings: Booking[]; onOpenOccurrence?: (id: string, occDate: string) => void; onBook?: () => void;
}) {
  const bookBtn = onBook && (
    <button onClick={onBook} className="w-full h-11 flex items-center justify-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-semibold text-zinc-100 hover:border-zinc-700 transition">
      <Plus size={16} /> Записать на тренировку
    </button>
  );
  const todayStr = today();
  const mine = bookings.filter((b) => b.clientIds.includes(clientId));
  const occs = expandBookings(mine, addDays(todayStr, -365), addDays(todayStr, 365));
  const upcoming = occs.filter((o) => o.date >= todayStr && o.status !== "cancelled").sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const past = occs.filter((o) => o.date < todayStr).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 30);

  const Row = ({ o }: { o: (typeof occs)[number] }) => (
    <button
      onClick={() => onOpenOccurrence?.(o.id, o.occDate)}
      disabled={!onOpenOccurrence}
      className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-left transition hover:border-zinc-700 disabled:hover:border-zinc-800"
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BOOKING_STATUS_COLOR[o.status] }} />
      <span className="text-sm text-zinc-200 shrink-0 w-[86px]">{fmtDate(o.date, true)}</span>
      <span className="font-mono text-xs text-zinc-400 w-10 shrink-0">{o.time}</span>
      <span className="text-xs text-zinc-500 truncate flex-1">{BOOKING_STATUS_LABEL[o.status]}{o.recurring && " · еженедельно"}</span>
    </button>
  );

  if (!occs.length) return (
    <div className="space-y-3">
      {bookBtn}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-8 text-center">
        <CalendarCheck size={26} className="mx-auto text-zinc-700 mb-2" />
        <p className="text-sm text-zinc-600">Записей в календаре пока нет</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {bookBtn}
      {upcoming.length > 0 && (
        <div>
          <p className="text-[15px] font-bold mb-2 px-0.5">Предстоящие <span className="text-zinc-500 font-semibold">· {upcoming.length}</span></p>
          <div className="space-y-1.5">{upcoming.map((o) => <Row key={`${o.id}-${o.occDate}`} o={o} />)}</div>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <p className="text-[15px] font-bold mb-2 px-0.5">Прошедшие</p>
          <div className="space-y-1.5">{past.map((o) => <Row key={`${o.id}-${o.occDate}`} o={o} />)}</div>
        </div>
      )}
    </div>
  );
}

function PhotosTab({ clientId, photos, setPhotos }: { clientId: string; photos: Photo[]; setPhotos: (p: Photo[]) => void }) {
  const [photoUrl, setPhotoUrl] = useState("");
  const sorted = [...photos].sort((a, b) => (a.date < b.date ? -1 : 1));

  const reload = () => api.fetchPhotos(clientId).then(setPhotos).catch((e) => console.error("[PhotosTab] fetchPhotos:", e));
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const thumb = await fileToThumb(f); await api.addPhoto(clientId, thumb); reload(); }
    catch { notify("Не удалось обработать изображение"); }
    e.target.value = "";
  };
  const addByUrl = async () => { const u = photoUrl.trim(); if (!u) return; try { await api.addPhoto(clientId, u); setPhotoUrl(""); reload(); } catch (e) { console.error("[PhotosTab] addByUrl:", e); notify("Не удалось добавить фото."); } };
  const remove = async (id: string) => { try { await api.deletePhoto(id); setPhotos(photos.filter((p) => p.id !== id)); } catch (e) { console.error("[PhotosTab] remove:", e); } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-xl px-3 py-2 text-sm hover:bg-lime-300 transition cursor-pointer"><Camera size={15} /> Загрузить фото<input type="file" accept="image/*" onChange={onUpload} className="hidden" /></label>
        <div className="flex gap-2 flex-1 min-w-[160px]">
          <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addByUrl()} placeholder="или вставь ссылку на фото" className="flex-1 min-w-0 bg-zinc-800 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          <button onClick={addByUrl} className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 text-sm text-zinc-200 transition">+</button>
        </div>
      </div>
      <p className="text-[11px] text-zinc-600">Загруженные фото сжимаются и хранятся в базе. Для большого архива лучше использовать ссылки.</p>

      {sorted.length >= 2 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
          <p className="text-xs text-zinc-500 mb-2">Сравнение: до → после</p>
          <div className="grid grid-cols-2 gap-2">
            <div><img src={sorted[0].url} alt="до" className="w-full h-48 object-cover rounded-xl bg-zinc-800" /><p className="text-[11px] text-zinc-500 mt-1 text-center">{fmtDate(sorted[0].date)} · до</p></div>
            <div><img src={sorted[sorted.length - 1].url} alt="после" className="w-full h-48 object-cover rounded-xl bg-zinc-800" /><p className="text-[11px] text-lime-400 mt-1 text-center">{fmtDate(sorted[sorted.length - 1].date)} · после</p></div>
          </div>
        </div>
      )}

      {sorted.length === 0 ? <p className="text-sm text-zinc-600 text-center py-8">Фото пока нет. Загрузи снимок «до», чтобы потом сравнить прогресс.</p> : (
        <div className="grid grid-cols-3 gap-2">
          {[...sorted].reverse().map((p) => (
            <div key={p.id} className="relative group">
              <img src={p.url} alt="" className="w-full h-32 object-cover rounded-xl bg-zinc-800" />
              <div className="absolute bottom-1 left-1 right-1 text-[11px] text-white bg-black/50 rounded-lg px-1 py-0.5 text-center">{fmtDate(p.date)}</div>
              <button onClick={() => remove(p.id)} className="absolute top-1 right-1 p-1.5 rounded-lg bg-black/50 text-white hover:bg-red-500 transition"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlansTab({ trainerId, clientId, clientName, allPlans, plans, setPlans, onOpenPlan }: { trainerId: string; clientId: string; clientName: string; allPlans: PlanOverviewItem[]; plans: PlanListItem[] | null; setPlans: (p: PlanListItem[]) => void; onOpenPlan: (id: string) => void }) {
  const [name, setName] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const createPlan = async () => {
    if (!name.trim()) return;
    try {
      const row = await api.addPlan(trainerId, clientId, name.trim());
      setName("");
      api.fetchClientPlans(clientId).then(setPlans).catch((e) => console.error("[ClientProfile] fetchPlans:", e));
      onOpenPlan(row.id);
    } catch (e) { console.error("[ClientProfile] createPlan:", e); notify("Не удалось создать план."); }
  };
  // B06: дубликат плана со всей структурой
  const [dupId, setDupId] = useState<string | null>(null);
  const duplicate = async (id: string, planName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (dupId) return;
    setDupId(id);
    try {
      await duplicatePlan(trainerId, clientId, id, `${planName} (копия)`);
      api.fetchClientPlans(clientId).then(setPlans).catch((e) => console.error("[ClientProfile] fetchPlans:", e));
    } catch (err) { console.error("[ClientProfile] duplicate:", err); notify("Не удалось дублировать план."); }
    finally { setDupId(null); }
  };
  const deletePlan = async (id: string, planName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(await ask(`Удалить план «${planName}»? Его можно восстановить из корзины.`, { danger: true, ok: "Удалить" }))) return;
    try { await api.deletePlan(id); api.fetchClientPlans(clientId).then(setPlans).catch((e) => console.error("[ClientProfile] fetchPlans:", e)); }
    catch (err) { console.error("[ClientProfile] deletePlan:", err); notify("Не удалось удалить план."); }
  };

  return (
    <div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-4 space-y-2">
        <p className="text-sm text-zinc-400">Новый план тренировок</p>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createPlan()} placeholder="Название плана" className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-lime-400/50" />
          <button onClick={createPlan} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-xl px-3 py-2 text-sm hover:bg-lime-300 transition shrink-0"><Plus size={15} /> Создать</button>
        </div>
        <button onClick={() => setShowCatalog(true)} className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl py-2 text-sm transition"><Sparkles size={15} className="text-lime-400" /> Создать из готового</button>
      </div>
      {showCatalog && (
        <PlanCreateModal
          trainerId={trainerId}
          clientId={clientId}
          clientName={clientName}
          allPlans={allPlans}
          onCreated={(planId) => { setShowCatalog(false); api.fetchClientPlans(clientId).then(setPlans).catch((e) => console.error("[ClientProfile] fetchPlans:", e)); onOpenPlan(planId); }}
          onClose={() => setShowCatalog(false)}
        />
      )}

      {plans === null ? (
        <SkeletonRows />
      ) : (
        <div className="space-y-2">
          {plans.length === 0 && <p className="text-zinc-600 text-sm text-center py-8">Планов пока нет</p>}
          {plans.map((p) => (
            <button key={p.id} onClick={() => onOpenPlan(p.id)} className="w-full text-left bg-zinc-900 border border-zinc-800 rounded-2xl p-3 hover:border-zinc-700 transition flex items-center justify-between gap-2">
              <span className="font-medium truncate">{p.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                {p.archived && <span className="text-xs bg-zinc-700 text-zinc-400 rounded-lg px-1.5 py-0.5">архив</span>}
                <span onClick={(e) => duplicate(p.id, p.name, e)} className={`p-1 rounded-lg hover:bg-zinc-700 hover:text-zinc-200 text-zinc-500 transition ${dupId === p.id ? "opacity-40" : ""}`} title="Дублировать план"><Copy size={14} /></span>
                <span onClick={(e) => deletePlan(p.id, p.name, e)} className="p-1 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition" title="Удалить"><Trash2 size={14} /></span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
