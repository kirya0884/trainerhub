import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRightLeft, BookOpen, Check, ChevronLeft, ChevronRight, Copy, GlassWater, ListChecks, MessageSquare, Minus, Moon, MoreHorizontal, Plus, RotateCcw, Sun, Sunrise, Target, Cookie, Trash2 } from "lucide-react";
import ModalShell from "./ModalShell";
import { SkeletonRows } from "./Skeleton";
import FoodAddSheet from "./FoodAddSheet";
import FoodCopySheet from "./FoodCopySheet";
import NutritionReport from "./NutritionReport";
import type { Measurement } from "../lib/clients";
import NutritionGoalsSheet from "./NutritionGoalsSheet";
import { EMPTY_CELL, GramsInput, MacroTiles, MACRO_COLOR } from "./NutritionParts";
import * as api from "../lib/foodDiary";
import { isNetworkError, pending, subscribeOutbox } from "../lib/outbox";
import type { FoodEntry, Goals, Macros, Meal, NutritionDay } from "../lib/foodDiary";
import type { NutritionLog } from "../lib/nutrition";
import { addDays, plural, today } from "../lib/format";
import { ask, dismiss, notify } from "../lib/dialog";
import { track } from "../lib/events";
import { lazyRetry } from "../lib/lazy";

const NutritionCatalog = lazyRetry(() => import("./NutritionCatalog"));

const OVER = "#f2555a";
const WATER = "var(--m-water)";
const MEAL_ICON: Record<Meal, typeof Sun> = { breakfast: Sunrise, lunch: Sun, dinner: Moon, snack: Cookie };
const mealLabel = (m: Meal) => api.MEALS.find((x) => x.key === m)!.label;
/** «Все в «Обеде»» */
const MEAL_IN: Record<Meal, string> = { breakfast: "Завтраке", lunch: "Обеде", dinner: "Ужине", snack: "Перекусе" };
const records = (n: number) => `${n} ${plural(n, ["запись", "записи", "записей"])}`;

const dayTitle = (d: string) => {
  const t = today();
  const s = new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return d === t ? `Сегодня, ${s}` : d === addDays(t, -1) ? `Вчера, ${s}` : d === addDays(t, 1) ? `Завтра, ${s}` : s;
};

const weekStart = (d: string) => addDays(d, -((new Date(d + "T00:00:00").getDay() + 6) % 7));

