import { ArrowLeft, Check, CloudOff, Settings2, Apple, MoreHorizontal, CalendarCheck, Camera, Clock, ClipboardList, HeartPulse, MessageCircle, MessageSquare, Pencil, Percent, Phone, Pin, Play, Plus, Printer, Ruler, Scissors, Send, SplitSquareVertical, Trash2, TrendingUp, Users, Wallet, Images, X, Target, Copy, Sparkles, Share2, Archive, ArchiveRestore } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GOALS } from "../constants";
import * as api from "../lib/clients";
import { onWorkoutFinished } from "../lib/clientsBus";
import type { ClientFull, ClientNote, Measurement, Payment, PlanListItem, Photo } from "../lib/clients";
import * as paymentsApi from "../lib/payments";
import type { PackageTemplate, Promotion } from "../lib/payments";
import { fmtDate, today, addDays, waPhone } from "../lib/format";
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
import { duplicatePlan, makePlanActive, setPlanArchived } from "../lib/plans";
import PlanCreateModal from "./PlanCreateModal";
import type { PlanOverviewItem } from "../lib/clients";
import type { Booking } from "../lib/bookings";
import ActivityTab from "./ActivityTab";
import GoalsDashboard from "./GoalsDashboard";
import * as portalApi from "../lib/clientPortal";
import { cached, fmtSavedAt, onRevalidate, releaseStale, revalidate, staleAtOf } from "../lib/offlineCache";
import { isNetworkError } from "../lib/outbox";
import { humanError } from "../lib/errors";
import LoadError from "./LoadError";

// Отказ правки карточки из кэша — не чаще раза в 4 с (иначе сообщение на каждую букву)
let lockedToastAt = 0;
// Сообщение о несохранённой правке — тоже не чаще раза в 4 с
let saveErrToastAt = 0;
import type { ClientActivity } from "../lib/clientPortal";
import { ScreenSkeleton, SkeletonRows } from "./Skeleton";
import StartWorkoutModal from "./StartWorkoutModal";
import { ask, askInput, choose, notify } from "../lib/dialog";
import { checkEmail } from "../lib/emailCheck";
import { loadViewState, saveViewState } from "../lib/viewState";
import { track } from "../lib/events";
import { activeBlocks, blockColor, blockLabel, confirmNewBlock, fetchBlocks, type Block } from "../lib/blocks";

export type Sub = "overview" | "bookings" | "payments" | "reporting" | "plans";
/** Разделы карточки, которые грузятся отдельно (флаги ошибки загрузки) */
type Part = "client" | "plans" | "measurements" | "photos" | "notes" | "activities";

