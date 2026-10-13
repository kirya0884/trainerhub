import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Moon, MoreHorizontal, Plus, RotateCcw, Sun, Sunrise, Target, Cookie, Trash2 } from "lucide-react";
import ModalShell from "./ModalShell";
import { SkeletonRows } from "./Skeleton";
import FoodAddSheet from "./FoodAddSheet";
import FoodCopySheet from "./FoodCopySheet";
import NutritionGoalsSheet from "./NutritionGoalsSheet";
import { GramsInput, MacroTiles, MACRO_COLOR } from "./NutritionParts";
import * as api from "../lib/foodDiary";
import type { FoodEntry, Goals, Macros, Meal } from "../lib/foodDiary";
import type { NutritionLog } from "../lib/nutrition";
import { addDays, today } from "../lib/format";

const OVER = "#f2555a";
const MEAL_ICON: Record<Meal, typeof Sun> = { breakfast: Sunrise, lunch: Sun, dinner: Moon, snack: Cookie };

const dayTitle = (d: string) => {
  const t = today();
  const s = new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return d === t ? `Сегодня, ${s}` : d === addDays(t, -1) ? `Вчера, ${s}` : d === addDays(t, 1) ? `Завтра, ${s}` : s;
};

// Дневник питания клиента: кольца «съедено из цели», приёмы пищи, быстрый ввод.
export default function NutritionDiary({ clientId, legacyLogs = [] }: { clientId: string; legacyLogs?: NutritionLog[] }) {
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

  useEffect(() => { api.fetchGoals(clientId).then(setGoals).catch((e) => console.error("[NutritionDiary] цели:", e)); }, [clientId]);
  useEffect(() => {
    let alive = true;
    setEntries(null); setPrev([]); setError("");
    const before = addDays(date, -1);
    api.fetchEntries(clientId, before, date).then((l) => { if (alive) { setEntries(l.filter((e) => e.date === date)); setPrev(l.filter((e) => e.date === before)); } })
      .catch((e) => { console.error("[NutritionDiary] записи:", e); if (alive) { setEntries([]); setError("Не удалось загрузить дневник. Проверьте интернет."); } });
    return () => { alive = false; };
  }, [clientId, date]);

  const goal = api.activeGoal(goals);
  const eaten = api.sum(entries ?? []);
  const legacy = legacyLogs.find((l) => l.date === date);
  const prevLabel = date === today() ? "Как вчера" : `Как ${new Date(addDays(date, -1) + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "")}`;
  const repeatPrev = async (meal: Meal) => {
    if (busy) return;
    setBusy(true);
    try { const added = await api.copyEntries(clientId, prev.filter((e) => e.meal === meal), date); setEntries((l) => [...(l ?? []), ...added]); }
    catch (e) { console.error("[NutritionDiary] как вчера:", e); alert("Не удалось скопировать. Проверьте интернет."); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-[26px] font-extrabold tracking-tight">Питание</h1>
        <button onClick={() => setShowGoals(true)} aria-label="Цели питания" className="w-11 h-11 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"><Target size={22} /></button>
      </div>

      <div className="flex items-center justify-between h-11 px-1 rounded-xl bg-zinc-900 border border-zinc-800">
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Предыдущий день" className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 transition"><ChevronLeft size={20} /></button>
        <button onClick={() => setDate(today())} className="font-bold text-[15px]">{dayTitle(date)}</button>
        <button onClick={() => setDate(addDays(date, 1))} disabled={date >= today()} aria-label="Следующий день" className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 transition disabled:opacity-30"><ChevronRight size={20} /></button>
      </div>

      <SummaryCard eaten={eaten} goal={goal} onSetGoal={() => setShowGoals(true)} />

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
              {list.length > 0 && (
                <button onClick={() => setCopying({ list, meal: key })} aria-label={`Скопировать «${label}»`} className="w-8 h-8 -mr-2 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition"><MoreHorizontal size={18} /></button>
              )}
            </div>
            {list.map((e) => (
              <button key={e.id} onClick={() => setEditing(e)} className="w-full flex items-center gap-3 px-4 py-2.5 border-t border-zinc-800 text-left hover:bg-zinc-800/50 transition">
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{e.name}</span>
                  <span className="block text-[13px] text-zinc-500">{api.fmtN(e.grams, 0)} г · Б {api.fmtN(e.protein)} · Ж {api.fmtN(e.fat)} · У {api.fmtN(e.carbs)}</span>
                </span>
                <span className="text-sm font-bold shrink-0">{api.fmtN(e.kcal, 0)}</span>
              </button>
            ))}
            <div className="flex border-t border-zinc-800">
              <button onClick={() => setAdding(key)} className="flex-1 flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-lime-400 hover:bg-zinc-800/50 transition"><Plus size={17} /> Добавить</button>
              {prevList.length > 0 && (
                <button onClick={() => repeatPrev(key)} disabled={busy} className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition disabled:opacity-40">
                  <RotateCcw size={15} /> {prevLabel} · {api.fmtN(api.sum(prevList).kcal, 0)} ккал
                </button>
              )}
            </div>
          </div>
        );
      })}

      {entries && entries.length > 0 && (
        <button onClick={() => setCopying({ list: entries })} className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-semibold text-zinc-300 hover:text-zinc-100 transition"><Copy size={16} /> Скопировать весь день</button>
      )}

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
      {showGoals && <NutritionGoalsSheet clientId={clientId} goals={goals} onSaved={setGoals} onClose={() => setShowGoals(false)} />}
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
            <circle cx="58" cy="58" r={R} stroke="currentColor" strokeWidth="12" fill="none" className="text-zinc-800" />
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
  const run = async (f: () => Promise<void>) => { if (busy) return; setBusy(true); try { await f(); } catch (e) { console.error("[EntrySheet]", e); alert("Не удалось сохранить. Проверьте интернет."); } finally { setBusy(false); } };

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