// Дневник питания: кольца «съедено из цели», приёмы пищи, быстрый ввод.
// asTrainer — тот же экран в профиле подопечного у тренера: только чтение, неделя цветными
// днями, своя цель тренера и комментарий к дню (клиент видит его карточкой).
export default function NutritionDiary({ clientId, legacyLogs = [], measurements = [], asTrainer = false, embedded = false, addRequest = 0 }: {
  clientId: string; legacyLogs?: NutritionLog[]; measurements?: Measurement[]; asTrainer?: boolean;
  /** Внутри другого раздела (вкладка «Я») — без крупного заголовка */
  embedded?: boolean;
  /** Растёт — открыть добавление еды на сегодня в приём по времени суток («+» во вкладке «Я») */
  addRequest?: number;
}) {
  const [mode, setMode] = useState<"diary" | "report">("diary");
  const [date, setDate] = useState(today());
  const [entries, setEntries] = useState<FoodEntry[] | null>(null);
  // Предыдущий день — для «Как вчера» у пустого приёма
  const [prev, setPrev] = useState<FoodEntry[]>([]);
  const [copying, setCopying] = useState<{ list: FoodEntry[]; meal?: Meal; title?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [goals, setGoals] = useState<Goals>({ trainer: null, client: null });
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<FoodEntry | null>(null);
  const [showGoals, setShowGoals] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!addRequest) return;
    const h = new Date().getHours();
    setMode("diary"); setDate(today());
    setAdding(h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 21 ? "dinner" : "snack");
  }, [addRequest]);
  const [day, setDay] = useState<NutritionDay>(api.EMPTY_DAY);
  // Для тренера: ккал по дням недели выбранной даты — цветная полоска
  const [week, setWeek] = useState<Map<string, number>>(new Map());
  const wk = weekStart(date);
  useEffect(() => {
    let alive = true;
    setDay(api.EMPTY_DAY);
    api.fetchDay(clientId, date).then((d) => { const w = api.pendingWater(clientId, date); if (alive) setDay(w == null ? d : { ...d, waterCups: w }); }).catch((e) => console.error("[NutritionDiary] день:", e));
    return () => { alive = false; };
  }, [clientId, date]);
  useEffect(() => {
    if (!asTrainer) return;
    let alive = true;
    api.fetchEntries(clientId, wk, addDays(wk, 6)).then((l) => {
      if (!alive) return;
      const m = new Map<string, number>();
      for (const e of l) m.set(e.date, (m.get(e.date) ?? 0) + e.kcal);
      for (const x of legacyLogs) if (!m.has(x.date) && x.date >= wk && x.date <= addDays(wk, 6)) m.set(x.date, x.calories);
      setWeek(m);
    }).catch((e) => console.error("[NutritionDiary] неделя:", e));
    return () => { alive = false; };
  }, [clientId, wk, asTrainer]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.fetchGoals(clientId).then(setGoals).catch((e) => console.error("[NutritionDiary] цели:", e)); }, [clientId]);
  // Очередь отправки дослала еду — перечитываем день, чтобы «ждёт отправки» сменилось на обычную запись
  const [sentTick, setSentTick] = useState(0);
  useEffect(() => {
    const count = () => pending(undefined, "food").length + pending(undefined, "foodOp").length;
    let n = count();
    return subscribeOutbox(() => { const m = count(); if (m < n) setSentTick((t) => t + 1); n = m; });
  }, []);
  useEffect(() => {
    let alive = true;
    if (!sentTick) { setEntries(null); setPrev([]); }
    setError("");
    const before = addDays(date, -1);
    api.fetchEntries(clientId, before, date).then((l) => { if (alive) { setEntries(api.applyPendingOps(clientId, date, [...l.filter((e) => e.date === date), ...api.pendingFood(clientId, date)])); setPrev(l.filter((e) => e.date === before)); } })
      .catch((e) => { console.error("[NutritionDiary] записи:", e); if (alive) { setEntries(api.applyPendingOps(clientId, date, api.pendingFood(clientId, date))); setError(isNetworkError(e) ? "Нет интернета, а этот день на телефоне ещё не открывали. Добавленное сейчас сохранится и отправится само." : "Не удалось загрузить дневник."); } });
    return () => { alive = false; };
  }, [clientId, date, sentTick]);

  const goal = api.activeGoal(goals);
  const eaten = api.sum(entries ?? []);
  const legacy = legacyLogs.find((l) => l.date === date);
  const prevLabel = date === today() ? "Как вчера" : `Как ${new Date(addDays(date, -1) + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "")}`;
  const repeatPrev = async (meal: Meal) => {
    if (busy) return;
    setBusy(true);
    try { const added = await api.copyEntriesOrQueue(clientId, prev.filter((e) => e.meal === meal), date); setEntries((l) => [...(l ?? []), ...added]); }
    catch (e) { console.error("[NutritionDiary] как вчера:", e); notify("Не удалось скопировать. Проверь интернет."); }
    finally { setBusy(false); }
  };

  // ── Перенос между приёмами пищи этого дня ──
  // Меню «…» у приёма, окно «Куда перенести», режим выбора записей галочками
  const [menu, setMenu] = useState<{ meal: Meal; at: DOMRect } | null>(null);
  const [moving, setMoving] = useState<{ list: FoodEntry[]; title: string } | null>(null);
  const [sel, setSel] = useState<{ ids: Set<string>; meal: Meal } | null>(null);
  const [flash, setFlash] = useState<Meal | null>(null);
  const selecting = sel !== null;
  // Режим выбора — своя запись в истории: «назад» (жест, кнопка Android) выходит из него.
  // Выходим через history.back(), чтобы запись не оставалась висеть. selHist — наша запись
  // ещё в стеке: второй back() (двойной тап, «назад» во время переноса) увёл бы с экрана.
  const selHist = useRef(false);
  useEffect(() => {
    if (!selecting) return;
    history.pushState({ ...history.state, foodSel: true }, "");
    selHist.current = true;
    const onPop = () => { selHist.current = false; setSel(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [selecting]);
  const exitSel = () => { if (selHist.current) { selHist.current = false; history.back(); } };
  // Ушли с экрана в режиме выбора — убираем свою запись, если она ещё сверху
  useEffect(() => () => { if (selHist.current && history.state?.foodSel) { selHist.current = false; history.back(); } }, []);
  const selected = sel ? (entries ?? []).filter((e) => sel.ids.has(e.id)) : [];
  const toggle = (id: string) => setSel((s) => {
    if (!s) return s;
    const ids = new Set(s.ids);
    if (!ids.delete(id)) ids.add(id);
    return { ...s, ids };
  });
  // Долгое нажатие на запись включает режим выбора с ней отмеченной. firedAt гасит click после
  // долгого нажатия; на телефоне click тогда не приходит — сбрасываем на каждом pointerdown,
  // а без pointerdown (Enter, Switch Control, VoiceOver) гасим только в пределах 800 мс.
  const press = useRef<{ timer?: number; firedAt?: number }>({});
  const swallowClick = () => {
    const t = press.current.firedAt;
    press.current.firedAt = undefined;
    return t !== undefined && Date.now() - t < 800;
  };
  // Где была запись под пальцем: в режиме выбора панели над ней меняются — держим её на месте
  const anchor = useRef<{ el: HTMLElement; top: number } | null>(null);
  const pressStart = (e: FoodEntry, el: HTMLElement) => {
    clearTimeout(press.current.timer);
    press.current = {};
    if (asTrainer || selecting) return;
    press.current.timer = window.setTimeout(() => {
      press.current.firedAt = Date.now();
      anchor.current = { el, top: el.getBoundingClientRect().top };
      setSel({ ids: new Set([e.id]), meal: e.meal });
    }, 500);
  };
  // На pointerup флаг не трогаем: click после долгого касания (где он бывает) приходит позже
  // отдельной задачей и снял бы только что поставленную отметку. Отсчёт 800 мс — от отпускания:
  // мышью click приходит и после долгого удержания. После pointercancel click не будет.
  const pressEnd = () => { clearTimeout(press.current.timer); if (press.current.firedAt) press.current.firedAt = Date.now(); };
  const pressCancel = () => { clearTimeout(press.current.timer); press.current.firedAt = undefined; };
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (a?.el.isConnected) window.scrollBy(0, a.el.getBoundingClientRect().top - a.top);
  }, [selecting]);

  const markMoved = (list: FoodEntry[], to: (e: FoodEntry) => Meal, queued: boolean) => {
    const ids = new Set(list.map((e) => e.id));
    setEntries((l) => (l ?? []).map((e) => (ids.has(e.id) ? { ...e, meal: to(e), pending: e.pending || queued } : e)));
  };
  /**
   * Отмена — обратный перенос каждой записи в её прежний приём (list — записи до переноса).
   * Приёмы по отдельности: ошибка в одном не мешает вернуть остальные; итог — одним сообщением.
   */
  const undoMove = async (list: FoodEntry[]) => {
    let queued = false, missed = 0;
    const failed: FoodEntry[] = [];
    for (const m of new Set(list.map((e) => e.meal))) {
      const part = list.filter((e) => e.meal === m);
      try { const r = await api.moveEntriesOrQueue(clientId, part, m); queued ||= r.queued; missed += r.missed; }
      catch (e) { console.error("[NutritionDiary] отмена переноса:", e); failed.push(...part); }
    }
    const back = new Map(list.filter((e) => !failed.includes(e)).map((e) => [e.id, e.meal]));
    markMoved(list.filter((e) => back.has(e.id)), (e) => back.get(e.id)!, queued);
    // Ждавшая отправки запись могла уже уйти на сервер под новым id — перечитываем день
    if (failed.length || list.some((e) => e.pending)) setSentTick((t) => t + 1);
    const msg = [
      failed.length ? `Не удалось вернуть: ${records(failed.length)}. Перенеси вручную.` : "",
      missed ? `Уже удалены из дневника: ${records(missed)}.` : "",
    ].filter(Boolean).join("\n");
    if (msg) notify(msg, failed.length ? "error" : "info");
  };
  // Тост с «Отменить» от прошлого переноса закрываем: его отмена откатила бы и более позднее действие
  const undoToast = useRef(0);
  const afterMove = (list: FoodEntry[], to: Meal) => {
    track("action", "food_move", { n: list.length });
    setFlash(to);
    setTimeout(() => setFlash((f) => (f === to ? null : f)), 1600);
    dismiss(undoToast.current);
    undoToast.current = notify(`Перенесено в «${mealLabel(to)}»`, "info", { label: "Отменить", run: () => undoMove(list) });
  };
  const moveTo = async (list: FoodEntry[], to: Meal) => {
    try { markMoved(list, () => to, (await api.moveEntriesOrQueue(clientId, list, to)).queued); }
    // Часть могла уйти — перечитываем день, чтобы экран не врал
    catch (e) { setSentTick((t) => t + 1); throw e; }
    afterMove(list, to);
  };
  const deleteSelected = async () => {
    const list = selected;
    if (busy || !list.length) return;
    setBusy(true);
    try {
      if (!(await ask(`Удалить ${records(list.length)} из дневника?`, { ok: "Удалить", danger: true }))) return;
      await api.deleteEntriesOrQueue(clientId, list);
      const ids = new Set(list.map((e) => e.id));
      setEntries((l) => (l ?? []).filter((e) => !ids.has(e.id)));
      exitSel();
      notify(`Удалено: ${records(list.length)}`);
    } catch (e) {
      console.error("[NutritionDiary] удаление:", e);
      notify("Не удалось удалить. Проверь интернет.");
      setSentTick((t) => t + 1);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {sel ? (
        <div className="sticky z-30 flex items-center gap-1 min-h-11 bg-zinc-950" style={{ top: "env(safe-area-inset-top)" }}>
          <button onClick={exitSel} className="h-11 px-3 -ml-3 rounded-xl text-sm font-semibold text-zinc-300 hover:bg-zinc-900 transition">Отмена</button>
          <b className="flex-1 text-center text-[17px]" aria-live="polite">Выбрано {sel.ids.size}</b>
          {(() => {
            const rest = (entries ?? []).filter((e) => e.meal === sel.meal && !sel.ids.has(e.id));
            return rest.length > 0
              ? <button onClick={() => setSel({ ...sel, ids: new Set([...sel.ids, ...rest.map((e) => e.id)]) })} className="h-11 px-3 -mr-3 rounded-xl text-sm font-semibold text-lime-400 hover:bg-zinc-900 transition">Все в «{MEAL_IN[sel.meal]}»</button>
              : <span className="w-[72px]" />;
          })()}
        </div>
      ) : (
      <div className="flex items-center justify-between">
        {asTrainer || embedded ? <p className="text-[17px] font-bold">Дневник питания</p> : <h1 className="text-[26px] font-extrabold tracking-tight">Питание</h1>}
        <div className="flex items-center gap-1">
          {!asTrainer && (
            <button onClick={() => setShowCatalog(true)} className="h-11 px-3.5 flex items-center gap-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 transition">
              <BookOpen size={18} /> Продукты
            </button>
          )}
          <button onClick={() => setShowGoals(true)} aria-label="Цели питания" className="w-11 h-11 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"><Target size={22} /></button>
        </div>
      </div>
      )}

      {/* В режиме выбора переключатель не прячем, а выключаем — иначе список прыгнул бы под пальцем */}
      <div className="flex p-1 rounded-xl bg-zinc-900 border border-zinc-800">
        {([["diary", "Дневник"], ["report", "Отчёты"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => { setMode(k); track("view", k === "report" ? "nutrition_report" : "nutrition_diary"); }} aria-pressed={mode === k} disabled={selecting}
            className={`flex-1 h-9 rounded-lg text-sm font-semibold transition disabled:opacity-40 ${mode === k ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 enabled:hover:text-zinc-100"}`}>{l}</button>
        ))}
      </div>

      {mode === "report" ? (
        <NutritionReport clientId={clientId} goal={goal} legacyLogs={legacyLogs} measurements={measurements} onOpenDay={(d) => { setDate(d); setMode("diary"); }} />
      ) : (<>
      {asTrainer && <WeekStrip start={wk} kcal={week} goal={goal?.kcal ?? 0} sel={date} onPick={setDate} />}
      <div className="flex items-center justify-between h-11 px-1 rounded-xl bg-zinc-900 border border-zinc-800">
        <button onClick={() => setDate(addDays(date, -1))} disabled={selecting} aria-label="Предыдущий день" className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 transition disabled:opacity-30"><ChevronLeft size={20} /></button>
        <button onClick={() => setDate(today())} disabled={selecting} className="font-bold text-[15px]">{dayTitle(date)}</button>
        <button onClick={() => setDate(addDays(date, 1))} disabled={selecting || date >= today()} aria-label="Следующий день" className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 transition disabled:opacity-30"><ChevronRight size={20} /></button>
      </div>

      <SummaryCard eaten={eaten} goal={goal} onSetGoal={() => setShowGoals(true)} />
      <WaterCard cups={day.waterCups} goal={api.activeWater(goals)} readOnly={asTrainer} onChange={async (n) => {
        const was = day.waterCups;
        setDay((d) => ({ ...d, waterCups: n }));
        track("action", "water", { cups: n });
        try { await api.setWaterOrQueue(clientId, date, n); }
        catch (e) { console.error("[NutritionDiary] вода:", e); setDay((d) => ({ ...d, waterCups: was })); notify("Не удалось сохранить воду. Проверь интернет."); }
      }} />

      {asTrainer
        ? <CommentBox key={date} clientId={clientId} date={date} initial={day.trainerComment} onSaved={(t) => setDay((d) => ({ ...d, trainerComment: t }))} />
        : day.trainerComment && (
          <div className="flex gap-2.5 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3" style={{ boxShadow: "inset 3px 0 0 var(--accent)" }}>
            <MessageSquare size={18} className="text-lime-400 shrink-0 mt-0.5" />
            <p className="text-sm leading-snug whitespace-pre-wrap"><b>Тренер:</b> <span className="text-zinc-300">{day.trainerComment}</span></p>
          </div>
        )}

      {error && <p className="text-sm text-red-400 px-1">{error}</p>}
      {legacy && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3">
          <p className="font-semibold">Запись за день</p>
          <p className="text-[13px] text-zinc-400 mt-0.5">{api.fmtN(legacy.calories, 0)} ккал · Б {api.fmtN(legacy.protein)} · Ж {api.fmtN(legacy.fat)} · У {api.fmtN(legacy.carbs)} — внесено итогом, до дневника по приёмам</p>
        </div>
      )}

      {entries === null ? <SkeletonRows rows={3} /> : api.MEALS.map(({ key, label }) => {
        const list = entries.filter((e) => e.meal === key);
        const total = api.sum(list);
        const Icon = MEAL_ICON[key];
        const prevList = list.length ? [] : prev.filter((e) => e.meal === key);
        return (
          <div key={key} className={`bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden transition-shadow duration-500 ${flash === key ? "ring-2 ring-lime-400" : ""}`}>
            <div className="flex items-center gap-2.5 px-4 py-3">
              <Icon size={19} style={{ color: list.length ? MACRO_COLOR.kcal : undefined }} className={list.length ? "" : "text-zinc-500"} />
              <span className={`font-bold ${list.length ? "" : "text-zinc-400"}`}>{label}</span>
              <span className="ml-auto text-sm font-bold text-zinc-400">{list.length ? `${api.fmtN(total.kcal, 0)} ккал` : "—"}</span>
              {list.length > 0 && !asTrainer && !sel && (
                <button onClick={(ev) => setMenu({ meal: key, at: ev.currentTarget.getBoundingClientRect() })} aria-label={`Действия с «${label}»`} aria-haspopup="menu" aria-expanded={menu?.meal === key}
                  className={`w-11 h-11 -my-2.5 -mr-3 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition ${menu?.meal === key ? "bg-zinc-800 text-zinc-100" : ""}`}><MoreHorizontal size={18} /></button>
              )}
            </div>
            {list.map((e) => {
              const on = !!sel?.ids.has(e.id);
              return (
                <button key={e.id} disabled={asTrainer} {...(sel ? { role: "checkbox", "aria-checked": on } : {})}
                  onClick={() => { if (swallowClick()) return; if (sel) toggle(e.id); else setEditing(e); }}
                  onPointerDown={(ev) => pressStart(e, ev.currentTarget)} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressCancel}
                  onContextMenu={(ev) => { if (!asTrainer) ev.preventDefault(); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 border-t border-zinc-800 text-left select-none [-webkit-touch-callout:none] transition ${on ? "bg-lime-400/10" : "enabled:hover:bg-zinc-800/50"}`}>
                  {sel && (
                    <span className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-lg ${on ? "bg-lime-400 text-zinc-950" : "border-2 border-zinc-500"}`}>{on && <Check size={16} strokeWidth={3} />}</span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold truncate">{e.name}</span>
                    <span className="block text-[13px] text-zinc-500">{api.fmtN(e.grams, 0)} г · Б {api.fmtN(e.protein)} · Ж {api.fmtN(e.fat)} · У {api.fmtN(e.carbs)}{e.pending && <span className="text-orange-400"> · ждёт отправки</span>}</span>
                  </span>
                  <span className="text-sm font-bold shrink-0">{api.fmtN(e.kcal, 0)}</span>
                </button>
              );
            })}
            {!asTrainer && !sel && <div className="flex border-t border-zinc-800">
              <button onClick={() => setAdding(key)} className="flex-1 flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-lime-400 hover:bg-zinc-800/50 transition"><Plus size={17} /> Добавить</button>
              {prevList.length > 0 && (
                <button onClick={() => repeatPrev(key)} disabled={busy} className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition disabled:opacity-40">
                  <RotateCcw size={15} /> {prevLabel} · {api.fmtN(api.sum(prevList).kcal, 0)} ккал
                </button>
              )}
            </div>}
          </div>
        );
      })}

      {entries && entries.length > 0 && !asTrainer && !sel && (
        <button onClick={() => setCopying({ list: entries })} className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-semibold text-zinc-300 hover:text-zinc-100 transition"><Copy size={16} /> Скопировать весь день</button>
      )}

      </>)}

      {sel && (<>
        {/* Место под панелью действий: она выше нижней панели вкладок */}
        <div className="h-6" />
        {/* Панель может появиться под пальцем долгого нажатия: click от того же касания (без своего
            pointerdown) гасим по press.firedAt, новое касание панели флаг сбрасывает */}
        <div onPointerDown={() => { press.current.firedAt = undefined; }}className="fixed inset-x-0 bottom-0 z-[45] bg-zinc-900 border-t border-zinc-800 px-3 pt-2.5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}>
          <div className="max-w-lg mx-auto grid grid-cols-[1.3fr_1fr_1fr] gap-2">
            {([
              ["Перенести", ArrowRightLeft, () => setMoving({ list: selected, title: `Перенести ${records(selected.length)}` }), "bg-lime-400 text-zinc-950 hover:bg-lime-300"],
              ["Копировать", Copy, () => setCopying({ list: selected, title: `Скопировать ${records(selected.length)}` }), "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"],
              ["Удалить", Trash2, deleteSelected, "bg-zinc-800 text-red-400 [.light-theme_&]:text-[#c9302c] hover:bg-zinc-700"],
            ] as const).map(([l, I, run, cls]) => (
              <button key={l} onClick={() => { if (!swallowClick()) run(); }} disabled={!selected.length || busy}
                className={`h-[52px] flex flex-col items-center justify-center gap-0.5 rounded-xl text-[13px] font-semibold transition disabled:opacity-40 ${cls}`}><I size={20} />{l}</button>
            ))}
          </div>
        </div>
      </>)}

      {menu && (
        <MealMenu label={mealLabel(menu.meal)} at={menu.at} onClose={() => setMenu(null)} onPick={(k) => {
          const list = (entries ?? []).filter((e) => e.meal === menu.meal);
          setMenu(null);
          if (k === "select") setSel({ ids: new Set(), meal: menu.meal });
          if (k === "move") setMoving({ list, title: `Перенести весь «${mealLabel(menu.meal)}»` });
          if (k === "copy") setCopying({ list, meal: menu.meal });
        }} />
      )}
      {moving && (
        <MoveSheet title={moving.title} list={moving.list} entries={entries ?? []} onClose={() => setMoving(null)}
          onMove={async (to) => { await moveTo(moving.list, to); setMoving(null); if (sel) exitSel(); }} />
      )}
      {copying && (
        <FoodCopySheet list={copying.list} meal={copying.meal} title={copying.title} from={date} onClose={() => setCopying(null)}
          onCopy={async (to, meal) => {
            const added = await api.copyEntriesOrQueue(clientId, copying.list, to, meal);
            setCopying(null);
            if (sel) exitSel();
            if (to === date) setEntries((l) => [...(l ?? []), ...added]); else setDate(to);
          }} />
      )}
      {adding && (
        <FoodAddSheet clientId={clientId} date={date} meal={adding} onClose={() => setAdding(null)}
          onAdded={(e) => setEntries((l) => [...(l ?? []), e])} />
      )}
      {editing && (
        <EntrySheet clientId={clientId} entry={editing} onClose={() => setEditing(null)}
          onSaved={(e, from) => { setEntries((l) => (l ?? []).map((x) => (x.id === e.id ? e : x))); setEditing(null); if (from) afterMove([{ ...e, meal: from }], e.meal); }}
          onDeleted={(id) => { setEntries((l) => (l ?? []).filter((x) => x.id !== id)); setEditing(null); }} />
      )}
      {showGoals && <NutritionGoalsSheet clientId={clientId} goals={goals} asTrainer={asTrainer} measurements={measurements} onSaved={setGoals} onClose={() => setShowGoals(false)} />}
      {showCatalog && (
        <Suspense fallback={null}>
          <NutritionCatalog clientId={clientId} date={date}
            onAdded={(e) => { if (e.date === date) setEntries((l) => [...(l ?? []), e]); }}
            onClose={() => setShowCatalog(false)} />
        </Suspense>
      )}
    </div>
  );
}