// Порядок задан владельцем: обзор — отчёты — записи — планы. Оплаты открываются карточкой абонемента.
const TABS: { k: Sub; label: string; icon: typeof Users }[] = [
  { k: "overview", label: "Обзор", icon: Users },
  { k: "reporting", label: "Отчёты", icon: TrendingUp },
  { k: "bookings", label: "Записи", icon: CalendarCheck },
  { k: "plans", label: "Планы", icon: ClipboardList },
];
export default function ClientProfile({ trainerId, clientId, onBack, onOpenPlan, initialSub, onSubChange, pinned, onTogglePinned, onBookClient, bookings, allPlans, onOpenOccurrence }: { trainerId: string; clientId: string; onBack: () => void; onOpenPlan: (id: string) => void; initialSub?: Sub; onSubChange?: (s: Sub) => void; pinned?: boolean; onTogglePinned?: () => void; onBookClient?: (clientId: string) => void; bookings?: Booking[]; allPlans?: PlanOverviewItem[]; onOpenOccurrence?: (id: string, occDate: string) => void }) {
  const [sub, setSubState] = useState<Sub>(initialSub || "overview");
  // 0.2: вкладка живёт в адресе — после «Назад» из плана карточка открывается на ней же
  const setSub = (s: Sub) => { setSubState(s); onSubChange?.(s); };
  const [noAccessHidden, setNoAccessHidden] = useState(() => { try { return localStorage.getItem(`reps-noaccess-hidden-${clientId}`) === "1"; } catch { return false; } });
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
  // Аудит п. 41: раздел не загрузился — «Не удалось загрузить» с повтором, а не «пока нет»
  const [failed, setFailed] = useState<Partial<Record<Part, boolean>>>({});
  const retry = useRef<(p: Part) => void>(() => {});

  useEffect(() => {
    let alive = true;
    setFailed({});
    // Карточка и планы без сети — последние сохранённые, чтобы начать тренировку в зале
    // Без сети замеры, фото, заметки не грузятся — это ожидаемо: одно предупреждение, а не шквал ошибок
    let warned = false;
    const fail = (what: string) => (e: unknown) => {
      if (!isNetworkError(e)) { console.error(`[ClientProfile] ${what}:`, e); return; }
      if (!warned) { warned = true; console.warn("[ClientProfile] нет сети — часть карточки не загружена"); }
    };
    // Загрузка раздела: успех снимает флаг ошибки, сбой — ставит
    const part = <T,>(p: Part, what: string, load: () => Promise<T>, set: (v: T) => void) => () => load()
      .then((v) => { if (alive) { set(v); setFailed((f) => ({ ...f, [p]: false })); } })
      .catch((e) => { fail(what)(e); if (alive) setFailed((f) => ({ ...f, [p]: true })); });
    const loadClient = part("client", "карточка", () => cached(`client:${clientId}`, () => api.fetchClient(clientId)),
      (v) => { setClient(v); setCachedAt(staleAtOf(`client:${clientId}`)); });
    const loadPlans = part("plans", "планы", () => cached(`cplans:${clientId}`, () => api.fetchClientPlans(clientId)), setPlans);
    const loaders: Record<Part, () => void> = {
      client: loadClient,
      plans: loadPlans,
      measurements: part("measurements", "замеры", () => api.fetchMeasurements(clientId), setMeasurements),
      photos: part("photos", "фото", () => api.fetchPhotos(clientId), setPhotos),
      notes: part("notes", "заметки", () => api.fetchNotes(clientId), setNotes),
      activities: part("activities", "активность", () => portalApi.fetchClientActivities(clientId), setActivities),
    };
    retry.current = (p) => loaders[p]();
    loadClient();
    loaders.measurements();
    nutritionApi.fetchNutritionLogs(clientId).then((v) => { if (alive) setNutritionLogs(v); }).catch(fail("питание"));
    loaders.photos();
    loaders.notes();
    loadPlans();
    loaders.activities();
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

  // Этап 11: оплаченные блоки. Перечитываем, когда меняется сводный остаток (оплата, списание, возврат)
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  // Этап 12: кольца «наполняются» после показа карточки, а не появляются сразу полными
  const [ringsIn, setRingsIn] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => requestAnimationFrame(() => setRingsIn(true))); return () => cancelAnimationFrame(t); }, [clientId]);
  const remKey = client ? `${client.membership.remaining}|${client.membership.remainingTotal}|${client.membership.paymentDate}` : "";
  useEffect(() => {
    let alive = true;
    if (remKey) fetchBlocks(clientId).then((b) => { if (alive) setBlocks(b); });
    return () => { alive = false; };
  }, [clientId, remKey]);

  if (!client) return <div className="p-4">{failed.client ? <LoadError onRetry={() => retry.current("client")} /> : <ScreenSkeleton avatar />}</div>;
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
  const waLink = client.whatsapp ? `https://wa.me/${waPhone(client.whatsapp)}` : "";
  const remainingNum = api.combinedRemaining(client.membership);
  const lowStock = client.membership.type !== "subscription" && client.membership.remaining !== "" && remainingNum > 0 && remainingNum <= 2;
  const outOfStock = client.membership.type !== "subscription" && client.membership.remaining !== "" && remainingNum <= 0;
  const overdue = client.membership.type === "subscription" && client.membership.nextPaymentDate && client.membership.nextPaymentDate < today();
  // 2.17: ушедших тренеры удаляли — а через 30 дней пропадали планы и история оплат.
  // Архив всё сохраняет, поэтому при удалении предлагаем его первым, а удаление можно отменить.
  const archiveClient = (archived: boolean) => {
    const p = { status: archived ? "archived" : "active", pauseReason: "" };
    setClient((c) => (c ? { ...c, ...p } : c));
    // Сообщаем после сохранения, а не до: иначе при сбое пришли бы два противоречащих
    api.updateClient(clientId, p).then(() => notify(archived ? "Клиент в архиве — планы и история оплат сохранены" : "Клиент снова активный", "info")).catch(saveFailed);
  };
  const deleteClient = async () => {
    if (locked()) return;
    if (client.status !== "archived") {
      const r = await choose(`Удалить «${client.name}»? Через 30 дней в корзине пропадут планы и история оплат. Если клиент просто ушёл — убери его в архив: всё сохранится.`, { ok: "В архив", alt: "Удалить" });
      if (r === null) return;
      if (r === "ok") { archiveClient(true); return; }
    } else if (!(await ask(`Удалить «${client.name}»? Карточка полежит в корзине 30 дней, потом пропадёт вместе с планами и историей оплат.`, { danger: true, ok: "Удалить" }))) return;
    try {
      await api.deleteClient(clientId);
      onBack();
      notify(`«${client.name}» в корзине`, "info", { label: "Отменить", run: () => {
        api.restoreClient(clientId).then(() => notify("Клиент восстановлен", "info"))
          .catch((e) => { console.error("[ClientProfile] restoreClient:", e); notify("Не удалось восстановить. Карточка в корзине — в профиле."); });
      } });
    } catch (e) { console.error("[ClientProfile] deleteClient:", e); notify("Не удалось удалить карточку. Попробуй ещё раз."); }
  };

  // Абонемент под именем: остаток кольцом, нажатие — вкладка оплат
  const isSessions = client.membership.type !== "subscription";
  const remTotal = Number(client.membership.remainingTotal) || Number(client.membership.total) || 0;
  const hasRemaining = isSessions && client.membership.remaining !== "";
  const ringPct = hasRemaining && remTotal > 0 ? Math.max(0, Math.min(1, remainingNum / remTotal)) : 0;
  const ringColor = outOfStock ? "text-red-400" : lowStock ? "text-orange-400" : "text-lime-400";
  // Два блока с остатком и больше — вместо одного кольца маленькое кольцо на каждый блок
  const multi = isSessions && activeBlocks(blocks).length >= 2 ? activeBlocks(blocks) : null;
  const shownBlock = multi?.find((b) => b.id === openBlock) ?? null;
  const renewTone = outOfStock || lowStock || overdue;

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
        <button onClick={onBack} aria-label="К клиентам" title="К клиентам" className="w-11 h-11 flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"><ArrowLeft size={22} /></button>
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
                  <button onClick={() => { setShowSubSettings(false); if (!locked()) archiveClient(client.status !== "archived"); }} className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-sm text-zinc-300 hover:bg-zinc-800 transition">
                    {client.status === "archived" ? <><ArchiveRestore size={15} className="text-zinc-500 shrink-0" /> Вернуть из архива</> : <><Archive size={15} className="text-zinc-500 shrink-0" /> В архив</>}
                  </button>
                  <button onClick={() => { setShowSubSettings(false); deleteClient(); }} className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition">
                    <Trash2 size={15} className="shrink-0" /> Удалить клиента
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
          <input type="file" accept="image/*" aria-label="Сменить фото клиента" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            try { patch({ avatarUrl: await fileToThumb(f, 320) }, true); }
            catch (err) { console.error("[ClientProfile] фото:", err); notify("Не удалось загрузить фото."); }
          }} />
        </label>
        {editingName ? (
          <input autoFocus value={client.name} onChange={(e) => patch({ name: e.target.value })} onBlur={() => setEditingName(false)} onKeyDown={(e) => e.key === "Enter" && setEditingName(false)} aria-label="Имя клиента"
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
      {multi ? (
        <div className={`relative mt-4 w-full flex items-center gap-3 bg-zinc-900 border rounded-2xl p-3.5 ${sub === "payments" ? "border-lime-400/50" : "border-zinc-800"}`}>
          <span className="flex gap-1.5 shrink-0">
            {multi.map((b) => {
              const pct = b.total > 0 ? Math.max(0, Math.min(1, b.remaining / b.total)) : 0;
              const c = blockColor(b);
              const on = openBlock === b.id;
              return (
                <button key={b.id} onClick={() => setOpenBlock(on ? null : b.id)} aria-expanded={on}
                  aria-label={`${blockLabel(b, clientId)}: осталось ${b.remaining}`} title={blockLabel(b, clientId)}
                  className={`anim-pop relative w-12 h-12 rounded-full transition ${c.text} ${on ? "ring-2 ring-current ring-offset-2 ring-offset-zinc-900" : ""} ${b.remaining <= 2 ? "anim-glow" : ""}`}>
                  <svg viewBox="0 0 48 48" className="w-12 h-12 -rotate-90" aria-hidden="true">
                    <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5" className="stroke-current text-zinc-800" />
                    <circle cx="24" cy="24" r="20" fill="none" strokeWidth="5" strokeLinecap="round"
                      className={`stroke-current ${b.remaining <= 2 ? "text-orange-400" : c.ring}`} strokeDasharray={`${(ringsIn ? pct : 0) * 125.7} 125.7`} style={{ transition: "stroke-dasharray .9s cubic-bezier(.22,1,.36,1)" }} />
                  </svg>
                  <span key={b.remaining} className="anim-tick absolute inset-0 flex items-center justify-center text-[15px] font-extrabold">{b.remaining}</span>
                </button>
              );
            })}
          </span>
          <button onClick={() => setSub("payments")} aria-current={sub === "payments" ? "page" : undefined} className="min-w-0 flex-1 flex items-center gap-3 text-left">
            <span className="min-w-0 flex-1">
              <span className="block font-bold">Осталось {remainingNum}</span>
              <span className="block text-sm text-zinc-500 truncate">{multi.length} блок{multi.length < 5 ? "а" : "ов"} · нажми на кольцо</span>
            </span>
            <span className={`shrink-0 h-9 px-3 rounded-xl text-sm font-semibold flex items-center ${renewTone ? "bg-orange-400/15 text-orange-300" : "bg-zinc-800 text-zinc-300"}`}>
              {renewTone ? "Продлить" : "Оплаты"}
            </span>
          </button>
          {shownBlock && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpenBlock(null)} />
              <div role="dialog" aria-label={blockLabel(shownBlock, clientId)} className="absolute left-0 right-0 top-full mt-2 z-20 bg-zinc-800 border border-zinc-700 rounded-2xl p-3.5 shadow-xl shadow-black/50">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${blockColor(shownBlock).dot}`} />
                  <span className="flex-1 font-bold">{blockLabel(shownBlock, clientId)}</span>
                  <button onClick={() => setOpenBlock(null)} aria-label="Закрыть" className="w-8 h-8 -mr-1 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-700"><X size={16} /></button>
                </div>
                <dl className="mt-1 text-sm divide-y divide-zinc-700/70">
                  {([
                    ["Осталось", `${shownBlock.remaining}${shownBlock.total ? ` из ${shownBlock.total}` : ""}`],
                    shownBlock.price ? ["Цена тренировки", `${Math.round(shownBlock.price).toLocaleString("ru-RU")} ₽`] : null,
                    shownBlock.paidAt ? ["Оплачен", fmtDate(shownBlock.paidAt)] : null,
                    shownBlock.kind === "split" ? ["Общий с", (shownBlock.clientId === clientId ? shownBlock.partnerName : shownBlock.ownerName) || "партнёром"] : null,
                  ].filter(Boolean) as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 py-2"><dt className="text-zinc-400">{k}</dt><dd className="font-semibold text-right">{v}</dd></div>
                  ))}
                </dl>
              </div>
            </>
          )}
        </div>
      ) : (
      <button onClick={() => setSub("payments")} aria-current={sub === "payments" ? "page" : undefined} className={`mt-4 w-full flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-left hover:border-zinc-700 transition ${sub === "payments" ? "border-lime-400/50" : ""}`}>
        {hasRemaining ? (
          <span className={`relative w-16 h-16 shrink-0 ${lowStock ? "anim-glow" : ""}`}>
            <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90" aria-hidden="true">
              <circle cx="32" cy="32" r="27" fill="none" strokeWidth="7" className="stroke-current text-zinc-800" />
              <circle cx="32" cy="32" r="27" fill="none" strokeWidth="7" strokeLinecap="round" className={`stroke-current ${ringColor}`}
                strokeDasharray={`${(ringsIn ? ringPct : 0) * 169.6} 169.6`} style={{ transition: "stroke-dasharray .9s cubic-bezier(.22,1,.36,1)" }} />
            </svg>
            <span key={remainingNum} className={`anim-tick absolute inset-0 flex items-center justify-center text-lg font-extrabold ${outOfStock ? "text-red-400" : ""}`}>{remainingNum}</span>
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
              : client.membership.packagePrice ? `Пакет за ${Number(client.membership.packagePrice).toLocaleString("ru-RU")} ₽` : "Нажми, чтобы оформить"}
          </span>
        </span>
        <span className={`shrink-0 h-9 px-3 rounded-xl text-sm font-semibold flex items-center ${outOfStock || lowStock || overdue ? "bg-orange-400/15 text-orange-300" : "bg-zinc-800 text-zinc-300"}`}>
          {outOfStock || lowStock || overdue ? "Продлить" : "Оплаты"}
        </span>
      </button>
      )}

      {/* Разбор путей 1.10: выдачу доступа легко забыть — кнопка жила в «Обзоре» под «Статусом» */}
      {!client.hasAccount && !client.isSelf && !noAccessHidden && (
        <div className="mt-3 flex items-center gap-2 bg-zinc-900 border border-cyan-400/30 rounded-2xl pl-4 pr-2 py-2">
          <p className="flex-1 text-sm text-zinc-300">У клиента нет кабинета: он не видит программу и не может отмечать тренировки.</p>
          <button onClick={() => { setSub("overview"); setTimeout(() => document.getElementById("invite-block")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }} className="shrink-0 h-10 px-3 rounded-xl bg-cyan-400/15 text-cyan-300 text-sm font-semibold hover:bg-cyan-400/25 transition">Выдать доступ</button>
          <button onClick={() => { try { localStorage.setItem(`reps-noaccess-hidden-${clientId}`, "1"); } catch { /* приватный режим */ } setNoAccessHidden(true); }} aria-label="Не нужно" title="Не нужно" className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200"><X size={16} /></button>
        </div>
      )}
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
        <div className="w-full flex items-center gap-2 rounded-xl px-3.5 py-2.5 mt-3 text-sm bg-cyan-400/10 text-cyan-300 border border-cyan-400/20">
          <Play size={14} className="shrink-0 text-cyan-400" />
          <span className="flex-1 font-medium">Сейчас тренируется: <span className="text-cyan-100">{client.activeSession.dayName}</span></span>
          <span className="text-xs text-cyan-500">{(() => { const s = Math.floor((Date.now() - client.activeSession.startedAt) / 1000); const m = Math.floor(s / 60); return m > 0 ? `${m} мин` : "только начал"; })()}</span>
        </div>
      )}

      {/* Разделы карточки — четыре плитки в ряд, порядок фиксирован */}
      <div className="relative grid grid-cols-4 gap-1.5 mt-3 mb-4 p-1.5 bg-zinc-900 border border-zinc-800 rounded-2xl">
        {/* Этап 12: подсветка переезжает к выбранной вкладке, а не прыгает */}
        {TABS.some((t) => t.k === sub) && (
          <span aria-hidden="true" className="absolute top-1.5 bottom-1.5 left-1.5 rounded-xl bg-lime-400 transition-transform duration-300"
            style={{ width: "calc((100% - 0.75rem - 1.125rem) / 4)", transform: `translateX(calc(${TABS.findIndex((t) => t.k === sub)} * (100% + 0.375rem)))`, transitionTimingFunction: "cubic-bezier(.22,1,.36,1)" }} />
        )}
        {TABS.map((t) => {
          const active = sub === t.k;
          return (
            <button key={t.k} onClick={() => setSub(t.k)} aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 h-14 rounded-xl text-[13px] font-semibold transition ${active ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"}`}>
              <t.icon size={18} className="shrink-0" />
              <span className="truncate max-w-full px-0.5">{t.label}</span>
            </button>
          );
        })}
      </div>

      {sub === "bookings" && <BookingsTab clientId={clientId} bookings={bookings ?? []} onOpenOccurrence={onOpenOccurrence} onBook={onBookClient ? () => onBookClient(clientId) : undefined} />}
      {sub === "payments" && <MembershipTab client={client} patchMembership={patchMembership} setMembership={setMembership} clientId={clientId} trainerId={trainerId} />}
      {sub === "overview" && <OverviewTab client={client} patch={patch} patchHealth={patchHealth} notes={notes} notesFailed={!!failed.notes} onRetry={() => retry.current("notes")} clientId={clientId} setNotes={setNotes} tgLink={tgLink} waLink={waLink} trainerId={trainerId} />}
      {sub === "reporting" && <ReportingTab clientId={clientId} failed={failed} onRetry={(p) => retry.current(p)} measurements={measurements} setMeasurements={setMeasurements} nutritionLogs={nutritionLogs} photos={photos} setPhotos={setPhotos} activities={activities} setActivities={setActivities} />}
      {sub === "plans" && <PlansTab trainerId={trainerId} clientId={clientId} failed={!!failed.plans} onRetry={() => retry.current("plans")} clientName={client.name} allPlans={allPlans ?? []} plans={plans} setPlans={setPlans} onOpenPlan={onOpenPlan} />}
    </div>
  );
}

