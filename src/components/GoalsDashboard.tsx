import { Apple, ChevronDown, ChevronRight, Dumbbell, Footprints, Save, Target } from "lucide-react";
import { useEffect, useState } from "react";
import NutritionGoalsSheet from "./NutritionGoalsSheet";
import {
  type ClientGoals, type DayActivity, type DayNutrition,
  fetchClientGoals, fetchNutritionByDay, fetchActivityByDay, fetchSessionsInPeriod,
  saveClientGoals, dateRange, periodRange,
} from "../lib/goals";
import { activeGoal, fetchGoals, fmtN, type Goals } from "../lib/foodDiary";
import { fetchMeasurements, type Measurement } from "../lib/clients";
import { cached } from "../lib/offlineCache";
import { fmtDate } from "../lib/format";
import { notify } from "../lib/dialog";
import { ScreenSkeleton } from "./Skeleton";

type Period = 7 | 14 | 30;

const ACTIVITY_FIELDS: { key: keyof ClientGoals & string; label: string; unit: string; placeholder: string }[] = [
  { key: "steps", label: "Шаги", unit: "шаг/день", placeholder: "10000" },
  { key: "activeMinutes", label: "Акт. минут", unit: "мин/день", placeholder: "30" },
  { key: "sessionsPerWeek", label: "Тренировок", unit: "в неделю", placeholder: "3" },
];

const OVER = "#f2555a";

