import { useEffect, useRef, useState } from "react";
import { ArrowUp, CalendarDays, Check, ChevronLeft, ClipboardList, Clock, Dumbbell, Loader2, Plus, Sparkles, Trash2, UserRound, WifiOff } from "lucide-react";
import type { ClientListItem, PlanOverviewItem } from "../lib/clients";
import { registerModal } from "../lib/modalHistory";
import { ask, askInput, notify } from "../lib/dialog";
import { humanError } from "../lib/errors";
import {
  askAssistant, assistantConnectedCached, assistantStatus, AssistantError, createWorkout, currentPlanId, findDayOnDate, fmtDayDate, fmtDayMonth, fmtExercise, undoWorkout,
  type ACommand, type AExercise, type AUsage, type CreatedWorkout,
} from "../lib/assistant";

// Помощник (этап 2, прототип reps-redesign/stage10.html, экраны 3, 17–20): тренер пишет команду,
// сервер разбирает её в карточку, тренер проверяет и нажимает «Создать». Без «Создать» ничего не пишется.

type Card = {
  sourceText: string;
  result: ACommand;
  clientId: string;
  planId: string;
  date: string;
  dayName: string;
  time: string;
  withBooking: boolean;
  exercises: AExercise[];
  /** День на эту дату уже есть: null — нет, иначе выбор «дописать в него» или «отдельной» */
  existing: { id: string; name: string; planId: string } | null;
  append: boolean;
  status: "open" | "creating" | "created" | "cancelled";
  created?: CreatedWorkout;
};
type Msg =
  | { id: number; from: "me"; text: string }
  | { id: number; from: "ai"; text: string; error?: boolean }
  | { id: number; from: "card"; card: Card };

let seq = 0;
const EXAMPLE = "Создай Анне тренировку на четверг в 18:00: жим лёжа 4 по 8, присед 5 по 5 сто килограмм";

