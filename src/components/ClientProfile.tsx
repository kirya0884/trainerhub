import { AlertTriangle, ArrowLeft, Apple, CalendarCheck, Camera, CheckCircle2, ClipboardList, HeartPulse, MessageCircle, MessageSquare, Pencil, Percent, Phone, Play, Plus, Printer, Receipt, Ruler, Scissors, Send, Settings, Trash2, TrendingUp, Users, Wallet, Images, X , Target } from "lucide-react";
import { useEffect, useState } from "react";
import { GOALS } from "../constants";
import * as api from "../lib/clients";
import type { ClientFull, ClientNote, Measurement, Payment, PlanListItem, Photo } from "../lib/clients";
import * as paymentsApi from "../lib/payments";
import type { PackageTemplate, Promotion } from "../lib/payments";
import { fmtDate, today } from "../lib/format";
import { fileToThumb } from "../lib/thumb";
import { useDebouncedPersist } from "../hooks/useDebouncedPersist";
import NumField from "./NumField";
import DateField from "./DateField";
import PromotionsModal from "./PromotionsModal";
import ReceiptPrintView from "./ReceiptPrintView";
import ClientProgressPrintView from "./ClientProgressPrintView";
import BodyTab from "./BodyTab";
import NutritionTab from "./NutritionTab";
import * as nutritionApi from "../lib/nutrition";
import type { NutritionLog } from "../lib/nutrition";
import ProgramCatalogModal from "./ProgramCatalogModal";
import ChatThread from "./ChatThread";
import * as messagesApi from "../lib/messages";
import type { ChatMessage } from "../lib/messages";
import SessionHistoryModal from "./SessionHistoryModal";
import RemainingBadge from "./RemainingBadge";
import ActivityTab from "./ActivityTab";
import GoalsDashboard from "./GoalsDashboard";
import * as portalApi from "../lib/clientPortal";
import type { ClientActivity } from "../lib/clientPortal";

export type Sub = "overview" | "membership" | "body" | "nutrition" | "photos" | "plans" | "chat" | "activity" | "goals";

const SUB_DEFS: Record<Sub, { label: string; icon: typeof Users }> = {
  overview: { label: "Обзор", icon: Users },
  membership: { label: "Абонемент", icon: Wallet },
  body: { label: "Замеры", icon: Ruler },
  nutrition: { label: "Питание", icon: Apple },
  photos: { label: "Фото", icon: Images },
  plans: { label: "Планы", icon: ClipboardList },
  chat: { label: "Чат", icon: MessageCircle },
  activity: { label: "Активность", icon: TrendingUp },
  goals: { label: "Цели", icon: Target },
};
const DEFAULT_SUB_ORDER: Sub[] = ["overview", "membership", "body", "nutrition", "photos", "plans", "chat", "activity", "goals"];
const SUB_ORDER_KEY = "trainerhub-client-sub-order-v1";
const SUB_HIDDEN_KEY = "trainerhub-client-sub-hidden-v1";
// ponytail: порядок и видимость под-вкладок карточки клиента — личная настройка устройства, как в App.tsx
const loadSubOrder = (): Sub[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(SUB_ORDER_KEY) || "null") as Sub[] | null;
    if (saved && saved.length === DEFAULT_SUB_ORDER.length && DEFAULT_SUB_ORDER.every((k) => saved.includes(k))) return saved;
  } catch {}
  return DEFAULT_SUB_ORDER;
};
const loadHiddenSubs = (): Sub[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(SUB_HIDDEN_KEY) || "null") as Sub[] | null;
    if (saved) return saved.filter((k) => DEFAULT_SUB_ORDER.includes(k));
  } catch {}
  return [];
};