// Вода стаканами по 250 мл: нажатие на стакан ставит столько, повторное на последний — минус один
function WaterCard({ cups, goal, readOnly, onChange }: { cups: number; goal: number; readOnly: boolean; onChange: (n: number) => void }) {
  const n = Math.max(goal, cups);
  const btn = "w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition disabled:opacity-30";
  return (
    <div className="flex items-center gap-2.5 bg-zinc-900 border border-zinc-800 rounded-2xl px-3.5 py-3">
      <GlassWater size={20} className="shrink-0" style={{ color: WATER }} />
      <div className="flex gap-1 flex-1 min-w-0" role="group" aria-label="Вода">
        {Array.from({ length: n }, (_, i) => (
          <button key={i} onClick={() => onChange(cups === i + 1 ? i : i + 1)} disabled={readOnly} aria-label={`${i + 1} стакан`}
            className="flex-1 h-8 rounded-lg transition" style={{ background: i < cups ? WATER : EMPTY_CELL }} />
        ))}
      </div>
      <span className="text-sm font-bold shrink-0 tabular-nums">{cups}/{goal}</span>
      {!readOnly && (
        <>
          <button onClick={() => onChange(cups - 1)} disabled={cups <= 0} aria-label="Минус стакан" className={btn}><Minus size={17} /></button>
          <button onClick={() => onChange(cups + 1)} aria-label="Плюс стакан" className={btn}><Plus size={17} /></button>
        </>
      )}
    </div>
  );
}