function InviteBlock({ clientId, email, hasAccount, onFixEmail }: { clientId: string; email: string; hasAccount: boolean; onFixEmail: (email: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Ссылка-приглашение из ответа register-client: живёт только в этом окне, повторно её не показать —
  // для новой есть «Выслать заново»
  const [link, setLink] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [created, setCreated] = useState(false);
  const check = checkEmail(email);
  const issued = hasAccount || created;

  const invite = async (resend: boolean) => {
    if (resend && !(await ask("Выслать ссылку заново? Будет новая ссылка, старая перестанет работать. Сработает, только если клиент ещё не задал пароль.", { ok: "Выслать" }))) return;
    setBusy(true); setMsg(""); setLink("");
    try {
      // Почта в поле сохраняется с задержкой — записываем сразу, функция читает адрес из базы.
      await api.updateClient(clientId, { email });
      const res = await api.inviteClient(clientId, resend);
      setCreated(true);
      // Ссылка бывает, только если клиент ни разу не входил; иначе он входит своим паролем.
      // linked — повтор после сбоя, показываем как обычную выдачу. Отказ (409, 426 — старая версия) — текст сервера в catch
      if (res.link) { setLink(res.link); setEmailSent(!!res.emailSent); }
      else if (res.status === "already") setMsg("Доступ уже выдан. Если клиент забыл пароль — пусть нажмёт «Забыли пароль?» на экране входа.");
      else setMsg("Доступ выдан.");
    } catch (e) {
      setMsg(humanError(e, "Не удалось выдать доступ. Попробуй ещё раз"));
    } finally { setBusy(false); }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); notify("Ссылка скопирована"); }
    catch { await askInput("Скопируй вручную", [{ key: "link", label: "Ссылка для клиента", value: link }], { ok: "Готово" }); }
  };
  // Системное «Поделиться» (телефон) — сразу в мессенджер; отмена окна — не ошибка
  const shareLink = () => navigator.share({ title: "Вход в Reps", text: "Ссылка для входа в кабинет Reps — по ней задашь пароль:", url: link })
    .catch((e) => { if ((e as Error)?.name !== "AbortError") copyLink(); });

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
          <Send size={14} /> {busy ? "Создаём ссылку..." : "Выдать доступ клиенту"}
        </button>
      ) : (
        <button onClick={() => invite(true)} disabled={!email || !!check.error || busy} className={`${btn} bg-zinc-800 text-zinc-100 hover:bg-zinc-700`}>
          <Send size={14} /> {busy ? "Создаём ссылку..." : "Выслать заново"}
        </button>
      )}
      {link && (
        <div className="rounded-xl bg-zinc-800/60 border border-zinc-700 p-3 space-y-2 mt-1">
          <p className="text-xs text-zinc-300">Отправь ссылку клиенту в мессенджер. По ней клиент сам задаст пароль. Ссылка одноразовая.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyLink} className={`${btn} bg-lime-400 text-zinc-950 hover:bg-lime-300`}><Copy size={14} /> Скопировать ссылку</button>
            {typeof navigator.share === "function" && (
              <button type="button" onClick={shareLink} className={`${btn} bg-zinc-700 text-zinc-100 hover:bg-zinc-600`}><Share2 size={14} /> Поделиться</button>
            )}
          </div>
          {emailSent && <p className="text-[11px] text-zinc-500">Ссылка также отправлена на почту.</p>}
        </div>
      )}
      {msg && <p role="status" className="text-[11px] text-cyan-400">{msg}</p>}
    </div>
  );
}