export default function ClientProfile({ trainerId, clientId, onBack, onOpenPlan, initialSub }: { trainerId: string; clientId: string; onBack: () => void; onOpenPlan: (id: string) => void; initialSub?: Sub }) {
  const [sub, setSub] = useState<Sub>(initialSub || "overview");
  const [subOrder, setSubOrder] = useState<Sub[]>(loadSubOrder);
  const [hiddenSubs, setHiddenSubs] = useState<Sub[]>(loadHiddenSubs);
  const [dragSub, setDragSub] = useState<Sub | null>(null);
  const [showSubSettings, setShowSubSettings] = useState(false);
  const reorderSubs = (target: Sub) => {
    if (!dragSub || dragSub === target) return;
    const next = subOrder.filter((k) => k !== dragSub);
    next.splice(next.indexOf(target), 0, dragSub);
    setSubOrder(next);
    localStorage.setItem(SUB_ORDER_KEY, JSON.stringify(next));
  };
  const toggleSubVisible = (kind: Sub) => {
    const isHidden = hiddenSubs.includes(kind);
    if (!isHidden && hiddenSubs.length >= subOrder.length - 1) return; // хотя бы одна под-вкладка должна остаться видимой
    const next = isHidden ? hiddenSubs.filter((k) => k !== kind) : [...hiddenSubs, kind];
    setHiddenSubs(next);
    localStorage.setItem(SUB_HIDDEN_KEY, JSON.stringify(next));
  };
  const [client, setClient] = useState<ClientFull | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<NutritionLog[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [activities, setActivities] = useState<ClientActivity[]>([]);
  const [showReport, setShowReport] = useState(false);
  const persist = useDebouncedPersist();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatReadKey = `trainerhub-chat-read-${clientId}`;
  const [chatLastRead, setChatLastRead] = useState(() => localStorage.getItem(chatReadKey) || "");

  useEffect(() => {
    api.fetchClient(clientId).then(setClient);
    api.fetchMeasurements(clientId).then(setMeasurements);
    nutritionApi.fetchNutritionLogs(clientId).then(setNutritionLogs);
    api.fetchPhotos(clientId).then(setPhotos);
    api.fetchNotes(clientId).then(setNotes);
    api.fetchClientPlans(clientId).then(setPlans);
    portalApi.fetchClientActivities(clientId).then(setActivities);
    messagesApi.fetchMessages(clientId).then(setChatMessages);
  }, [clientId]);

  if (!client) return <p className="text-zinc-500 text-sm p-4">Загрузка...</p>;

  // Текстовые поля — debounce per-field, чтобы не слать запрос на каждую букву. Чекбоксы/селекты — сразу.
  const patch = (p: Partial<ClientFull>, immediate = false) => {
    setClient((c) => (c ? { ...c, ...p } : c));
    if (immediate) api.updateClient(clientId, p);
    else persist("client", p, (pp) => api.updateClient(clientId, pp));
  };
  const patchHealth = (p: Partial<ClientFull["health"]>) => {
    const merged = { ...client.health, ...p };
    setClient({ ...client, health: merged });
    persist("health", { health: merged }, (pp) => api.updateClient(clientId, pp));
  };
  const patchMembership = (p: Partial<ClientFull["membership"]>, immediate = false) => {
    const merged = { ...client.membership, ...p };
    setClient({ ...client, membership: merged });
    if (immediate) { persist.cancel("membership"); api.updateClient(clientId, { membership: merged }); }
    else persist("membership", { membership: merged }, (pp) => api.updateClient(clientId, pp));
  };

  const tgLink = client.telegram ? (client.telegram.startsWith("http") ? client.telegram : `https://t.me/${client.telegram.replace(/^@/, "")}`) : "";
  const waLink = client.whatsapp ? `https://wa.me/${client.whatsapp.replace(/\D/g, "")}` : "";
  const remainingNum = api.combinedRemaining(client.membership);
  const lowStock = client.membership.type !== "subscription" && client.membership.remaining !== "" && remainingNum > 0 && remainingNum <= 2;
  const outOfStock = client.membership.type !== "subscription" && client.membership.remaining !== "" && remainingNum <= 0;
  const overdue = client.membership.type === "subscription" && client.membership.nextPaymentDate && client.membership.nextPaymentDate < today();
  const deleteClient = async () => {
    if (!window.confirm(`Удалить «${client.name}»? Карточка переместится в корзину — её можно восстановить позже.`)) return;
    await api.deleteClient(clientId);
    onBack();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition"><ArrowLeft size={15} /> К подопечным</button>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowReport(true)} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition" title="Отчёт по прогрессу (PDF)"><Printer size={14} /> Отчёт</button>
          <button onClick={deleteClient} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-red-400 transition" title="Удалить подопечного"><Trash2 size={14} /> Удалить</button>
        </div>
      </div>
      {showReport && <ClientProgressPrintView clientId={clientId} planIds={(plans ?? []).map((p) => p.id)} clientName={client.name} trainerId={trainerId} onClose={() => setShowReport(false)} />}

      <div className="flex items-center gap-3 mb-4">
        {client.avatarUrl ? (
          <img src={client.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover border border-zinc-700 shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-zinc-950 shrink-0" style={{ background: client.color }}>{client.name.charAt(0).toUpperCase()}</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {client.membership.type === "sessions" && <RemainingBadge remaining={client.membership.remaining !== "" ? String(remainingNum) : null} />}
            <input value={client.name} onChange={(e) => patch({ name: e.target.value })} className="w-full bg-transparent font-bold text-lg outline-none border-b border-transparent focus:border-lime-400/50" />
          </div>
          <select value={client.goal} onChange={(e) => patch({ goal: e.target.value }, true)} className="bg-transparent text-xs text-zinc-500 outline-none cursor-pointer">
            {GOALS.map((g) => <option key={g} className="bg-zinc-900">{g}</option>)}
          </select>
        </div>
      </div>

      {!!client.activeSession && (
        <div className="w-full flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-sm bg-cyan-400/10 text-cyan-300 border border-cyan-400/20">
          <Play size={14} className="shrink-0 text-cyan-400" />
          <span className="flex-1 font-medium">Сейчас тренируется: <span className="text-cyan-100">{client.activeSession.dayName}</span></span>
          <span className="text-xs text-cyan-500">{(() => { const s = Math.floor((Date.now() - client.activeSession.startedAt) / 1000); const m = Math.floor(s / 60); return m > 0 ? `${m} мин` : "только начал"; })()}</span>
        </div>
      )}
      {(outOfStock || lowStock || overdue) && (
        <button onClick={() => setSub("membership")} className={`w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-sm transition ${outOfStock || overdue ? "bg-red-500/10 hover:bg-red-500/15 text-red-300" : "bg-amber-500/10 hover:bg-amber-500/15 text-amber-300"}`}>
          <AlertTriangle size={14} className="shrink-0" />
          {outOfStock ? "Тренировки закончились — оформи новый платёж" : overdue ? `Подписка просрочена с ${fmtDate(client.membership.nextPaymentDate)}` : `Осталось ${remainingNum} тренировки — предложи продление`}
        </button>
      )}

      <div className="flex items-center gap-1.5 mb-4">
        <div className="relative shrink-0">
          <button onClick={() => setShowSubSettings((v) => !v)} title="Настроить вкладки" className={`p-2 rounded-lg transition ${showSubSettings ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
            <Settings size={16} />
          </button>
          {showSubSettings && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSubSettings(false)} />
              <div className="absolute left-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-800 rounded-xl p-2 w-56 space-y-0.5 shadow-xl">
                <p className="text-xs text-zinc-500 px-2 pb-1">Видимые вкладки</p>
                {subOrder.map((kind) => {
                  const t = SUB_DEFS[kind];
                  const visible = !hiddenSubs.includes(kind);
                  return (
                    <label key={kind} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 cursor-pointer text-sm text-zinc-300">
                      <input type="checkbox" checked={visible} onChange={() => toggleSubVisible(kind)} className="accent-lime-400" />
                      <t.icon size={14} className="text-zinc-500" /> {t.label}
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5 w-full overflow-x-auto">
          {subOrder.filter((k) => !hiddenSubs.includes(k)).map((k) => {
            const t = SUB_DEFS[k];
            return (
              <button
                key={k}
                draggable
                onDragStart={() => setDragSub(k)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); reorderSubs(k); setDragSub(null); }}
                onDragEnd={() => setDragSub(null)}
                onClick={() => setSub(k)}
                title="Зажмите и перетащите, чтобы изменить порядок"
                className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition whitespace-nowrap cursor-grab shrink-0 ${sub === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"} ${dragSub === k ? "opacity-40" : ""}`}
              >
                <t.icon size={14} /> {t.label}
                {k === "chat" && chatMessages.filter((m) => m.sender === "client" && m.createdAt > chatLastRead).length > 0 && (
                  <span className="min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {chatMessages.filter((m) => m.sender === "client" && m.createdAt > chatLastRead).length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {sub === "overview" && <OverviewTab client={client} patch={patch} patchHealth={patchHealth} notes={notes} clientId={clientId} setNotes={setNotes} tgLink={tgLink} waLink={waLink} />}
      {sub === "membership" && <MembershipTab client={client} patchMembership={patchMembership} clientId={clientId} trainerId={trainerId} />}
      {sub === "body" && <BodyTab clientId={clientId} measurements={measurements} setMeasurements={setMeasurements} />}
      {sub === "nutrition" && <NutritionTab clientId={clientId} logs={nutritionLogs} setLogs={setNutritionLogs} readOnly />}
      {sub === "photos" && <PhotosTab clientId={clientId} photos={photos} setPhotos={setPhotos} />}
      {sub === "plans" && <PlansTab trainerId={trainerId} clientId={clientId} plans={plans} setPlans={setPlans} onOpenPlan={onOpenPlan} />}
      {sub === "chat" && <ChatThread trainerId={trainerId} clientId={clientId} self="trainer" />}
      {sub === "activity" && <ActivityTab clientId={clientId} activities={activities} setActivities={setActivities} readOnly />}
      {sub === "goals" && <GoalsDashboard clientId={clientId} />}
    </div>
  );
}

function InviteBlock({ clientId, email, hasAccount }: { clientId: string; email: string; hasAccount: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [created, setCreated] = useState(false);

  const invite = async () => {
    setBusy(true); setMsg("");
    try {
      const res = await api.inviteClient(clientId);
      if (!res.error) setCreated(true);
      setMsg(res.error ? res.error : res.warning ? res.warning : "Логин и пароль отправлены клиенту на почту.");
    } catch (e: any) {
      setMsg(e.message || "Не удалось отправить доступ");
    } finally { setBusy(false); }
  };

  if (hasAccount && !msg) return null;
  return (
    <div className="space-y-1">
      {!hasAccount && !created && (
        <button onClick={invite} disabled={!email || busy} className="flex items-center gap-1.5 bg-cyan-400 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm hover:bg-cyan-300 transition disabled:opacity-40">
          <Send size={14} /> {busy ? "Отправка..." : "Отправить доступ клиенту"}
        </button>
      )}
      {msg && <p className="text-[11px] text-cyan-400">{msg}</p>}
    </div>
  );
}

function OverviewTab({ client, patch, patchHealth, notes, setNotes, clientId, tgLink, waLink }: {
  client: ClientFull; patch: (p: Partial<ClientFull>, immediate?: boolean) => void; patchHealth: (p: Partial<ClientFull["health"]>) => void;
  notes: ClientNote[]; setNotes: (n: ClientNote[]) => void; clientId: string; tgLink: string; waLink: string;
}) {
  const [noteText, setNoteText] = useState("");
  const addNote = async () => {
    if (!noteText.trim()) return;
    await api.addNote(clientId, noteText.trim());
    setNoteText("");
    api.fetchNotes(clientId).then(setNotes);
  };
  const deleteNote = async (id: string) => { await api.deleteNote(id); setNotes(notes.filter((n) => n.id !== id)); };

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Users size={15} className="text-cyan-400" /> Статус и источник</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-zinc-500">Статус
            <select value={client.status} onChange={(e) => patch({ status: e.target.value, ...(e.target.value !== "paused" ? { pauseReason: "" } : {}) }, true)} className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40">
              <option value="active" className="bg-zinc-900">Активен</option>
              <option value="paused" className="bg-zinc-900">Приостановил</option>
              <option value="left" className="bg-zinc-900">Ушёл</option>
            </select>
          </label>
          <label className="text-xs text-zinc-500">Источник (как нашёл)
            <input value={client.source} onChange={(e) => patch({ source: e.target.value })} placeholder="реклама, рекомендация, соцсети..." className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
        </div>
        {client.status === "paused" && (
          <label className="text-xs text-zinc-500 block">Причина паузы
            <input value={client.pauseReason} onChange={(e) => patch({ pauseReason: e.target.value })} placeholder="напр. травма, отпуск" className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={client.trial} onChange={(e) => patch({ trial: e.target.checked }, true)} className="accent-lime-400 w-4 h-4" /> Пришёл на пробную тренировку
        </label>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Phone size={15} className="text-lime-400" /> Контакты</h3>
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-xs text-zinc-500">Телефон<input value={client.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="+7..." className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" /></label>
          <label className="text-xs text-zinc-500">Telegram<input value={client.telegram} onChange={(e) => patch({ telegram: e.target.value })} placeholder="@username" className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" /></label>
          <label className="text-xs text-zinc-500">WhatsApp<input value={client.whatsapp} onChange={(e) => patch({ whatsapp: e.target.value })} placeholder="79001234567" className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" /></label>
        </div>
        <label className="text-xs text-zinc-500 block">Email для входа в портал клиента<input type="email" value={client.email} onChange={(e) => patch({ email: e.target.value.trim() })} placeholder="client@mail.com" className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-cyan-400/40" /></label>
        <InviteBlock clientId={clientId} email={client.email} hasAccount={client.hasAccount} />
        <p className="text-[11px] text-zinc-600 -mt-1">{client.hasAccount ? "Доступ уже выдан — логин и пароль отправлены на почту." : "Сгенерируем логин/пароль и отправим клиенту на почту."}</p>
        <div className="flex flex-wrap gap-2">
          {client.phone && <a href={`tel:${client.phone}`} className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 py-1.5 text-sm transition"><Phone size={14} /> Позвонить</a>}
          {tgLink && <a href={tgLink} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 rounded-lg px-3 py-1.5 text-sm transition"><Send size={14} /> Telegram</a>}
          {waLink && <a href={waLink} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-green-500/15 text-green-300 hover:bg-green-500/25 rounded-lg px-3 py-1.5 text-sm transition"><MessageCircle size={14} /> WhatsApp</a>}
          {!client.phone && !tgLink && !waLink && <p className="text-xs text-zinc-600">Заполни контакты, чтобы появились кнопки быстрой связи</p>}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><HeartPulse size={15} className="text-amber-400" /> Анкета здоровья / противопоказания</h3>
        <label className="text-xs text-zinc-500 block">Травмы / диагнозы<textarea value={client.health.injuries} onChange={(e) => patchHealth({ injuries: e.target.value })} rows={2} placeholder="напр. грыжа L4–L5, проблемы с коленом" className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" /></label>
        <label className="text-xs text-zinc-500 block">Ограничения (что нельзя)<textarea value={client.health.restrictions} onChange={(e) => patchHealth({ restrictions: e.target.value })} rows={2} placeholder="напр. без осевой нагрузки, без прыжков" className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" /></label>
        <label className="text-xs text-zinc-500 block">Прочее<textarea value={client.health.notes} onChange={(e) => patchHealth({ notes: e.target.value })} rows={2} placeholder="аллергии, особенности, цели по самочувствию" className="w-full mt-0.5 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" /></label>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><MessageSquare size={15} className="text-cyan-400" /> Заметки / история общения</h3>
        <div className="flex gap-2">
          <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} placeholder="Что обсудили, договорённости..." className="flex-1 bg-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          <button onClick={addNote} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg px-3 text-sm transition">Добавить</button>
        </div>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {notes.length === 0 && <p className="text-xs text-zinc-600">Заметок пока нет</p>}
          {notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 bg-zinc-800/40 rounded-lg px-3 py-2 text-sm">
              <span className="text-zinc-500 text-xs shrink-0 w-20">{fmtDate(n.date)}</span>
              <span className="flex-1 text-zinc-200">{n.text}</span>
              <button onClick={() => deleteNote(n.id)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MembershipTab({ client, patchMembership, clientId, trainerId }: { client: ClientFull; patchMembership: (p: Partial<ClientFull["membership"]>, immediate?: boolean) => void; clientId: string; trainerId: string }) {
  const m = client.membership;
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [showPromotions, setShowPromotions] = useState(false);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const [otherClients, setOtherClients] = useState<api.ClientListItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const load = () => {
    paymentsApi.fetchPackageTemplates(trainerId).then(setTemplates);
    paymentsApi.fetchPromotions(clientId).then(setPromotions);
    api.fetchPayments(clientId).then(setPayments);
    api.fetchClients(trainerId).then((cs) => setOtherClients(cs.filter((c) => c.id !== clientId)));
  };
  useEffect(load, [clientId, trainerId]);

  const linkPartner = async (partnerId: string) => {
    const partner = otherClients.find((c) => c.id === partnerId);
    if (!partner) return;
    const merged = await api.linkSplitPartner(clientId, client.name, partnerId, partner.name, m);
    patchMembership(merged, true);
  };
  const unlinkPartner = async () => {
    if (!window.confirm("Отвязать сплит-партнёра?")) return;
    const merged = await api.unlinkSplitPartner(clientId, m);
    patchMembership(merged, true);
  };

  const activePromo = promotions.find((p) => p.active && p.appliesTo === (m.type === "subscription" ? "subscription" : "sessions"));
  const basePrice = m.type === "subscription" ? Number(m.pricePerSession) || 0 : Number(m.packagePrice) || 0;
  const preview = activePromo ? paymentsApi.applyPromotion(basePrice, promotions, m.type === "subscription" ? "subscription" : "sessions") : null;

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    patchMembership({ total: String(t.sessions), packagePrice: String(t.price), split: t.split }, true);
  };
  const saveAsTemplate = async () => {
    const name = window.prompt("Название шаблона:");
    if (!name) return;
    await paymentsApi.savePackageTemplate(trainerId, { name, sessions: Number(m.total) || 0, price: Number(m.packagePrice) || 0, split: m.split });
    paymentsApi.fetchPackageTemplates(trainerId).then(setTemplates);
  };

  const markPaid = async () => {
    const merged = await paymentsApi.markPaid(clientId, m, promotions);
    patchMembership(merged, true);
    api.fetchPayments(clientId).then(setPayments);
  };

  const editPayment = async (p: Payment) => {
    const amount = window.prompt("Сумма ₽:", String(p.amount));
    if (amount == null) return;
    const note = window.prompt("Примечание:", p.note) ?? p.note;
    await paymentsApi.updatePayment(p.id, { amount: Number(amount) || p.amount, note });
    api.fetchPayments(clientId).then(setPayments);
  };
  const splitPayment = async (p: Payment) => {
    const parts = Number(window.prompt("Разбить на сколько платежей?", "2"));
    if (!parts || parts < 2) return;
    await paymentsApi.splitPayment(clientId, p, parts);
    api.fetchPayments(clientId).then(setPayments);
  };
  const deletePayment = async (id: string) => {
    if (!window.confirm("Удалить платёж из журнала? Если он добавлял тренировки в остаток, остаток тоже уменьшится обратно.")) return;
    const next = await paymentsApi.deletePayment(id, clientId, m);
    patchMembership(next, true);
    api.fetchPayments(clientId).then(setPayments);
  };

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-1.5"><Wallet size={15} className="text-lime-400" /> Тип оплаты</h3>
          <button onClick={() => setShowPromotions(true)} className={`flex items-center gap-1 text-xs font-medium rounded-lg px-2 py-1 transition ${activePromo ? "bg-orange-400/20 text-orange-300" : "text-zinc-500 hover:text-zinc-300"}`}><Percent size={13} /> Акции{activePromo ? " ✓" : ""}</button>
        </div>
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5 w-fit">
          <button onClick={() => patchMembership({ type: "sessions" }, true)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${m.type !== "subscription" ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>По тренировкам</button>
          <button onClick={() => patchMembership({ type: "subscription" }, true)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${m.type === "subscription" ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>Подписка</button>
        </div>

        {m.type === "subscription" ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <DateField label="След. платёж" value={m.nextPaymentDate} onChange={(e) => patchMembership({ nextPaymentDate: e.target.value })} />
            <NumField label="Сумма ₽" value={m.pricePerSession} onChange={(e) => patchMembership({ pricePerSession: e.target.value })} placeholder="5000" />
            <DateField label="Дата оплаты" value={m.paymentDate} onChange={(e) => patchMembership({ paymentDate: e.target.value })} />
          </div>
        ) : (
          <>
            {templates.length > 0 && (
              <select onChange={(e) => e.target.value && applyTemplate(e.target.value)} defaultValue="" className="w-full bg-zinc-800 rounded-lg px-2.5 py-2 text-sm outline-none">
                <option value="" className="bg-zinc-900">Применить шаблон пакета...</option>
                {templates.map((t) => <option key={t.id} value={t.id} className="bg-zinc-900">{t.name} — {t.sessions}×{t.price}₽{t.split ? " · сплит" : ""}</option>)}
              </select>
            )}
            <div className="grid grid-cols-2 gap-2">
              <NumField label="Кол-во в пакете" value={m.total} onChange={(e) => patchMembership({ total: e.target.value })} placeholder="0" />
              <NumField label="Цена пакета ₽" value={m.packagePrice} onChange={(e) => patchMembership({ packagePrice: e.target.value })} placeholder="24000" />
              <NumField label="Остаток" value={m.remaining} onChange={(e) => patchMembership({ remaining: e.target.value })} placeholder="0" />
              <DateField label="Дата оплаты" value={m.paymentDate} onChange={(e) => patchMembership({ paymentDate: e.target.value })} />
            </div>
            {Number(m.extraRemaining) > 0 && (
              <p className="text-xs text-cyan-300/80">+ {m.extraRemaining} тренировки доп. блока по {Math.round(Number(m.extraPricePerSession) || 0).toLocaleString("ru-RU")}₽/занятие (старый пакет, другая цена)</p>
            )}
            <button onClick={() => setShowHistory(true)} className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg py-1.5 text-sm font-medium transition">
              <CalendarCheck size={14} /> Посмотреть даты проведённых тренировок
            </button>
            {showHistory && <SessionHistoryModal trainerId={trainerId} clientId={clientId} onClose={() => setShowHistory(false)} />}
            <button onClick={saveAsTemplate} className="text-xs text-zinc-500 hover:text-zinc-300 transition">Сохранить текущий пакет как шаблон</button>
            <button onClick={() => (m.split ? unlinkPartner() : patchMembership({ split: true }, true))} className={`w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-medium transition ${m.split ? "bg-cyan-400/20 text-cyan-300" : "bg-zinc-800 text-zinc-400"}`}>Сплит на двоих{m.split && m.partnerClientId ? ` — ${m.partnerName}` : ""}</button>
            {m.split && !m.partnerClientId && (
              <select onChange={(e) => e.target.value && linkPartner(e.target.value)} defaultValue="" className="w-full bg-zinc-800 rounded-lg px-2.5 py-2 text-sm outline-none">
                <option value="" className="bg-zinc-900">Выбрать партнёра по сплиту...</option>
                {otherClients.map((c) => <option key={c.id} value={c.id} className="bg-zinc-900">{c.name}</option>)}
              </select>
            )}
            {m.split && m.partnerClientId && (
              <p className="text-xs text-cyan-300/80">Общий остаток и оплата 50/50 с {m.partnerName}</p>
            )}
          </>
        )}
        <input value={m.note} onChange={(e) => patchMembership({ note: e.target.value })} placeholder="заметка по абонементу (необязательно)" className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />

        <button onClick={markPaid} disabled={!basePrice} className="w-full flex items-center justify-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:bg-lime-300 transition disabled:opacity-40">
          <CheckCircle2 size={16} /> Отметить оплачено{preview && preview.amount !== basePrice ? ` — ${preview.amount.toLocaleString("ru-RU")}₽ (${preview.label})` : basePrice ? ` — ${basePrice.toLocaleString("ru-RU")}₽` : ""}
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
        <h3 className="font-semibold text-sm flex items-center gap-1.5"><Receipt size={15} className="text-cyan-400" /> Журнал платежей</h3>
        {payments.length === 0 && <p className="text-xs text-zinc-600">Платежей пока нет</p>}
        {payments.map((p) => (
          <div key={p.id} className="flex items-center gap-2 bg-zinc-800/40 rounded-lg px-3 py-2 text-sm">
            <span className="text-zinc-400 shrink-0 w-20">{fmtDate(p.date)}</span>
            <span className="flex-1 truncate">{p.amount.toLocaleString("ru-RU")}₽ <span className="text-zinc-500">· {p.type === "subscription" ? "подписка" : "пакет"}</span>{p.promoApplied && <span className="text-orange-400"> · {p.promoApplied}</span>}{p.note && <span className="text-zinc-500"> · {p.note}</span>}</span>
            <button onClick={() => setReceipt(p)} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 transition shrink-0" title="Чек"><Printer size={14} /></button>
            <button onClick={() => splitPayment(p)} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 transition shrink-0" title="Разделить"><Scissors size={14} /></button>
            <button onClick={() => editPayment(p)} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 transition shrink-0" title="Редактировать"><Pencil size={14} /></button>
            <button onClick={() => deletePayment(p.id)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0" title="Удалить"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>

      {showPromotions && <PromotionsModal clientId={clientId} onClose={() => { setShowPromotions(false); load(); }} />}
      {receipt && <ReceiptPrintView payment={receipt} trainerId={trainerId} clientName={client.name} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function PhotosTab({ clientId, photos, setPhotos }: { clientId: string; photos: Photo[]; setPhotos: (p: Photo[]) => void }) {
  const [photoUrl, setPhotoUrl] = useState("");
  const sorted = [...photos].sort((a, b) => (a.date < b.date ? -1 : 1));

  const reload = () => api.fetchPhotos(clientId).then(setPhotos);
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const thumb = await fileToThumb(f); await api.addPhoto(clientId, thumb); reload(); }
    catch { alert("Не удалось обработать изображение"); }
    e.target.value = "";
  };
  const addByUrl = async () => { const u = photoUrl.trim(); if (!u) return; await api.addPhoto(clientId, u); setPhotoUrl(""); reload(); };
  const remove = async (id: string) => { await api.deletePhoto(id); setPhotos(photos.filter((p) => p.id !== id)); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 py-2 text-sm hover:bg-lime-300 transition cursor-pointer"><Camera size={15} /> Загрузить фото<input type="file" accept="image/*" onChange={onUpload} className="hidden" /></label>
        <div className="flex gap-2 flex-1 min-w-[160px]">
          <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addByUrl()} placeholder="или вставь ссылку на фото" className="flex-1 min-w-0 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          <button onClick={addByUrl} className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 text-sm text-zinc-200 transition">+</button>
        </div>
      </div>
      <p className="text-[11px] text-zinc-600">Загруженные фото сжимаются и хранятся в базе. Для большого архива лучше использовать ссылки.</p>

      {sorted.length >= 2 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs text-zinc-500 mb-2">Сравнение: до → после</p>
          <div className="grid grid-cols-2 gap-2">
            <div><img src={sorted[0].url} alt="до" className="w-full h-48 object-cover rounded-lg bg-zinc-800" /><p className="text-[11px] text-zinc-500 mt-1 text-center">{fmtDate(sorted[0].date)} · до</p></div>
            <div><img src={sorted[sorted.length - 1].url} alt="после" className="w-full h-48 object-cover rounded-lg bg-zinc-800" /><p className="text-[11px] text-lime-400 mt-1 text-center">{fmtDate(sorted[sorted.length - 1].date)} · после</p></div>
          </div>
        </div>
      )}

      {sorted.length === 0 ? <p className="text-sm text-zinc-600 text-center py-8">Фото пока нет. Загрузи снимок «до», чтобы потом сравнить прогресс.</p> : (
        <div className="grid grid-cols-3 gap-2">
          {[...sorted].reverse().map((p) => (
            <div key={p.id} className="relative group">
              <img src={p.url} alt="" className="w-full h-32 object-cover rounded-lg bg-zinc-800" />
              <div className="absolute bottom-1 left-1 right-1 text-[10px] text-white bg-black/50 rounded px-1 py-0.5 text-center">{fmtDate(p.date)}</div>
              <button onClick={() => remove(p.id)} className="absolute top-1 right-1 p-1.5 rounded-md bg-black/50 text-white hover:bg-red-500 transition"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlansTab({ trainerId, clientId, plans, setPlans, onOpenPlan }: { trainerId: string; clientId: string; plans: PlanListItem[] | null; setPlans: (p: PlanListItem[]) => void; onOpenPlan: (id: string) => void }) {
  const [name, setName] = useState("");
  const [showCatalog, setShowCatalog] = useState(false);
  const createPlan = async () => {
    if (!name.trim()) return;
    const row = await api.addPlan(trainerId, clientId, name.trim());
    setName("");
    api.fetchClientPlans(clientId).then(setPlans);
    onOpenPlan(row.id);
  };
  const deletePlan = async (id: string, planName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Удалить план «${planName}»? Его можно восстановить из корзины.`)) return;
    await api.deletePlan(id);
    api.fetchClientPlans(clientId).then(setPlans);
  };

  return (
    <div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4 space-y-2">
        <p className="text-sm text-zinc-400">Новый план тренировок</p>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createPlan()} placeholder="Название плана" className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50" />
          <button onClick={createPlan} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 py-2 text-sm hover:bg-lime-300 transition shrink-0"><Plus size={15} /> Создать</button>
        </div>
        <button onClick={() => setShowCatalog(true)} className="text-xs text-zinc-500 hover:text-zinc-300 transition">Или выбрать из готовой программы (масса/сушка/СФП)</button>
      </div>
      {showCatalog && (
        <ProgramCatalogModal trainerId={trainerId} clientId={clientId} onClose={() => setShowCatalog(false)}
          onCloned={(planId) => { setShowCatalog(false); api.fetchClientPlans(clientId).then(setPlans); onOpenPlan(planId); }} />
      )}

      {plans === null ? (
        <p className="text-zinc-500 text-sm">Загрузка...</p>
      ) : (
        <div className="space-y-2">
          {plans.length === 0 && <p className="text-zinc-600 text-sm text-center py-8">Планов пока нет</p>}
          {plans.map((p) => (
            <button key={p.id} onClick={() => onOpenPlan(p.id)} className="w-full text-left bg-zinc-900 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700 transition flex items-center justify-between gap-2">
              <span className="font-medium truncate">{p.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                {p.archived && <span className="text-[10px] uppercase tracking-wide bg-zinc-700 text-zinc-400 rounded px-1.5 py-0.5">архив</span>}
                <span onClick={(e) => deletePlan(p.id, p.name, e)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition" title="Удалить"><Trash2 size={14} /></span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