// Неделя цветными днями (для тренера): зелёный — ±10% от цели, жёлтый — недобор, красный — перебор
function WeekStrip({ start, kcal, goal, sel, onPick }: { start: string; kcal: Map<string, number>; goal: number; sel: string; onPick: (d: string) => void }) {
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const logged = days.filter((d) => kcal.has(d) && d !== t);
  const norm = logged.filter((d) => goal > 0 && Math.abs(kcal.get(d)! - goal) <= goal * 0.1).length;
  const color = (d: string) => {
    const v = kcal.get(d);
    if (v == null) return EMPTY_CELL;
    if (!goal || d === t) return MACRO_COLOR.kcal;
    return Math.abs(v - goal) <= goal * 0.1 ? "#c6ff3d" : v > goal ? OVER : "#f5a524";
  };
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5">
      <div className="flex justify-between items-baseline"><b>Неделя</b>{goal > 0 && logged.length > 0 && <span className="text-[13px] text-zinc-400">в норме {norm} из {logged.length}</span>}</div>
      <div className="grid grid-cols-7 gap-1.5 mt-2.5">
        {days.map((d, i) => (
          <button key={d} onClick={() => d <= t && onPick(d)} disabled={d > t} aria-pressed={d === sel} aria-label={new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
            className="flex flex-col items-center gap-1 disabled:opacity-40">
            <i className={`block w-full h-7 rounded-lg ${d === sel ? "ring-2 ring-zinc-100" : ""}`} style={{ background: color(d) }} />
            <span className={`text-[12px] ${d === sel ? "text-zinc-100 font-bold" : "text-zinc-500"}`}>{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][i]}</span>
          </button>
        ))}
      </div>
      {goal > 0 && <p className="text-[12px] text-zinc-500 mt-2">Зелёный — ±10% от цели, жёлтый — недобор, красный — перебор.</p>}
    </div>
  );
}

