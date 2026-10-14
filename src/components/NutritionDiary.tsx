import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, GlassWater, MessageSquare, Minus, Moon, MoreHorizontal, Plus, RotateCcw, Sun, Sunrise, Target, Cookie, Trash2 } from "lucide-react";
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
import { addDays, today } from "../lib/format";
import { notify } from "../lib/dialog";

const OVER = "#f2555a";
const WATER = "var(--m-water)";
const MEAL_ICON: Record<Meal, typeof Sun> = { breakfast: Sunrise, lunch: Sun, dinner: Moon, snack: Cookie };

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
  const [copying, setCopying] = useState<{ list: FoodEntry[]; meal?: Meal } | null>(null);
  const [busy, setBusy] = useState(false);
  const [goals, setGoals] = useState<Goals>({ trainer: null, client: null });
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<FoodEntry | null>(null);
  const [showGoals, setShowGoals] = useState(false);
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
    api.fetchDay(clientId, date).then((d) => { if (alive) setDay(d); }).catch((e) => console.error("[NutritionDiary] день:", e));
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
    let n = pending(undefined, "food").length;
    return subscribeOutbox(() => { const m = pending(undefined, "food").length; if (m < n) setSentTick((t) => t + 1); n = m; });
  }, []);
  useEffect(() => {
    let alive = true;
    if (!sentTick) { setEntries(null); setPrev([]); }
    setError("");
    const before = addDays(date, -1);
    api.fetchEntries(clientId, before, date).then((l) => { if (alive) { setEntries([...l.filter((e) => e.date === date), ...api.pendingFood(clientId, date)]); setPrev(l.filter((e) => e.date === before)); } })
      .catch((e) => { console.error("[NutritionDiary] записи:", e); if (alive) { setEntries(api.pendingFood(clientId, date)); setError(isNetworkError(e) ? "Нет интернета, а этот день на телефоне ещё не открывали. Добавленное сейчас сохранится и отправится само." : "Не удалось загрузить дневник."); } });
    return () => { alive = false; };
  }, [clientId, date, sentTick]);

  const goal = api.activeGoal(goals);
  const eaten = api.sum(entries ?? []);
  const legacy = legacyLogs.find((l) => l.date === date);
  const prevLabel = date === today() ? "Как вчера" : `Как ${new Date(addDays(date, -1) + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "")}`;
  const repeatPrev = async (meal: Meal) => {
    if (busy) return;
    setBusy(true);
    try { const added = await api.copyEntries(clientId, prev.filter((e) => e.meal === meal), date); setEntries((l) => [...(l ?? []), ...added]); }
    catch (e) { console.error("[NutritionDiary] как вчера:", e); notify("Не удалось скопировать. Проверьте интернет."); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {asTrainer || embedded ? <p className="text-[17px] font-bold">Дневник питания</p> : <h1 className="text-[26px] font-extrabold tracking-tight">Питание</h1>}
        <button onClick={() => setShowGoals(true)} aria-label="Цели питания" className="w-11 h-11 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"><Target size={22} /></button>
      </div>

      <div className="flex p-1 rounded-xl bg-zinc-900 border border-zinc-800">
        {([["diary", "Дневник"], ["report", "Отчёты"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} aria-pressed={mode === k}
            className={`flex-1 h-9 rounded-lg text-sm font-semibold transition ${mode === k ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{l}</button>
        ))}
      </div>

      {mode === "report" ? (
        <NutritionReport clientId={clientId} goal={goal} legacyLogs={legacyLogs} measurements={measurements} onOpenDay={(d) => { setDate(d); setMode("diary"); }} />
      ) : (<>
      {asTrainer && <WeekStrip start={wk} kcal={week} goal={goal?.kcal ?? 0} sel={date} onPick={setDate} />}
      <div className="flex items-center justify-between h-11 px-1 rounded-xl bg-zinc-900 border border-zinc-800">
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Предыдущий день" className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 transition"><ChevronLeft size={20} /></button>
        <button onClick={() => setDate(today())} className="font-bold text-[15px]">{dayTitle(date)}</button>
        <button onClick={() => setDate(addDays(date, 1))} disabled={date >= today()} aria-label="Следующий день" className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 transition disabled:opacity-30"><ChevronRight size={20} /></button>
      </div>

      <SummaryCard eaten={eaten} goal={goal} onSetGoal={() => setShowGoals(true)} />
      <WaterCard cups={day.waterCups} goal={api.activeWater(goals)} readOnly={asTrainer} onChange={async (n) => {
        const was = day.waterCups;
        setDay((d) => ({ ...d, waterCups: n }));
        try { await api.setWater(clientId, date, n); }
        catch (e) { console.error("[NutritionDiary] вода:", e); setDay((d) => ({ ...d, waterCups: was })); notify("Не удалось сохранить воду. Проверьте интернет."); }
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
          <div key={key} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3">
              <Icon size={19} style={{ color: list.length ? MACRO_COLOR.kcal : undefined }} className={list.length ? "" : "text-zinc-500"} />
              <span className={`font-bold ${list.length ? "" : "text-zinc-400"}`}>{label}</span>
              <span className="ml-auto text-sm font-bold text-zinc-400">{list.length ? `${api.fmtN(total.kcal, 0)} ккал` : "—"}</span>
              {list.length > 0 && !asTrainer && (
                <button onClick={() => setCopying({ list, meal: key })} aria-label={`Скопировать «${label}»`} className="w-8 h-8 -mr-2 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition"><MoreHorizontal size={18} /></button>
              )}
            </div>
            {list.map((e) => (
              <button key={e.id} onClick={() => setEditing(e)} disabled={asTrainer || e.pending} className="w-full flex items-center gap-3 px-4 py-2.5 border-t border-zinc-800 text-left enabled:hover:bg-zinc-800/50 transition">
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{e.name}</span>
                  <span className="block text-[13px] text-zinc-500">{api.fmtN(e.grams, 0)} г · Б {api.fmtN(e.protein)} · Ж {api.fmtN(e.fat)} · У {api.fmtN(e.carbs)}{e.pending && <span className="text-orange-400"> · ждёт отправки</span>}</span>
                </span>
                <span className="text-sm font-bold shrink-0">{api.fmtN(e.kcal, 0)}</span>
              </button>
            ))}
            {!asTrainer && <div className="flex border-t border-zinc-800">
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

      {entries && entries.length > 0 && !asTrainer && (
        <button onClick={() => setCopying({ list: entries })} className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-semibold text-zinc-300 hover:text-zinc-100 transition"><Copy size={16} /> Скопировать весь день</button>
      )}

      </>)}

      {copying && (
        <FoodCopySheet list={copying.list} meal={copying.meal} from={date} onClose={() => setCopying(null)}
          onCopy={async (to, meal) => {
            const added = await api.copyEntries(clientId, copying.list, to, meal);
            setCopying(null);
            if (to === date) setEntries((l) => [...(l ?? []), ...added]); else setDate(to);
          }} />
      )}
      {adding && (
        <FoodAddSheet clientId={clientId} date={date} meal={adding} onClose={() => setAdding(null)}
          onAdded={(e) => setEntries((l) => [...(l ?? []), e])} />
      )}
      {editing && (
        <EntrySheet entry={editing} onClose={() => setEditing(null)}
          onSaved={(e) => { setEntries((l) => (l ?? []).map((x) => (x.id === e.id ? e : x))); setEditing(null); }}
          onDeleted={(id) => { setEntries((l) => (l ?? []).filter((x) => x.id !== id)); setEditing(null); }} />
      )}
      {showGoals && <NutritionGoalsSheet clientId={clientId} goals={goals} asTrainer={asTrainer} measurements={measurements} onSaved={setGoals} onClose={() => setShowGoals(false)} />}
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
    return Math.abs(v - goal) <= goal * 0.1 ? "#a3e635" : v > goal ? OVER : "#f5a524";
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
    try { await api.saveTrainerComment(clientId, date, text); onSaved(text.trim()); setSaved(true); setTimeout(() => setSaved(false), 2000); }
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
            <b className="text-2xl font-extrabold tracking-tight leading-none">{api.fmtN(eaten.kcal, 0)}</b>
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

// Правка граммов или удаление записи
function EntrySheet({ entry, onSaved, onDeleted, onClose }: { entry: FoodEntry; onSaved: (e: FoodEntry) => void; onDeleted: (id: string) => void; onClose: () => void }) {
  const [grams, setGrams] = useState(String(api.fmtN(entry.grams, 0)).replace(/\s/g, ""));
  const [busy, setBusy] = useState(false);
  const g = api.num(grams);
  const k = entry.grams > 0 ? g / entry.grams : 0;
  const preview = { kcal: entry.kcal * k, protein: entry.protein * k, fat: entry.fat * k, carbs: entry.carbs * k };
  const run = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); try { await f(); } catch (e) { console.error("[EntrySheet]", e); notify("Не удалось сохранить. Проверьте интернет."); } finally { setBusy(false); } };

  return (
    <ModalShell title={entry.name} onClose={onClose}>
      <div className="p-4 space-y-3">
        <GramsInput value={grams} onChange={setGrams} />
        <MacroTiles m={preview} />
        <button onClick={() => run(async () => onSaved(await api.updateEntryGrams(entry, g)))} disabled={busy || !g}
          className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">Сохранить</button>
        <button onClick={() => run(async () => { await api.deleteEntry(entry.id); onDeleted(entry.id); })} disabled={busy}
          className="w-full h-11 flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-red-400 hover:bg-red-500/10 transition"><Trash2 size={16} /> Удалить из дневника</button>
      </div>
    </ModalShell>
  );
}