function OverviewTab({ client, patch, patchHealth, notes, notesFailed, onRetry, setNotes, clientId, tgLink, waLink }: {
  client: ClientFull; patch: (p: Partial<ClientFull>, immediate?: boolean) => void; patchHealth: (p: Partial<ClientFull["health"]>) => void;
  notes: ClientNote[]; notesFailed: boolean; onRetry: () => void; setNotes: (n: ClientNote[]) => void; clientId: string; tgLink: string; waLink: string;
  trainerId: string;
}) {
  const [noteText, setNoteText] = useState("");
  // 0.4: двойной Enter давал две заметки, ошибка сохранения молчала
  const [noteBusy, setNoteBusy] = useState(false);
  const addNote = async () => {
    if (noteBusy || !noteText.trim()) return;
    setNoteBusy(true);
    try {
      await api.addNote(clientId, noteText.trim());
      setNoteText("");
      api.fetchNotes(clientId).then(setNotes).catch((e) => console.error("[ClientProfile] fetchNotes:", e));
    } catch (e) { console.error("[ClientProfile] addNote:", e); notify(humanError(e, "Не удалось сохранить заметку"), "error"); }
    finally { setNoteBusy(false); }
  };
  const deleteNote = async (id: string) => {
    if (!(await ask("Удалить заметку?", { ok: "Удалить", danger: true }))) return;
    try { await api.deleteNote(id); setNotes(notes.filter((n) => n.id !== id)); }
    catch (e) { console.error("[ClientProfile] deleteNote:", e); notify(humanError(e, "Не удалось удалить"), "error"); }
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
        <div id="invite-block"><InviteBlock clientId={clientId} email={client.email} hasAccount={client.hasAccount} onFixEmail={(email) => patch({ email })} /></div>
        <p className="text-[11px] text-zinc-600 -mt-1">{client.hasAccount ? "Доступ уже выдан. Если клиент ещё не задал пароль — вышли ссылку заново, старая перестанет работать." : "Дадим ссылку для клиента — по ней он сам задаст пароль."}</p>
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
          <button onClick={addNote} disabled={noteBusy} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg px-3 text-sm transition disabled:opacity-50">{noteBusy ? "…" : "Добавить"}</button>
        </div>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {notesFailed ? <LoadError onRetry={onRetry} /> : notes.length === 0 && <p className="text-xs text-zinc-600">Заметок пока нет</p>}
          {notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 bg-zinc-800/40 rounded-xl px-3 py-2 text-sm">
              <span className="text-zinc-500 text-xs shrink-0 w-20">{fmtDate(n.date)}</span>
              <span className="flex-1 text-zinc-200">{n.text}</span>
              <button onClick={() => deleteNote(n.id)} aria-label="Удалить заметку" className="p-1 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReportingTab({ clientId, failed, onRetry, measurements, setMeasurements, nutritionLogs, photos, setPhotos, activities, setActivities, measureTick }: {
  measureTick?: number;
  clientId: string;
  failed: Partial<Record<Part, boolean>>; onRetry: (p: Part) => void;
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
  // 0.2: внутренняя вкладка «Отчётов» — на время сессии, своя у каждого клиента
  const [reportSub, setReportSubState] = useState<ReportSub>(() => loadViewState<ReportSub>(`report-sub:${clientId}`, "goals"));
  const setReportSub = (s: ReportSub) => { setReportSubState(s); saveViewState(`report-sub:${clientId}`, s); };
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
      {reportSub === "body" && <BodyTab clientId={clientId} loadFailed={!!failed.measurements} onRetry={() => onRetry("measurements")} measurements={measurements} setMeasurements={setMeasurements} openForm={!!measureTick} />}
      {reportSub === "nutrition" && <NutritionDiary clientId={clientId} legacyLogs={nutritionLogs} measurements={measurements} asTrainer />}
      {reportSub === "activity" && <ActivityTab clientId={clientId} activities={activities} setActivities={setActivities} readOnly loadFailed={!!failed.activities} onRetry={() => onRetry("activities")} />}
      {reportSub === "photos" && <PhotosTab clientId={clientId} photos={photos} setPhotos={setPhotos} loadFailed={!!failed.photos} onRetry={() => onRetry("photos")} />}
      {reportSub === "goals" && <GoalsDashboard clientId={clientId} />}
    </div>
  );
}

function MembershipTab({ client, patchMembership, setMembership, clientId, trainerId }: { client: ClientFull; patchMembership: (p: paymentsApi.MembershipSettings, immediate?: boolean) => void; setMembership: (m: ClientFull["membership"]) => void; clientId: string; trainerId: string }) {
  const m = client.membership;
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsFailed, setPaymentsFailed] = useState(false);
  const [showPromotions, setShowPromotions] = useState(false);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const [otherClients, setOtherClients] = useState<api.ClientListItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Дата нового платежа — по умолчанию сегодня. Раньше поле показывало и отправляло
  // дату прошлой оплаты из абонемента, и продление записывалось задним числом.
  const [payDate, setPayDate] = useState(today);
  const [showPkg, setShowPkg] = useState(false);
  const [payMenu, setPayMenu] = useState<string | null>(null);

  const loadPayments = () => api.fetchPayments(clientId).then((v) => { setPayments(v); setPaymentsFailed(false); })
    .catch((e) => { console.error("[PaymentsTab] fetchPayments:", e); setPaymentsFailed(true); });
  // Ревью 5.7: акции не загрузились — не молчим, оплата иначе молча пойдёт без скидки
  const [promosFailed, setPromosFailed] = useState(false);
  const loadPromotions = () => paymentsApi.fetchPromotions(clientId).then((v) => { setPromotions(v); setPromosFailed(false); })
    .catch((e) => { console.error("[ClientProfile] акции:", e); setPromosFailed(true); });
  const load = () => {
    paymentsApi.fetchPackageTemplates(trainerId).then(setTemplates).catch((e) => console.error("[PaymentsTab] fetchTemplates:", e));
    loadPromotions();
    loadPayments();
    api.fetchClients(trainerId).then((cs) => setOtherClients(cs.filter((c) => c.id !== clientId))).catch((e) => console.error("[ClientProfile] список подопечных:", e));
  };
  useEffect(load, [clientId, trainerId]);
  // Этап 11: список оплаченных блоков — перечитываем после оплаты/удаления платежа (меняется остаток)
  const [tabBlocks, setTabBlocks] = useState<Block[]>([]);
  useEffect(() => { let alive = true; fetchBlocks(clientId).then((b) => { if (alive) setTabBlocks(b); }); return () => { alive = false; }; }, [clientId, m.remaining, m.remainingTotal]);
  // Закончившиеся — серым, не больше двух последних
  const shownTabBlocks = [...activeBlocks(tabBlocks), ...tabBlocks.filter((b) => b.remaining === 0).slice(-2)];

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

  const isSub = m.type === "subscription";
  const tplPrice = (t: PackageTemplate) => (t.discount ? Math.round(t.price * (1 - t.discount / 100)) : t.price);
  // 5.6: шаблон выбирается только для этой оплаты — пакет клиента записывается вместе с ней (p_package),
  // а не сразу по тапу. pm — пакет этой оплаты: выбранный шаблон или сохранённый пакет.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = isSub ? undefined : templates.find((t) => t.id === pickedId);
  const pm = picked ? { ...m, total: String(picked.sessions), packagePrice: String(tplPrice(picked)), split: picked.split } : m;
  const basePrice = isSub ? Number(pm.pricePerSession) || 0 : Number(pm.packagePrice) || 0;
  // 5.7: акция — действующая на дату оплаты
  const preview = paymentsApi.applyPromotion(basePrice, promotions, isSub ? "subscription" : "sessions", payDate);
  const activePromo = !!preview.promo;

  // 5.5: у шаблона без цены сначала спрашиваем цену и сохраняем её в шаблон; повторный тап снимает выбор
  const pickTemplate = async (t: PackageTemplate) => {
    if (pickedId === t.id) { setPickedId(null); return; }
    if (!t.price) {
      const r = await askInput(`Цена «${t.name}»`, [{ key: "price", label: "Цена пакета, ₽", placeholder: "24000", numeric: true }], { ok: "Сохранить" });
      if (!r) return;
      const price = Math.round(Number(r.price.replace(",", ".").replace(/\s/g, "")));
      if (!(price > 0)) { notify("Укажи цену больше 0 ₽."); return; }
      try {
        await paymentsApi.updatePackageTemplate(t.id, { name: t.name, sessions: t.sessions, price, discount: t.discount, split: t.split });
        setTemplates((ts) => ts.map((x) => (x.id === t.id ? { ...x, price } : x)));
      } catch (e) { console.error("[PaymentsTab] цена шаблона:", e); notify(humanError(e, "Не удалось сохранить цену"), "error"); return; }
    }
    setPickedId(t.id);
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
  // Этап 12: после записи оплаты кнопка 1,6 с показывает галочку «Записано»
  const [paidOk, setPaidOk] = useState(false);
  const flashPaid = () => { setPaidOk(true); setTimeout(() => setPaidOk(false), 1600); };
  // П17: ключ от повторов. Живёт до успешной записи: если ответ потерялся и тренер жмёт
  // «Оплачено» ещё раз, сервер узнает тот же id и второй платёж не создаст.
  // Ревью 5.3: ключ один на попытку оплаты, какую бы кнопку ни нажали после сбоя — иначе смена
  // кнопки после потерянного ответа записала бы второй платёж и второй раз начислила пакет.
  // kind — чем записан платёж с этим id (известно после ответа сервера); res — отданная часть
  // «Частями» уже записана, а остаток ещё нет (повтор допишет только остаток).
  type PayKey = { kind: string; id: string; restId: string; res?: Awaited<ReturnType<typeof paymentsApi.markPaid>> };
  const payKey = useRef<PayKey | null>(null);
  const keyFor = (kind: string) => {
    if (!payKey.current) payKey.current = { kind, id: crypto.randomUUID(), restId: crypto.randomUUID() };
    return payKey.current;
  };
  const restPending = () => { if (!payKey.current?.res) return false; notify("Сначала допиши остаток: нажми «Частями» с той же суммой.", "error"); return true; };
  const doMarkPaid = async (payStatus: paymentsApi.PayStatus) => {
    if (payLock.current || restPending()) return;
    payLock.current = true; setPaying(true);
    const first = !payKey.current;
    const key = keyFor(payStatus);
    const { id } = key;
    try {
      // Этап 11: пакет другого вида или цены станет вторым блоком — предупредить (только при первой попытке)
      if (first && !(await confirmNewBlock(clientId, pm))) { payKey.current = null; return; }
      // Настройки пакета оплата берёт с экрана (p_package) — недосохранённый ввод не мешает
      const res = await paymentsApi.markPaid(clientId, { ...pm, paymentDate: payDate }, promotions, payStatus, id);
      // Дошла прошлая попытка «Частями» (записана только часть) — остаток ещё не записан, ключ держим
      if (res.duplicate && key.kind !== payStatus) {
        const row = await paymentsApi.fetchPaymentRow(id).catch(() => null);
        if (row?.payStatus === "paid" && row.amount < preview.amount) {
          payKey.current = { ...key, kind: `installment:${Math.round(row.amount)}`, res };
          setMembership(res.membership);
          notify(`Эта оплата записана как часть ${rub(row.amount)} «Частями». Нажми «Частями» с этой суммой, чтобы дописать остаток.`, "error");
          return;
        }
      }
      payKey.current = null;
      afterPaid(res);
      if (res.duplicate) notify(key.kind === payStatus ? "Эта оплата уже была записана — повтор не создан." : "Эта оплата уже была записана другой кнопкой — повтор не создан. Проверь журнал платежей.");
      else {
        track("action", "payment", { status: payStatus, via: "profile" });
        if (payStatus === "paid") flashPaid();
        // Аудит п. 40: без подтверждения (частое действие), но с отменой — удаляем этот же платёж.
        // Сплит и подписку отменой не откатить: delete_payment не трогает строку партнёра и дату подписки.
        const text = payStatus === "paid" ? "Оплата записана" : payStatus === "deferred" ? "Записано: оплата позже" : "Записано: оплата частями";
        notify(text + (res.promoOff ? " · разовая акция выключена" : ""), "info", canUndo ? { label: "Отменить", run: () => undoPayment([id], res.promoOff) } : undefined);
      }
    }
    catch (e) { console.error("[PaymentsTab] doMarkPaid:", e); notify("Не удалось записать оплату."); }
    finally { payLock.current = false; setPaying(false); }
  };
  const canUndo = !isSub && !m.split && !pm.split;
  // После записи: абонемент с сервера, выбор шаблона сброшен (5.6), журнал и акции (5.7) — заново
  const afterPaid = (res: { membership: ClientFull["membership"]; promoOff: string | null }) => {
    setMembership(res.membership);
    setPickedId(null);
    api.fetchPayments(clientId).then(setPayments).catch((e) => console.error("[PaymentsTab] fetchPayments:", e));
    if (res.promoOff) loadPromotions();
  };
  // Отмена только что записанной оплаты — как «Удалить платёж»: сервер вернёт остаток.
  // Выключенную разовую акцию включаем обратно.
  const undoPayment = async (ids: string[], promoId: string | null) => {
    try {
      // Сначала остаток, потом платёж с начислением: сбой посередине не оставит долг без пакета
      for (const id of [...ids].reverse()) setMembership(await paymentsApi.deletePayment(id, clientId));
      if (promoId) paymentsApi.togglePromotion(promoId, true).then(loadPromotions).catch((e) => { console.error("[PaymentsTab] акция:", e); notify("Оплата отменена, но разовую акцию включить не удалось — включи её в «Акциях».", "error"); });
      api.fetchPayments(clientId).then(setPayments).catch((e) => console.error("[PaymentsTab] fetchPayments:", e));
    }
    catch (e) { console.error("[PaymentsTab] undoPayment:", e); notify(humanError(e, "Не удалось отменить оплату"), "error"); }
  };

  // 5.3: «Частями» — сколько отдал сейчас и до какого числа остаток. Отданная часть — оплата
  // через record_payment (он же начисляет пакет), остаток — строка installment датой оплаты
  // со сроком due_date. Срок по умолчанию +14 дней: пакет обычно расходуется за месяц, и остаток
  // приходит, пока не пройдена половина пакета, а не когда тренировки уже закончились.
  const doInstallment = async () => {
    if (payLock.current) return;
    // Сплит с привязанным партнёром — как раньше: вся сумма «частями», сервер делит её 50/50
    if (pm.split && m.partnerClientId) return doMarkPaid("installment");
    const total = preview.amount;
    const r = await askInput(`Частями · ${rub(total)}`, [
      { key: "part", label: "Сколько отдал сейчас, ₽", placeholder: "0", numeric: true },
      { key: "until", label: "Остаток — до", value: addDays(payDate, 14), date: true },
    ], { ok: "Записать" });
    if (!r) return;
    const part = Math.round(Number(r.part.replace(",", ".").replace(/\s/g, "")) || 0);
    if (part < 0 || part > total) { notify(`Часть — от 0 до ${rub(total)}.`); return; }
    if (part === total) return doMarkPaid("paid");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.until)) { notify("Укажи дату, до которой клиент отдаст остаток."); return; }
    if (payLock.current) return;
    const kind = `installment:${part}`;
    if (payKey.current?.res && payKey.current.kind !== kind) { notify(`Отданная часть уже записана — нажми «Частями» с суммой ${rub(Number(payKey.current.kind.split(":")[1]))}.`, "error"); return; }
    payLock.current = true; setPaying(true);
    const first = !payKey.current;
    // Ключи от повторов (см. keyFor): живут до успеха обеих записей
    const key = keyFor(kind);
    const { id, restId } = key;
    try {
      if (first && !(await confirmNewBlock(clientId, pm))) { payKey.current = null; return; }
      // Ничего не отдал — одна строка «частями» на всю сумму датой оплаты, срок — в due_date
      const res = key.res ?? await paymentsApi.markPaid(clientId, { ...pm, paymentDate: payDate }, promotions, part > 0 ? "paid" : "installment", id, part > 0 ? part : undefined);
      // Ответ прошлой попытки потерялся. Какая из попыток дошла до базы — смотрим по самой строке:
      // это «Частями» с той же частью — дописываем остаток (обе записи идемпотентны), иначе не пишем.
      if (res.duplicate && !key.res) {
        const row = await paymentsApi.fetchPaymentRow(id);
        const same = !!row && (part > 0 ? row.payStatus === "paid" && Math.round(row.amount) === part : row.payStatus === "installment");
        if (!same) {
          payKey.current = null; afterPaid(res);
          notify("Эта оплата уже была записана другой кнопкой — повтор не создан. Проверь журнал платежей.");
          return;
        }
      }
      key.kind = kind;
      key.res = res;
      if (part > 0) await paymentsApi.addInstallmentRest(restId, clientId, { date: payDate, dueDate: r.until, amount: total - part, type: isSub ? "subscription" : "sessions" });
      else await paymentsApi.updatePayment(id, { due_date: r.until });
      payKey.current = null;
      afterPaid(res);
      track("action", "payment", { status: "installment", via: "profile" });
      const ids = part > 0 ? [id, restId] : [id];
      notify(`${part > 0 ? `Записано: ${rub(part)} сейчас, остаток до ${fmtDate(r.until)}` : `Записано: частями до ${fmtDate(r.until)}`}${res.promoOff ? " · разовая акция выключена" : ""}`, "info",
        canUndo ? { label: "Отменить", run: () => undoPayment(ids, res.promoOff) } : undefined);
    }
    catch (e) {
      console.error("[PaymentsTab] doInstallment:", e);
      if (key.res) { setMembership(key.res.membership); notify("Отданная часть записана, а срок остатка — нет. Нажми «Частями» ещё раз с той же суммой.", "error"); }
      else notify("Не удалось записать оплату.");
    }
    finally { payLock.current = false; setPaying(false); }
  };
  const paidLock = useRef(new Set<string>());
  const [markingIds, setMarkingIds] = useState<string[]>([]);
  const doMarkPaymentPaid = async ({ id, payStatus: prev, date: prevDate }: Payment) => {
    if (paidLock.current.has(id)) return;
    paidLock.current.add(id); setMarkingIds((l) => [...l, id]);
    const reload = () => api.fetchPayments(clientId).then(setPayments).catch((e) => console.error("[PaymentsTab] fetchPayments:", e));
    try {
      // 5.4: дата — сегодня, чтобы долг попал в «Поступило» этого месяца
      await paymentsApi.markPaymentPaid(id); reload();
      // Новый платёж здесь не создаётся — отмена возвращает прежние статус («позже»/«частями») и дату
      notify("Оплата записана", "info", { label: "Отменить", run: () => { paymentsApi.markPaymentPaid(id, prev, prevDate).then(reload).catch((e) => { console.error("[PaymentsTab] undo markPaymentPaid:", e); notify(humanError(e, "Не удалось отменить оплату"), "error"); }); } });
    }
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

  const total = Number(m.total) || 0;
  const pkgPrice = Number(m.packagePrice) || 0;
  const perSession = !isSub && total > 0 && pkgPrice > 0 ? Math.round(pkgPrice / total) : 0;
  const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
  // Шаблон, совпавший с сохранённым пакетом; отмечен выбранный (5.6), а если не выбран — совпавший или сам текущий
  const matchedTpl = templates.find((t) => t.sessions === total && tplPrice(t) === pkgPrice && !!t.split === !!m.split);
  const selectedId = picked ? picked.id : matchedTpl?.id;
  const payAmount = preview.amount;

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
              : [perSession ? `${rub(perSession)} за тренировку` : "Нажми, чтобы указать количество и цену", m.split ? (m.partnerName ? `сплит с ${m.partnerName}` : "сплит") : ""].filter(Boolean).join(" · ")}
          </span>
        </span>
        <Settings2 size={19} className="text-zinc-500 shrink-0" />
      </button>
      {activeBlocks(tabBlocks).length >= 2 ? (
        <div className="space-y-1.5 -mt-1">
          {shownTabBlocks.map((b) => (
            <div key={b.id} className={`flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl px-3.5 py-2.5 ${b.remaining === 0 ? "opacity-50" : ""}`}>
              <span className={`shrink-0 min-w-[28px] h-7 px-1.5 rounded-full bg-zinc-800 text-sm font-extrabold flex items-center justify-center ${b.remaining === 0 ? "text-zinc-500" : blockColor(b).text}`}>{b.remaining}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold truncate">{blockLabel(b, clientId)}</span>
                <span className="block text-[13px] text-zinc-500 truncate">{b.remaining === 0 ? "закончился" : [`${b.remaining} из ${b.total}`, b.price ? `по ${rub(Math.round(b.price))}` : "", b.paidAt ? `с ${fmtDate(b.paidAt)}` : ""].filter(Boolean).join(" · ")}</span>
              </span>
            </div>
          ))}
        </div>
      ) : Number(m.extraRemaining) > 0 && (
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
                <span className={`shrink-0 min-w-[8.5rem] rounded-xl bg-zinc-800 px-3 py-2.5 ${picked ? "" : "ring-2 ring-inset ring-lime-400"}`}>
                  <span className="block font-semibold">{total} тренировок</span>
                  <span className="block text-[13px] text-zinc-400">{pkgPrice ? rub(pkgPrice) : "цена не указана"} · текущий</span>
                </span>
              )}
              {templates.map((t) => (
                <button key={t.id} onClick={() => pickTemplate(t)} aria-pressed={selectedId === t.id}
                  className={`shrink-0 min-w-[8.5rem] text-left rounded-xl bg-zinc-800 px-3 py-2.5 transition ${selectedId === t.id ? "ring-2 ring-inset ring-lime-400" : "hover:bg-zinc-700"}`}>
                  <span className="block font-semibold truncate">{t.name}</span>
                  {t.price
                    ? <span className="block text-[13px] text-zinc-400">{t.sessions} тр. · {rub(tplPrice(t))}{t.discount ? ` · −${t.discount}%` : ""}</span>
                    : <span className="block text-[13px] text-orange-300">цена не указана →</span>}
                </button>
              ))}
              <button onClick={() => { setPickedId(null); setShowPkg(true); }} className="shrink-0 min-w-[6.5rem] text-left rounded-xl bg-zinc-800 px-3 py-2.5 hover:bg-zinc-700 transition">
                <span className="block font-semibold">Свой</span>
                <span className="block text-[13px] text-zinc-400">кол-во и цена</span>
              </button>
            </div>
          )}
          <DateField label="Дата оплаты" value={payDate} onChange={(e) => setPayDate(e.target.value || today())} />
          <button onClick={() => doMarkPaid("paid")} disabled={!basePrice || paying}
            className="w-full h-12 flex items-center justify-center gap-2 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98] disabled:opacity-40">
            {paying ? <><span className="w-[18px] h-[18px] rounded-full border-[2.5px] border-current border-t-transparent animate-spin" /> Сохраняю…</>
              : paidOk ? <span key="ok" className="anim-pop flex items-center gap-2"><Check size={18} strokeWidth={2.75} className="anim-draw" /> Записано</span>
              : <><Check size={18} strokeWidth={2.75} /> {basePrice ? `Оплачено · ${rub(payAmount)}` : "Укажи цену пакета"}</>}
          </button>
          {preview.promo && preview.amount !== basePrice && <p className="text-[13px] text-orange-300 text-center -mt-1">{preview.label}: вместо {rub(basePrice)}</p>}
          {promosFailed && (
            <p role="alert" className="text-[13px] text-orange-300 text-center -mt-1">Акции не загрузились — оплата пойдёт без скидки · <button onClick={loadPromotions} className="font-semibold underline underline-offset-2 min-h-[28px]">Повторить</button></p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => doMarkPaid("deferred")} disabled={!basePrice || paying} title="Блок начислен, оплата ожидается"
              className="h-11 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold transition disabled:opacity-40"><Clock size={16} className="text-orange-300" /> Позже</button>
            <button onClick={doInstallment} disabled={!basePrice || paying} title="Часть сейчас, остаток — до выбранной даты"
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
        {paymentsFailed ? <LoadError onRetry={loadPayments} /> : payments.length === 0 ? (
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
                  {/* 5.3: срок «частями» — только у строк с due_date; просрочка — оранжевым */}
                  <p className={`text-[13px] truncate ${p.dueDate && p.payStatus !== "paid" && p.dueDate < today() ? "text-orange-400" : "text-zinc-400"}`}>{[fmtDate(p.date), p.dueDate && p.payStatus !== "paid" ? `до ${fmtDate(p.dueDate)}` : "", p.type === "subscription" ? "подписка" : "пакет", p.promoApplied, p.note].filter(Boolean).join(" · ")}</p>
                </div>
                {p.payStatus !== "paid" && (
                  <button onClick={() => doMarkPaymentPaid(p)} disabled={markingIds.includes(p.id)} title="Отметить оплаченным" className="h-9 px-2.5 rounded-lg text-[13px] font-semibold text-lime-400 hover:bg-lime-400/10 transition shrink-0 disabled:opacity-50">{markingIds.includes(p.id) ? "Сохраняю…" : "Оплачен"}</button>
                )}
                <button onClick={() => setPayMenu(payMenu === p.id ? null : p.id)} aria-label="Действия с платежом" aria-expanded={payMenu === p.id}
                  className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition"><MoreHorizontal size={19} /></button>
                {payMenu === p.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPayMenu(null)} />
                    <div className="absolute right-2 bottom-full -mb-1 z-20 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 w-48 shadow-xl">
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

function PhotosTab({ clientId, photos, setPhotos, loadFailed, onRetry }: { clientId: string; photos: Photo[]; setPhotos: (p: Photo[]) => void; loadFailed: boolean; onRetry: () => void }) {
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
  const remove = async (id: string) => {
    if (!(await ask("Удалить фото?", { ok: "Удалить", danger: true }))) return;
    try { await api.deletePhoto(id); setPhotos(photos.filter((p) => p.id !== id)); }
    catch (e) { console.error("[PhotosTab] remove:", e); notify(humanError(e, "Не удалось удалить"), "error"); }
  };

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

      {loadFailed ? <LoadError onRetry={onRetry} /> : sorted.length === 0 ? <p className="text-sm text-zinc-600 text-center py-8">Фото пока нет. Загрузи снимок «до», чтобы потом сравнить прогресс.</p> : (
        <div className="grid grid-cols-3 gap-2">
          {[...sorted].reverse().map((p) => (
            <div key={p.id} className="relative group">
              <img src={p.url} alt="" className="w-full h-32 object-cover rounded-xl bg-zinc-800" />
              <div className="absolute bottom-1 left-1 right-1 text-[11px] text-white bg-black/50 rounded-lg px-1 py-0.5 text-center">{fmtDate(p.date)}</div>
              <button onClick={() => remove(p.id)} aria-label="Удалить фото" className="absolute top-1 right-1 p-1.5 rounded-lg bg-black/50 text-white hover:bg-red-500 transition"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlansTab({ trainerId, clientId, failed, onRetry, clientName, allPlans, plans, setPlans, onOpenPlan }: { trainerId: string; clientId: string; failed: boolean; onRetry: () => void; clientName: string; allPlans: PlanOverviewItem[]; plans: PlanListItem[] | null; setPlans: (p: PlanListItem[]) => void; onOpenPlan: (id: string) => void }) {
  const [name, setName] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const createPlan = async () => {
    if (!name.trim()) return;
    try {
      const row = await api.addPlan(trainerId, clientId, name.trim());
      if (row.visible_to_client === false) notify("План создан скрытым: у клиента уже есть действующий. Когда допишешь — «Сделать активным».", "info");
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
      notify("Копия создана скрытой от клиента. Допиши её и нажми «Сделать активным».", "info");
      api.fetchClientPlans(clientId).then(setPlans).catch((e) => console.error("[ClientProfile] fetchPlans:", e));
    } catch (err) { console.error("[ClientProfile] duplicate:", err); notify("Не удалось дублировать план."); }
    finally { setDupId(null); }
  };
  // Разбор путей 3.26: какой план видит клиент — самый новый видимый действующий (список уже
  // от новых к старым, как у клиента). Его помечаем, остальные можно сделать активными или убрать в архив.
  const activeId = plans?.find((p) => !p.archived && p.visibleToClient !== false)?.id;
  const [planBusy, setPlanBusy] = useState<string | null>(null);
  const reloadPlans = () => api.fetchClientPlans(clientId).then(setPlans).catch((e) => console.error("[ClientProfile] fetchPlans:", e));
  const activate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (planBusy) return;
    setPlanBusy(id);
    try { await makePlanActive(id); notify("Теперь клиент видит этот план", "info"); }
    catch (err) { console.error("[ClientProfile] activate:", err); notify("Не удалось сделать план активным."); }
    finally { setPlanBusy(null); reloadPlans(); }
  };
  const toggleArchive = async (id: string, archived: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (planBusy) return;
    setPlanBusy(id);
    if (!archived && id === activeId && !(await ask("Это план, который видит клиент. После архива у него не будет программы, пока не сделаешь активным другой. Убрать в архив?", { ok: "В архив" }))) { setPlanBusy(null); return; }
    try { await setPlanArchived(id, !archived, clientId); }
    catch (err) { console.error("[ClientProfile] archive:", err); notify(archived ? "Не удалось вернуть план из архива." : "Не удалось убрать план в архив."); }
    finally { setPlanBusy(null); reloadPlans(); }
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

      {plans === null && failed ? <LoadError onRetry={onRetry} /> : plans === null ? (
        <SkeletonRows />
      ) : (
        <div className="space-y-2">
          {plans.length === 0 && <p className="text-zinc-600 text-sm text-center py-8">Планов пока нет</p>}
          {plans.map((p) => (
            <button key={p.id} onClick={() => onOpenPlan(p.id)} className="w-full text-left bg-zinc-900 border border-zinc-800 rounded-2xl p-3 hover:border-zinc-700 transition flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-medium truncate">{p.name}</span>
                {p.id === activeId ? <span className="text-xs text-lime-400">Клиент видит этот план</span>
                  : !p.archived && <span className="text-xs text-zinc-500">{p.visibleToClient === false ? "Скрыт от клиента" : "Клиент видит более новый план"}</span>}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {p.archived && <span className="text-xs bg-zinc-700 text-zinc-400 rounded-lg px-1.5 py-0.5">архив</span>}
                {p.id !== activeId && (
                  <span role="button" tabIndex={0} onClick={(e) => activate(p.id, e)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(p.id, e as unknown as React.MouseEvent); } }} className={`h-8 px-2 inline-flex items-center rounded-lg text-xs font-semibold bg-lime-400/15 text-lime-400 hover:bg-lime-400/25 transition ${planBusy === p.id ? "opacity-40" : ""}`}>Сделать активным</span>
                )}
                <span role="button" tabIndex={0} onClick={(e) => toggleArchive(p.id, p.archived, e)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleArchive(p.id, p.archived, e as unknown as React.MouseEvent); } }} className={`p-1 rounded-lg hover:bg-zinc-700 hover:text-zinc-200 text-zinc-500 transition ${planBusy === p.id ? "opacity-40" : ""}`} title={p.archived ? "Вернуть из архива" : "В архив"} aria-label={p.archived ? "Вернуть из архива" : "В архив"}>{p.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</span>
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