// Комментарий тренера к дню — клиент видит его на экране дня
function CommentBox({ clientId, date, initial, onSaved }: { clientId: string; date: string; initial: string; onSaved: (t: string) => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setText(initial); }, [initial]);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try { await api.saveTrainerComment(clientId, date, text); track("action", "nutrition_comment"); onSaved(text.trim()); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    catch (e) { console.error("[CommentBox]", e); notify("Не удалось сохранить комментарий."); }
    finally { setBusy(false); }
  };
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5">
      <p className="font-bold mb-2 flex items-center gap-1.5"><MessageSquare size={16} className="text-lime-400" /> Комментарий к дню</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Например: мало белка на ужин — добавь творог"
        className="w-full bg-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-lime-400/50 resize-none" />
      <button onClick={save} disabled={busy || text.trim() === initial.trim()}
        className="mt-2 w-full h-10 flex items-center justify-center gap-1.5 rounded-xl bg-lime-400 text-zinc-950 text-sm font-bold hover:bg-lime-300 transition disabled:opacity-40">
        {saved ? <><Check size={16} /> Сохранено — клиент увидит</> : busy ? "Сохраняю…" : "Сохранить"}
      </button>
    </div>
  );
}

// Кольцо ккал и полоски БЖУ: съедено из цели и сколько осталось. Перебор — красным.
function SummaryCard({ eaten, goal, onSetGoal }: { eaten: Macros; goal: Macros | null; onSetGoal: () => void }) {
  const R = 50, C = 2 * Math.PI * R;
  const share = (k: keyof Macros) => (goal && goal[k] > 0 ? eaten[k] / goal[k] : 0);
  const over = (k: keyof Macros) => share(k) > 1.05;
  // Из округлённых чисел — чтобы «съедено + осталось» на экране сходилось с целью
  const left = (k: keyof Macros) => (goal ? Math.round(goal[k]) - Math.round(eaten[k]) : 0);
  const bars: { k: keyof Macros; label: string }[] = [{ k: "protein", label: "Белки" }, { k: "fat", label: "Жиры" }, { k: "carbs", label: "Углеводы" }];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl">
      <div className="flex items-center gap-4 p-4">
        <div className="relative w-[116px] h-[116px] shrink-0">
          <svg width="116" height="116" className="-rotate-90" aria-hidden>
            <circle cx="58" cy="58" r={R} stroke={EMPTY_CELL} strokeWidth="12" fill="none" />
            <circle cx="58" cy="58" r={R} stroke={over("kcal") ? OVER : MACRO_COLOR.kcal} strokeWidth="12" fill="none" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, share("kcal")))} style={{ transition: "stroke-dashoffset .4s ease" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <b className="font-display text-2xl font-extrabold tracking-tight leading-none">{api.fmtN(eaten.kcal, 0)}</b>
            <small className="text-xs text-zinc-400 mt-1">{goal ? `из ${api.fmtN(goal.kcal, 0)} ккал` : "ккал"}</small>
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-2.5">
          {bars.map(({ k, label }) => (
            <div key={k}>
              <div className="flex justify-between text-[13px] text-zinc-400">{label}<span><b className="text-zinc-100">{api.fmtN(eaten[k], 0)}</b>{goal ? ` / ${api.fmtN(goal[k], 0)} г` : " г"}</span></div>
              <div className="h-2 rounded-full bg-zinc-800 mt-1 overflow-hidden">
                <i className="block h-full rounded-full" style={{ width: `${Math.min(100, share(k) * 100)}%`, background: over(k) ? OVER : MACRO_COLOR[k], transition: "width .4s ease" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {goal ? (
        <div className="grid grid-cols-4 gap-1.5 px-4 pb-4">
          {(["kcal", "protein", "fat", "carbs"] as const).map((k) => {
            const v = left(k);
            return (
              <div key={k} className="text-center py-2 rounded-xl bg-zinc-800">
                <b className="block text-[15px] font-extrabold" style={{ color: v < 0 && over(k) ? OVER : MACRO_COLOR[k] }}>{api.fmtN(Math.abs(v), 0)}{k === "kcal" ? "" : " г"}</b>
                <small className="text-[11px] text-zinc-400">{v < 0 ? "сверх цели" : k === "kcal" ? "ккал осталось" : { protein: "белка", fat: "жиров", carbs: "углеводов" }[k]}</small>
              </div>
            );
          })}
        </div>
      ) : (
        <button onClick={onSetGoal} className="mx-4 mb-4 w-[calc(100%-2rem)] h-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold transition">Задать цель по КБЖУ</button>
      )}
    </div>
  );
}

// Правка граммов и приёма пищи (перенос) или удаление записи. from — прежний приём, если перенесли.
function EntrySheet({ clientId, entry, onSaved, onDeleted, onClose }: { clientId: string; entry: FoodEntry; onSaved: (e: FoodEntry, from?: Meal) => void; onDeleted: (id: string) => void; onClose: () => void }) {
  const initGrams = String(api.fmtN(entry.grams, 0)).replace(/\s/g, "");
  const [grams, setGrams] = useState(initGrams);
  const [meal, setMeal] = useState(entry.meal);
  const [busy, setBusy] = useState(false);
  const g = api.num(grams);
  const k = entry.grams > 0 ? g / entry.grams : 0;
  const preview = { kcal: entry.kcal * k, protein: entry.protein * k, fat: entry.fat * k, carbs: entry.carbs * k };
  const run = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); try { await f(); } catch (e) { console.error("[EntrySheet]", e); notify("Не удалось сохранить. Проверь интернет."); } finally { setBusy(false); } };

  return (
    <ModalShell title={entry.name} onClose={onClose}>
      <div className="p-4 space-y-3">
        <GramsInput value={grams} onChange={setGrams} />
        <MacroTiles m={preview} />
        <div>
          <p className="flex justify-between gap-2 text-[13px] font-semibold text-zinc-400 mt-1 mb-3 px-0.5">Приём пищи <span className="font-medium text-zinc-500">нажми, чтобы перенести</span></p>
          <div role="radiogroup" aria-label="Приём пищи" className="grid grid-cols-4 gap-1.5">
            {api.MEALS.map(({ key, label }) => {
              const Icon = MEAL_ICON[key];
              const on = meal === key;
              return (
                <button key={key} role="radio" aria-checked={on} onClick={() => setMeal(key)} aria-label={key === entry.meal ? `${label}, сейчас` : label}
                  className={`relative h-16 flex flex-col items-center justify-center gap-1 rounded-xl text-[13px] font-semibold transition ${on ? "bg-lime-400/15 ring-2 ring-lime-400 text-zinc-100" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
                  {key === entry.meal && <span className="absolute -top-2 px-1.5 rounded-full bg-zinc-700 text-[11px] font-bold text-zinc-300" aria-hidden>сейчас</span>}
                  <Icon size={20} />{label}
                </button>
              );
            })}
          </div>
        </div>
        <button disabled={busy || !g} onClick={() => run(async () => {
          // Граммы трогаем, только если их поменяли: иначе сохранение округлило бы дробные
          let next = grams === initGrams ? entry : await api.updateEntryGramsOrQueue(clientId, entry, g);
          if (meal !== entry.meal) next = { ...next, meal, pending: next.pending || (await api.moveEntriesOrQueue(clientId, [next], meal)).queued };
          onSaved(next, meal !== entry.meal ? entry.meal : undefined);
        })}
          className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">{meal !== entry.meal ? `Сохранить · в «${mealLabel(meal)}»` : "Сохранить"}</button>
        <button onClick={async () => { if (await ask("Удалить запись из дневника?", { ok: "Удалить", danger: true })) run(async () => { await api.deleteEntryOrQueue(clientId, entry); onDeleted(entry.id); }); }} disabled={busy}
          className="w-full h-11 flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-red-400 hover:bg-red-500/10 transition"><Trash2 size={16} /> Удалить из дневника</button>
      </div>
    </ModalShell>
  );
}

// Меню «…» у приёма пищи. Стоит под кнопкой, у низа экрана — над ней.
function MealMenu({ label, at, onPick, onClose }: { label: string; at: DOMRect; onPick: (k: "select" | "move" | "copy") => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Прокрутка уводит кнопку из-под меню — закрываем (мелкий сдвиг не в счёт)
    const y0 = window.scrollY;
    const onScroll = () => { if (Math.abs(window.scrollY - y0) > 10) onClose(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll); };
  }, [onClose]);
  const up = at.bottom + 170 > window.innerHeight;
  const items = [["select", ListChecks, "Выбрать записи"], ["move", ArrowRightLeft, `Перенести весь «${label}»`], ["copy", Copy, "Скопировать в другой день"]] as const;
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div role="menu" aria-label={label} onClick={(e) => e.stopPropagation()}
        className="absolute w-[280px] max-w-[calc(100vw-24px)] rounded-2xl bg-zinc-800 border border-zinc-700 shadow-xl shadow-black/40 overflow-hidden divide-y divide-zinc-700"
        style={{ right: Math.max(12, window.innerWidth - at.right), ...(up ? { bottom: window.innerHeight - at.top + 4 } : { top: at.bottom + 4 }) }}>
        {items.map(([k, I, l], i) => (
          <button key={k} ref={i === 0 ? first : undefined} role="menuitem" onClick={() => onPick(k)}
            className="w-full h-12 flex items-center gap-3 px-3.5 text-[15px] text-left whitespace-nowrap text-zinc-100 hover:bg-zinc-700 transition outline-none focus-visible:bg-zinc-700"><I size={20} className="text-zinc-400 shrink-0" />{l}</button>
        ))}
      </div>
    </div>
  );
}

// Куда перенести: под каждым приёмом — сколько там сейчас и сколько станет
function MoveSheet({ title, list, entries, onMove, onClose }: { title: string; list: FoodEntry[]; entries: FoodEntry[]; onMove: (to: Meal) => Promise<void>; onClose: () => void }) {
  const [to, setTo] = useState<Meal | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!to || busy) return;
    setBusy(true);
    try { await onMove(to); }
    catch (e) { console.error("[MoveSheet]", e); notify(e instanceof Error && e.message === api.MOVE_PARTIAL ? e.message : "Не удалось перенести. Проверь интернет."); setBusy(false); }
  };
  const names = list.slice(0, 3).map((e) => e.name).join(", ") + (list.length > 3 ? ` и ещё ${list.length - 3}` : "");
  return (
    <ModalShell title={title} icon={<ArrowRightLeft size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-4">
        <p className="text-sm text-zinc-400">{names} · {api.fmtN(api.sum(list).kcal, 0)} ккал</p>
        <div role="radiogroup" aria-label="Приём пищи" className="rounded-2xl bg-zinc-800 overflow-hidden divide-y divide-zinc-700">
          {api.MEALS.map(({ key, label }) => {
            const Icon = MEAL_ICON[key];
            const here = entries.filter((e) => e.meal === key);
            const off = list.every((e) => e.meal === key);
            const on = to === key;
            const now = api.sum(here).kcal;
            const next = now + api.sum(list.filter((e) => e.meal !== key)).kcal;
            return (
              <button key={key} role="radio" aria-checked={on} disabled={off} onClick={() => setTo(key)}
                className="w-full min-h-[56px] flex items-center gap-3 px-3.5 py-2 text-left enabled:hover:bg-zinc-700/50 transition disabled:opacity-50">
                <Icon size={20} className={on ? "" : "text-zinc-500"} style={on ? { color: MACRO_COLOR.kcal } : undefined} />
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-[15px]">{label}</span>
                  <span className="block text-[13px] text-zinc-400">{off ? "записи сейчас здесь" : `${here.length ? `сейчас ${api.fmtN(now, 0)} ккал` : "пусто"} → станет ${api.fmtN(next, 0)} ккал`}</span>
                </span>
                <span className={`w-6 h-6 shrink-0 rounded-full ${on ? "border-[7px] border-lime-400" : "border-2 border-zinc-500"}`} />
              </button>
            );
          })}
        </div>
        <button onClick={go} disabled={!to || busy}
          className="w-full h-12 flex items-center justify-center gap-2 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">
          {busy ? "Переношу…" : to ? `Перенести в «${mealLabel(to)}»` : "Выбери приём пищи"}
        </button>
      </div>
    </ModalShell>
  );
}