function DonutRing({ pct, color, size = 80 }: { pct: number; color: string; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const fill = Math.min(1, pct / 100) * circ;
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={r} fill="none" className="stroke-zinc-800" strokeWidth={9} />
      {pct > 0 && (
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={9}
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`} />
      )}
    </svg>
  );
}

// limit — цель-потолок (калории, жиры, углеводы): больше 110% — перебор, красным и подписью,
// как в дневнике. Белок выше цели — не перебор, у него просто процент.
// 5.15: days — дни с записями, а не все дни периода: пропуск дневника не выглядит недоеданием.
function RingCard({ label, unit, actual, goal, days, color, limit = false }: {
  label: string; unit: string; actual: number; goal: number; days: number; color: string; limit?: boolean;
}) {
  if (!goal) return null;
  const target = goal * days;
  const pct = target > 0 ? (actual / target) * 100 : 0;
  const over = limit && pct > 110;
  const col = over ? OVER : pct >= 90 ? "#c6ff3d" : pct >= 65 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <DonutRing pct={pct} color={over ? OVER : color} size={80} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold" style={{ color: col }}>{Math.round(pct)}%</span>
        </div>
      </div>
      <span className="text-[11px] text-zinc-400 text-center leading-tight">{label}{over && <b className="block font-semibold" style={{ color: OVER }}>перебор</b>}</span>
      <span className="text-[11px] text-zinc-600 text-center">{Math.round(actual)}&nbsp;/&nbsp;{Math.round(target)}&nbsp;{unit}</span>
    </div>
  );
}

function GoalInput({ label, unit, placeholder, value, onChange }: {
  label: string; unit: string; placeholder: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-zinc-500">{label}</label>
      <div className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 border bg-zinc-800 border-zinc-700 focus-within:border-lime-400/40">
        <input type="number" inputMode="numeric" min="0" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} aria-label={label}
          className="w-full bg-transparent text-sm outline-none" />
        <span className="text-xs text-zinc-500 whitespace-nowrap shrink-0">{unit}</span>
      </div>
    </div>
  );
}

export default function GoalsDashboard({ clientId }: { clientId: string }) {
  const [goals, setGoals] = useState<ClientGoals>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [period, setPeriod] = useState<Period>(7);
  const [nutrition, setNutrition] = useState<DayNutrition[]>([]);
  const [activities, setActivities] = useState<DayActivity[]>([]);
  const [sessions, setSessions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [goalsFailed, setGoalsFailed] = useState(false);
  const [dataFailed, setDataFailed] = useState(false);
  // 5.13: КБЖУ и вода — из «Целей питания», тех же, что видит дневник клиента
  const [nutGoals, setNutGoals] = useState<Goals>({ trainer: null, client: null });
  const [nutGoalsFailed, setNutGoalsFailed] = useState(false);
  const [showNutGoals, setShowNutGoals] = useState(false);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  const goalsToDraft = (g: ClientGoals): Record<string, string> =>
    Object.fromEntries(ACTIVITY_FIELDS.map((f) => [f.key, g[f.key] != null ? String(g[f.key]) : ""]));

  const loadAll = async () => {
    setLoading(true);
    const { from, to } = periodRange(period);
    // Каждый источник отдельно: сбой одного не роняет экран. Цели не загрузились — сохранять
    // нельзя, иначе пустой черновик затрёт заданные цели.
    const [g, ng, n, a, s] = await Promise.allSettled([
      fetchClientGoals(clientId),
      fetchGoals(clientId),
      fetchNutritionByDay(clientId, from, to),
      fetchActivityByDay(clientId, from, to),
      fetchSessionsInPeriod(clientId, from, to),
    ]);
    for (const r of [g, ng, n, a, s]) if (r.status === "rejected") console.error("[GoalsDashboard] loadAll:", r.reason);
    setGoalsFailed(g.status === "rejected");
    if (g.status === "fulfilled") { setGoals(g.value); setDraft(goalsToDraft(g.value)); }
    // Цели питания не загрузились — окно не открываем: пустая форма затёрла бы цель тренера
    setNutGoalsFailed(ng.status === "rejected");
    if (ng.status === "fulfilled") setNutGoals(ng.value);
    setDataFailed(n.status === "rejected" || a.status === "rejected" || s.status === "rejected");
    setNutrition(n.status === "fulfilled" ? n.value : []);
    setActivities(a.status === "fulfilled" ? a.value : []);
    setSessions(s.status === "fulfilled" ? s.value : 0);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [clientId, period]);
  // Вес для калькулятора в «Целях питания»; не загрузился — калькулятор просто без подсказки
  useEffect(() => {
    let alive = true;
    cached(`meas:${clientId}`, () => fetchMeasurements(clientId)).then((m) => { if (alive) setMeasurements(m); }).catch((e) => console.error("[GoalsDashboard] замеры:", e));
    return () => { alive = false; };
  }, [clientId]);

  const handleSave = async () => {
    if (goalsFailed) return;
    setSaving(true);
    try {
      // Пустое поле — цель убрать; остальные ключи clients.goals остаются как были
      const patch: ClientGoals = {};
      for (const field of ACTIVITY_FIELDS) {
        const v = parseFloat(draft[field.key] ?? "");
        patch[field.key] = !isNaN(v) && v > 0 ? v : undefined;
      }
      setGoals(await saveClientGoals(clientId, patch));
    } catch (e) {
      console.error("[GoalsDashboard] сохранение целей:", e);
      notify("Не удалось сохранить цели. Проверь интернет и попробуй ещё раз.");
    } finally { setSaving(false); }
  };

  const { from: rangeFrom, to: rangeTo } = periodRange(period);
  const allDates = dateRange(rangeFrom, rangeTo);
  const totalDays = allDates.length;

  const nutSum = (key: keyof DayNutrition) => nutrition.reduce((s, d) => s + (d[key] as number), 0);
  const actSum = (key: keyof DayActivity) => activities.reduce((s, d) => s + (d[key] as number), 0);
  const nutGoal = activeGoal(nutGoals);

  const weeksInPeriod = Math.max(1, period / 7);
  const expectedSessions = Math.round((goals.sessionsPerWeek ?? 0) * weeksInPeriod);
  const sessionPct = expectedSessions > 0 ? Math.min(100, Math.round((sessions / expectedSessions) * 100)) : 0;
  const sessionColor = sessionPct >= 90 ? "#c6ff3d" : sessionPct >= 65 ? "#fbbf24" : "#f87171";

  const hasNutGoals = !!nutGoal && (nutGoal.kcal > 0 || nutGoal.protein > 0 || nutGoal.carbs > 0 || nutGoal.fat > 0);
  const hasActGoals = goals.steps || goals.activeMinutes;
  const hasSessionGoal = goals.sessionsPerWeek;

  if (loading) return <div className="p-4"><ScreenSkeleton /></div>;

  return (
    <div className="space-y-4">
      {/* Goals editor */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <button onClick={() => setGoalsOpen((v) => !v)} aria-expanded={goalsOpen} className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-800/30 transition">
          <span className="flex items-center gap-2 font-semibold text-sm">
            <Target size={15} className="text-lime-400" /> Цели для клиента
          </span>
          {goalsOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
        </button>
        {goalsOpen && (
          <div className="px-4 pb-4 space-y-4 border-t border-zinc-800">
            <div>
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 mt-3 mb-2"><Apple size={12} /> Питание на день</p>
              <div className="flex items-center gap-3 rounded-xl bg-zinc-800/50 px-3 py-2.5">
                <p className="flex-1 min-w-0 text-sm text-zinc-300">
                  {nutGoalsFailed ? "Не удалось загрузить цели питания — обнови экран"
                    : nutGoal ? `${fmtN(nutGoal.kcal, 0)} ккал · Б ${fmtN(nutGoal.protein, 0)} · Ж ${fmtN(nutGoal.fat, 0)} · У ${fmtN(nutGoal.carbs, 0)}${nutGoal.waterCups ? ` · вода ${nutGoal.waterCups} ст.` : ""}`
                    : "КБЖУ и вода не заданы"}
                  {!nutGoalsFailed && nutGoal && <span className="block text-xs text-zinc-500">{nutGoals.trainer ? "твоя цель" : "цель, которую задал клиент"}</span>}
                </p>
                <button onClick={() => setShowNutGoals(true)} disabled={nutGoalsFailed}
                  className="h-10 px-3.5 shrink-0 rounded-xl bg-zinc-700 text-sm font-semibold hover:bg-zinc-600 transition disabled:opacity-50">Цели питания</button>
              </div>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2"><Footprints size={12} /> Активность</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ACTIVITY_FIELDS.map((f) => (
                  <GoalInput key={f.key} label={f.label} unit={f.unit} placeholder={f.placeholder}
                    value={draft[f.key] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                ))}
              </div>
            </div>
            {goalsFailed && <p role="alert" className="text-xs text-red-400">Не удалось загрузить текущие цели — сохранить нельзя, чтобы не затереть их. Обнови экран.</p>}
            <button onClick={handleSave} disabled={saving || goalsFailed} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-xl px-4 py-2 text-sm hover:bg-lime-300 transition disabled:opacity-50">
              <Save size={14} /> {saving ? "Сохранение…" : "Сохранить активность"}
            </button>
          </div>
        )}
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500 shrink-0">Период:</span>
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5">
          {([7, 14, 30] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1 rounded-lg text-sm font-medium transition ${period === p ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>
              {p} дн.
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-600 hidden sm:inline">{fmtDate(rangeFrom)} — {fmtDate(rangeTo)}</span>
      </div>

      {dataFailed && !(goalsFailed && nutGoalsFailed) && <p role="alert" className="text-xs text-red-400">Часть данных за период не загрузилась — проценты могут быть неполными. Обнови экран.</p>}

      {/* Compliance */}
      {goalsFailed && nutGoalsFailed ? (
        <div role="alert" className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center space-y-3">
          <p className="text-zinc-400 text-sm">Не удалось загрузить цели</p>
          <button onClick={loadAll} className="h-10 px-4 rounded-xl bg-zinc-800 text-sm font-semibold hover:bg-zinc-700 transition">Повторить</button>
        </div>
      ) : !hasNutGoals && !hasActGoals && !hasSessionGoal ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center space-y-2">
          <Target size={28} className="mx-auto text-zinc-700" />
          <p className="text-zinc-400 text-sm">Цели не заданы</p>
          <p className="text-zinc-600 text-xs">Нажми «Цели для клиента» выше. КБЖУ и вода — в «Целях питания», их же видит клиент в дневнике</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hasNutGoals && nutGoal && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-1"><Apple size={14} className="text-lime-400" /> Питание</h3>
              {!nutrition.length && <p className="text-xs text-zinc-600 mb-3">Клиент не вёл дневник питания в этом периоде</p>}
              <p className="text-[11px] text-zinc-600 mb-3">Записи в {nutrition.length} из {totalDays} дней · процент только по этим дням</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 justify-items-center">
                <RingCard label="Калории" unit="ккал" actual={nutSum("calories")} goal={nutGoal.kcal} days={nutrition.length} color="#fb923c" limit />
                <RingCard label="Белок" unit="г" actual={nutSum("protein")} goal={nutGoal.protein} days={nutrition.length} color="#c6ff3d" />
                <RingCard label="Углеводы" unit="г" actual={nutSum("carbs")} goal={nutGoal.carbs} days={nutrition.length} color="#22d3ee" limit />
                <RingCard label="Жиры" unit="г" actual={nutSum("fat")} goal={nutGoal.fat} days={nutrition.length} color="#f472b6" limit />
              </div>
            </div>
          )}

          {hasActGoals && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-1"><Footprints size={14} className="text-lime-400" /> Активность</h3>
              {!activities.length && <p className="text-xs text-zinc-600 mb-3">Клиент не логировал активность в этом периоде</p>}
              <p className="text-[11px] text-zinc-600 mb-3">Записи в {activities.length} из {totalDays} дней · процент только по этим дням</p>
              <div className="grid grid-cols-2 gap-4 justify-items-center">
                <RingCard label="Шаги" unit="шаг" actual={actSum("steps")} goal={goals.steps ?? 0} days={activities.length} color="#c6ff3d" />
                <RingCard label="Акт. минут" unit="мин" actual={actSum("activeMinutes")} goal={goals.activeMinutes ?? 0} days={activities.length} color="#22d3ee" />
              </div>
            </div>
          )}

          {hasSessionGoal && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-3"><Dumbbell size={14} className="text-lime-400" /> Тренировки</h3>
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <DonutRing pct={sessionPct} color={sessionColor} size={80} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-bold" style={{ color: sessionColor }}>{sessionPct}%</span>
                  </div>
                </div>
                <div className="space-y-0.5 text-sm">
                  <p className="text-zinc-200">{sessions} <span className="text-zinc-500">из</span> {expectedSessions} тренировок</p>
                  <p className="text-xs text-zinc-600">Цель: {goals.sessionsPerWeek} тр./нед. × {weeksInPeriod.toFixed(1)} нед.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {showNutGoals && <NutritionGoalsSheet clientId={clientId} goals={nutGoals} asTrainer measurements={measurements} onSaved={setNutGoals} onClose={() => setShowNutGoals(false)} />}
    </div>
  );
}