export default function AssistantChat({ trainerId, clients, plans, onClose, onOpenPlan, onChanged, onOpenTariffs }: {
  trainerId: string;
  clients: ClientListItem[];
  plans: PlanOverviewItem[];
  onClose: () => void;
  onOpenPlan: (planId: string, clientId: string) => void;
  /** Создали или отменили — перечитать планы и календарь */
  onChanged: () => void;
  /** «Посмотреть тарифы», когда запросы закончились */
  onOpenTariffs: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<AUsage | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  // Пока на сервере нет ключа Яндекса — «в разработке»: объясняем и ничего не отправляем
  const [connected, setConnected] = useState(assistantConnectedCached);
  useEffect(() => { assistantStatus().then((v) => { if (v) { setConnected(v.connected); if (v.usage) setUsage(v.usage); } }); }, []);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const openCard = () => [...msgs].reverse().find((m): m is Extract<Msg, { from: "card" }> => m.from === "card" && m.card.status === "open");

  const tryClose = async () => {
    if (openCard() && !(await ask("Закрыть помощника? Несохранённая тренировка пропадёт.", { ok: "Закрыть" }))) return;
    onClose();
  };
  const closeRef = useRef(tryClose);
  closeRef.current = tryClose;
  useEffect(() => registerModal(closeRef), []);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs.length, busy]);

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "";
  const clientPlans = (clientId: string) => plans.filter((p) => p.clientId === clientId && !p.archived);

  const patchCard = (id: number, patch: Partial<Card>) =>
    setMsgs((list) => list.map((m) => (m.id === id && m.from === "card" ? { ...m, card: { ...m.card, ...patch } } : m)));

  // Клиент или дата сменились — заново ищем день на эту дату и план по умолчанию
  const refreshTarget = async (id: number, clientId: string, date: string, keepPlan?: string) => {
    const planId = keepPlan ?? currentPlanId(plans, clientId);
    patchCard(id, { clientId, date, planId, existing: null, append: false });
    if (!clientId || !date) return;
    try {
      const existing = await findDayOnDate(clientPlans(clientId).map((p) => p.id), date);
      patchCard(id, { existing });
      // Вопрос «куда добавить» появляется под карточкой — прокручиваем к нему
      if (existing) setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 50);
    } catch (e) { console.warn("[assistant] findDayOnDate:", e); }
  };

  const toCard = (sourceText: string, r: ACommand): Card => ({
    sourceText, result: r,
    clientId: r.client.status === "ok" ? r.client.candidates[0].id : "",
    planId: "", date: r.date ?? "", dayName: r.dayName, time: r.time, withBooking: !!r.time,
    exercises: r.exercises, existing: null, append: false, status: "open",
  });

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    if (!online) { notify("Нет интернета. Текст остался в поле — отправь, когда появится связь"); return; }
    const prev = openCard();
    setMsgs((l) => [...l, { id: ++seq, from: "me", text: t }]);
    setText("");
    setBusy(true);
    try {
      const { result, usage } = await askAssistant(t, prev ? { text: prev.card.sourceText, result: prev.card.result } : undefined);
      setUsage(usage);
      if (result.action !== "create_workout") {
        setMsgs((l) => [...l, { id: ++seq, from: "ai", text: result.reply }]);
        return;
      }
      // Поправка заменяет открытую карточку (она переезжает вниз, под сообщение с поправкой), а не создаёт вторую
      const card = toCard(prev ? `${prev.card.sourceText}\n${t}` : t, result);
      const id = prev ? prev.id : ++seq;
      setMsgs((l) => [...l.filter((m) => m.id !== id), { id, from: "card", card }]);
      if (card.clientId) refreshTarget(id, card.clientId, card.date);
    } catch (e) {
      // Лимит — не ошибка в ленте, а карточка внизу (её рисует состояние usage); текст вернём в поле
      if (e instanceof AssistantError && e.code === "limit") {
        if (e.usage) setUsage(e.usage);
        setText(t);
        setMsgs((l) => l.filter((m) => !(m.from === "me" && m.text === t && m === l[l.length - 1])));
        return;
      }
      const msg = e instanceof AssistantError ? e.message : humanError(e);
      // Не отправилось — возвращаем текст в поле, чтобы не набирать заново
      if (!(e instanceof AssistantError) || e.code === "network") setText(t);
      setMsgs((l) => [...l, { id: ++seq, from: "ai", text: msg, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const create = async (m: Extract<Msg, { from: "card" }>) => {
    const c = m.card;
    if (!c.clientId || !c.date) return;
    // Дописываем в существующий день — у записи и в сообщении его название, а не предложенное помощником
    const into = c.append ? c.existing : null;
    const dayName = into ? into.name : c.dayName.trim() || "Тренировка";
    patchCard(m.id, { status: "creating" });
    try {
      const created = await createWorkout(trainerId, {
        clientId: c.clientId,
        planId: into ? into.planId : c.planId,
        appendToDayId: into ? into.id : "",
        date: c.date, dayName,
        time: c.withBooking ? c.time : "", exercises: c.exercises,
      });
      patchCard(m.id, { status: "created", created, dayName });
      onChanged();
      notify("Тренировка создана", "info", { label: "Отменить", run: () => undo(m.id, created) });
    } catch (e) {
      console.error("[assistant] create:", e);
      patchCard(m.id, { status: "open" });
      notify(humanError(e, "Не удалось создать тренировку. Попробуй ещё раз"), "error");
    }
  };

  const undo = async (id: number, created: CreatedWorkout) => {
    try {
      await undoWorkout(created);
      patchCard(id, { status: "cancelled" });
      onChanged();
      notify("Отменено");
    } catch (e) {
      console.error("[assistant] undo:", e);
      notify(humanError(e, "Не удалось отменить. Удали тренировку в плане вручную"), "error");
    }
  };

  const editExercise = async (m: Extract<Msg, { from: "card" }>, index: number) => {
    const e = m.card.exercises[index] ?? { name: "", sets: 0, reps: "", weight: "", duration: "", note: "", known: false };
    const v = await askInput(index < m.card.exercises.length ? "Упражнение" : "Новое упражнение", [
      { key: "name", label: "Название", value: e.name },
      { key: "sets", label: "Подходы", value: e.sets ? String(e.sets) : "", numeric: true },
      { key: "reps", label: "Повторы", value: e.reps, placeholder: "8 или 8–10" },
      { key: "weight", label: "Вес, кг", value: e.weight, numeric: true },
      { key: "duration", label: "Время", value: e.duration, placeholder: "1 мин" },
    ], { ok: "Готово" });
    if (!v || !v.name.trim()) return;
    const sets = Math.min(30, Math.max(0, parseInt(v.sets, 10) || 0));
    const next: AExercise = { ...e, name: v.name.trim(), sets, reps: v.reps.trim(), weight: v.weight.trim().replace(",", "."), duration: v.duration.trim() };
    const list = [...m.card.exercises];
    list[index] = next;
    patchCard(m.id, { exercises: list });
  };

  const renderCard = (m: Extract<Msg, { from: "card" }>) => {
    const c = m.card;
    const r = c.result;
    const locked = c.status !== "open";
    const myPlans = clientPlans(c.clientId);
    const rowCls = "flex items-center gap-2.5 px-3 min-h-[48px] border-t border-zinc-800 first:border-t-0";
    const labelCls = "w-16 shrink-0 text-xs text-zinc-500";
    const fieldCls = "flex-1 min-w-0 bg-transparent text-sm font-semibold text-zinc-100 outline-none disabled:opacity-100";

    if (c.status === "cancelled" && !c.created) return <p className="text-sm text-zinc-500 py-1">Отменено, ничего не создано.</p>;
    if (c.status === "created" || c.status === "cancelled") {
      const done = c.status === "created";
      return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 text-sm">
          <p className={done ? "text-zinc-100" : "text-zinc-500 line-through"}>
            {done ? (c.created && !c.created.createdDay ? "Добавлено: " : "Создано: ") : "Отменено: "}<b>{clientName(c.clientId)}</b>, {fmtDayDate(c.date)}{c.withBooking && c.time ? `, ${c.time}` : ""} · «{c.dayName}»
          </p>
          {done && c.created && (
            <div className="flex gap-2 mt-2.5">
              <button onClick={() => { onOpenPlan(c.created!.planId, c.clientId); onClose(); }} className="h-10 px-3 rounded-xl bg-lime-400 text-zinc-950 text-sm font-bold">Открыть</button>
              <button onClick={() => undo(m.id, c.created!)} className="h-10 px-3 rounded-xl bg-zinc-800 text-sm font-semibold">Отменить</button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 space-y-2.5">
        <p className="text-sm text-zinc-300">{c.exercises.length ? "Создам тренировку:" : "Создам пустую тренировку:"}</p>

        {/* Клиент не найден однозначно — выбор одним нажатием (экран 19) */}
        {!c.clientId && r.client.status === "ambiguous" && (
          <div className="space-y-1.5">
            <p className="text-sm text-amber-400">Несколько клиентов с именем «{r.client.mention}». Кому?</p>
            {r.client.candidates.map((x) => (
              <button key={x.id} disabled={locked} onClick={() => refreshTarget(m.id, x.id, c.date)} className="w-full flex items-center gap-2.5 h-12 px-3 rounded-xl bg-zinc-950 text-left text-sm">
                <UserRound size={16} className="text-zinc-500" /> {x.name}
              </button>
            ))}
          </div>
        )}
        {!c.clientId && r.client.status !== "ambiguous" && (
          <p className="text-sm text-amber-400">{r.client.status === "not_found" ? `Не нашёл клиента «${r.client.mention}». Выбери из списка.` : "Кому создать? Выбери клиента."}</p>
        )}

        <div className="bg-zinc-950 rounded-xl overflow-hidden">
          <label className={rowCls}>
            <UserRound size={16} className="text-zinc-500 shrink-0" /><span className={labelCls}>Клиент</span>
            <select value={c.clientId} disabled={locked} onChange={(e) => refreshTarget(m.id, e.target.value, c.date)} className={fieldCls} aria-label="Клиент">
              <option value="">Выбрать…</option>
              {[...clients].sort((a, b) => a.name.localeCompare(b.name, "ru")).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className={rowCls}>
            <CalendarDays size={16} className="text-zinc-500 shrink-0" /><span className={labelCls}>Дата</span>
            <input type="date" value={c.date} disabled={locked} onChange={(e) => refreshTarget(m.id, c.clientId, e.target.value, c.planId)} className={`${fieldCls} ${c.date ? "" : "text-amber-400"}`} aria-label="Дата" />
            {c.date && <span className="text-xs text-zinc-500 shrink-0">{fmtDayDate(c.date).split(",")[0]}</span>}
          </label>
          <label className={rowCls}>
            <Dumbbell size={16} className="text-zinc-500 shrink-0" /><span className={labelCls}>Название</span>
            <input value={c.dayName} disabled={locked} onChange={(e) => patchCard(m.id, { dayName: e.target.value })} maxLength={60} className={fieldCls} aria-label="Название тренировки" />
          </label>
          {!c.append && c.clientId && (
            <label className={rowCls}>
              <ClipboardList size={16} className="text-zinc-500 shrink-0" /><span className={labelCls}>План</span>
              <select value={c.planId} disabled={locked} onChange={(e) => patchCard(m.id, { planId: e.target.value })} className={fieldCls} aria-label="План">
                {myPlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="">Новый план «Тренировки»</option>
              </select>
            </label>
          )}
          <div className={rowCls}>
            <Clock size={16} className="text-zinc-500 shrink-0" /><span className={labelCls}>Запись</span>
            <input type="time" value={c.time} disabled={locked} onChange={(e) => patchCard(m.id, { time: e.target.value, withBooking: !!e.target.value })} className={`${fieldCls} ${c.withBooking ? "" : "text-zinc-500"}`} aria-label="Время записи в календарь" />
            <button type="button" role="switch" aria-checked={c.withBooking} aria-label="Записать в календарь" disabled={locked || !c.time}
              onClick={() => patchCard(m.id, { withBooking: !c.withBooking })}
              className={`relative w-11 h-[26px] rounded-full shrink-0 transition ${c.withBooking ? "bg-lime-400" : "bg-zinc-800"} disabled:opacity-40`}>
              <span className={`absolute top-[3px] w-5 h-5 rounded-full transition-all ${c.withBooking ? "right-[3px] bg-zinc-950" : "left-[3px] bg-zinc-500"}`} />
            </button>
          </div>

          {c.exercises.map((e, i) => (
            <div key={i} className="flex items-center gap-2 pl-3 pr-1 min-h-[48px] border-t border-zinc-800">
              <button disabled={locked} onClick={() => editExercise(m, i)} aria-label={`Изменить «${e.name}»`} className="flex-1 min-w-0 text-left py-2">
                <span className="block text-sm font-semibold break-words">{e.name}</span>
                <span className="flex items-center gap-2 mt-0.5">
                  <span className="text-sm font-bold text-zinc-300">{fmtExercise(e) || "без подходов"}</span>
                  <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${e.known ? "bg-lime-400/15 text-lime-400" : "bg-sky-400/15 text-sky-400"}`}>{e.known ? "твоё" : "новое"}</span>
                </span>
              </button>
              <button disabled={locked} onClick={() => patchCard(m.id, { exercises: c.exercises.filter((_, j) => j !== i) })} aria-label={`Убрать «${e.name}»`} className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-600 hover:text-red-400 shrink-0"><Trash2 size={16} /></button>
            </div>
          ))}
          <button disabled={locked} onClick={() => editExercise(m, c.exercises.length)} className="w-full flex items-center gap-2 px-3 h-11 border-t border-zinc-800 text-sm font-semibold text-lime-400">
            <Plus size={16} /> Упражнение
          </button>
        </div>

        {/* На эту дату уже есть тренировка (экран 19) */}
        {c.existing && (
          <div className="space-y-1.5">
            <p className="text-sm text-amber-400">На {fmtDayDate(c.date).toLowerCase()} уже есть «{c.existing.name}». Куда добавить?</p>
            <div className="flex gap-2 flex-wrap">
              <button disabled={locked} onClick={() => patchCard(m.id, { append: true })} className={`h-10 px-3 rounded-xl text-sm font-semibold ${c.append ? "bg-lime-400 text-zinc-950" : "bg-zinc-800"}`}>В «{c.existing.name}»</button>
              <button disabled={locked} onClick={() => patchCard(m.id, { append: false })} className={`h-10 px-3 rounded-xl text-sm font-semibold ${!c.append ? "bg-lime-400 text-zinc-950" : "bg-zinc-800"}`}>Отдельной тренировкой</button>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-0.5">
          <button onClick={() => create(m)} disabled={locked || !c.clientId || !c.date}
            className="h-11 px-4 rounded-xl bg-lime-400 text-zinc-950 text-sm font-bold flex items-center gap-1.5 disabled:opacity-40">
            {c.status === "creating" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {!c.clientId ? "Выбери клиента" : !c.date ? "Выбери дату" : c.append ? "Добавить" : "Создать"}
          </button>
          <button onClick={() => patchCard(m.id, { status: "cancelled" })} disabled={locked} className="h-11 px-3 rounded-xl bg-zinc-800 text-sm font-semibold">Не нужно</button>
        </div>
        <p className="text-xs text-zinc-500">Поправить можно и словами: «жим не 4, а 5 подходов».</p>
      </div>
    );
  };

  // Счётчик показываем с 80% месячного лимита: раньше он только тревожит
  const monthOut = !!usage && usage.used >= usage.limit;
  const dayOut = !!usage && !monthOut && usage.dayUsed >= usage.dayLimit;
  const showCounter = !!usage && connected && usage.used >= usage.limit * 0.8;
  const blocked = !connected || monthOut || dayOut;

  return (
    <div className="fixed inset-0 z-[60] bg-zinc-950 text-zinc-100 flex flex-col" style={{ height: "100dvh" }} role="dialog" aria-label="Помощник">
      <div className="max-w-2xl w-full mx-auto flex flex-col min-h-0 flex-1">
        <div className="flex items-center gap-2 px-2 py-2 shrink-0" style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}>
          <button onClick={tryClose} aria-label="Закрыть помощника" className="w-11 h-11 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100"><ChevronLeft size={22} /></button>
          <span className="w-8 h-8 rounded-full bg-lime-400 text-zinc-950 flex items-center justify-center shrink-0"><Sparkles size={17} /></span>
          <h1 className="text-[17px] font-bold flex-1">Помощник</h1>
          {showCounter && (
            <span className="flex items-center gap-2 pr-2 text-xs text-zinc-400" title="Запросов помощнику в этом месяце">
              <span className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden"><span className="block h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (usage!.used / usage!.limit) * 100)}%` }} /></span>
              {usage!.used} из {usage!.limit}
            </span>
          )}
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-3 pb-4 space-y-2.5 min-h-0">
          <div className="flex gap-2 items-end">
            <span className="w-7 h-7 rounded-full bg-lime-400 text-zinc-950 flex items-center justify-center shrink-0"><Sparkles size={14} /></span>
            {!connected ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-bl-md px-3 py-2.5 text-sm leading-relaxed max-w-[85%] space-y-1.5">
                <p className="font-semibold">Помощник в разработке</p>
                <p>Скоро здесь можно будет текстом или голосом создавать тренировки клиентам: «Создай Анне тренировку на четверг: жим лёжа 4 по 8». А ещё переносить старые тренировки из заметок и фото тетради.</p>
                <p className="text-zinc-500">Мы сообщим, когда он заработает.</p>
              </div>
            ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-bl-md px-3 py-2.5 text-sm leading-relaxed max-w-[85%] space-y-1.5">
              <p>Напиши, кому и на какой день создать тренировку. Например:</p>
              <button onClick={() => { setText(EXAMPLE); inputRef.current?.focus(); }} className="block text-left w-full bg-zinc-950 rounded-lg px-2.5 py-2 text-zinc-400 text-[13px]">{EXAMPLE}</button>
              <p>Перед сохранением ты всё проверишь: без тебя я ничего не создам.</p>
            </div>
            )}
          </div>

          {msgs.map((m) => m.from === "me" ? (
            <div key={m.id} className="flex justify-end">
              <div className="bg-zinc-800 rounded-2xl rounded-br-md px-3 py-2.5 text-sm leading-relaxed max-w-[85%] whitespace-pre-wrap break-words">{m.text}</div>
            </div>
          ) : m.from === "ai" ? (
            <div key={m.id} className="flex gap-2 items-end">
              <span className="w-7 h-7 rounded-full bg-lime-400 text-zinc-950 flex items-center justify-center shrink-0"><Sparkles size={14} /></span>
              <div role={m.error ? "alert" : undefined} className={`bg-zinc-900 border rounded-2xl rounded-bl-md px-3 py-2.5 text-sm leading-relaxed max-w-[85%] ${m.error ? "border-red-500/50" : "border-zinc-800"}`}>{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-2 items-start">
              <span className="w-7 h-7 rounded-full bg-lime-400 text-zinc-950 flex items-center justify-center shrink-0 mt-1"><Sparkles size={14} /></span>
              <div className="flex-1 min-w-0 max-w-[calc(100%-2.25rem)]">{renderCard(m)}</div>
            </div>
          ))}

          {connected && (monthOut || dayOut) && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 space-y-2" role="status">
              <p className="text-[15px] font-bold">{monthOut ? "Запросы на этот месяц закончились" : "На сегодня запросы закончились"}</p>
              <p className="text-sm text-zinc-400 leading-relaxed">
                {monthOut
                  ? `На тарифе Старт — ${usage!.limit} запросов в месяц, новые появятся ${fmtDayMonth(usage!.resetsOn)}.`
                  : `На тарифе Старт — ${usage!.dayLimit} запроса в день. Завтра можно снова.`}
              </p>
              <p className="text-sm text-zinc-500 leading-relaxed">Тренировку можно создать и без помощника: «Добавить день» в плане клиента.</p>
              <div className="flex gap-2 pt-1">
                <button onClick={onOpenTariffs} className="h-11 px-4 rounded-xl bg-lime-400 text-zinc-950 text-sm font-bold">Посмотреть тарифы</button>
                <button onClick={tryClose} className="h-11 px-3 rounded-xl bg-zinc-800 text-sm font-semibold">Позже</button>
              </div>
            </div>
          )}

          {busy && (
            <div className="flex gap-2 items-end" aria-live="polite">
              <span className="w-7 h-7 rounded-full bg-lime-400 text-zinc-950 flex items-center justify-center shrink-0"><Sparkles size={14} /></span>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-bl-md px-3 py-2.5 text-sm text-zinc-400 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Разбираю…</div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-800 px-2.5 pt-2" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
          {!online && <p className="flex items-center gap-2 text-xs text-amber-400 px-1 pb-2"><WifiOff size={14} /> Нет интернета. Текст не пропадёт, отправь, когда появится связь.</p>}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
              rows={1}
              maxLength={2000}
              disabled={blocked}
              placeholder={!connected ? "Скоро заработает" : monthOut ? `Запросы закончились до ${fmtDayMonth(usage!.resetsOn)}` : dayOut ? "На сегодня запросы закончились" : openCard() ? "Исправить или добавить…" : "Сообщение…"}
              aria-label="Команда помощнику"
              className="flex-1 min-w-0 resize-none bg-zinc-900 rounded-3xl px-4 py-[11px] text-[15px] leading-snug outline-none max-h-36 placeholder:text-zinc-600 focus:ring-1 focus:ring-lime-400/40"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            <button onClick={send} disabled={blocked || !text.trim() || busy || !online} aria-label="Отправить"
              className="w-11 h-11 rounded-full bg-lime-400 text-zinc-950 flex items-center justify-center shrink-0 disabled:bg-zinc-800 disabled:text-zinc-600">
              <ArrowUp size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
