import { Apple, ChevronDown, ChevronRight, Dumbbell, Footprints, Save, Target } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type ClientGoals, type DayActivity, type DayNutrition,
  fetchClientGoals, fetchNutritionByDay, fetchActivityByDay, fetchSessionsInPeriod,
  saveClientGoals, dateRange, periodRange,
} from "../lib/goals";
import { fmtDate } from "../lib/format";

type Period = 7 | 14 | 30;

const ACTIVITY_FIELDS: { key: keyof ClientGoals; label: string; unit: string; placeholder: string }[] = [
  { key: "steps", label: "Шаги", unit: "шаг/день", placeholder: "10000" },
  { key: "activeMinutes", label: "Акт. минут", unit: "мин/день", placeholder: "30" },
  { key: "sessionsPerWeek", label: "Тренировок", unit: "в неделю", placeholder: "3" },
];

function calcCals(p: number, c: number, f: number) { return Math.round(p * 4 + c * 4 + f * 9); }

function DonutRing({ pct, color, size = 80 }: { pct: number; color: string; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const fill = Math.min(1, pct / 100) * circ;
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="#27272a" strokeWidth={9} />
      {pct > 0 && (
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={9}
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`} />
      )}
    </svg>
  );
}

function RingCard({ label, unit, actual, goal, periodDays, color }: {
  label: string; unit: string; actual: number; goal: number; periodDays: number; color: string;
}) {
  if (!goal) return null;
  const target = goal * periodDays;
  const pct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  const col = pct >= 90 ? "#a3e635" : pct >= 65 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <DonutRing pct={pct} color={color} size={80} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold" style={{ color: col }}>{Math.round(pct)}%</span>
        </div>
      </div>
      <span className="text-[11px] text-zinc-400 text-center leading-tight">{label}</span>
      <span className="text-[10px] text-zinc-600 text-center">{Math.round(actual)}&nbsp;/&nbsp;{Math.round(target)}&nbsp;{unit}</span>
    </div>
  );
}

function GoalInput({ label, unit, placeholder, value, onChange, readOnly }: {
  label: string; unit: string; placeholder: string; value: string;
  onChange?: (v: string) => void; readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-zinc-500">{label}</label>
      <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 border ${readOnly ? "bg-zinc-800/40 border-zinc-700/40" : "bg-zinc-800 border-zinc-700 focus-within:border-lime-400/40"}`}>
        <input type="number" inputMode="numeric" min="0" value={value} onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder} readOnly={readOnly}
          className={`w-full bg-transparent text-sm outline-none ${readOnly ? "text-zinc-500 cursor-default" : ""}`} />
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

  const goalsToDraft = (g: ClientGoals): Record<string, string> => ({
    protein: g.protein != null ? String(g.protein) : "",
    carbs: g.carbs != null ? String(g.carbs) : "",
    fat: g.fat != null ? String(g.fat) : "",
    water: g.water != null ? String(g.water) : "",
    steps: g.steps != null ? String(g.steps) : "",
    activeMinutes: g.activeMinutes != null ? String(g.activeMinutes) : "",
    sessionsPerWeek: g.sessionsPerWeek != null ? String(g.sessionsPerWeek) : "",
  });

  const autoCals = (): string => {
    const p = parseFloat(draft.protein || "0") || 0;
    const c = parseFloat(draft.carbs || "0") || 0;
    const f = parseFloat(draft.fat || "0") || 0;
    return (p || c || f) ? String(calcCals(p, c, f)) : "";
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const { from, to } = periodRange(period);
      const [g, n, a, s] = await Promise.all([
        fetchClientGoals(clientId),
        fetchNutritionByDay(clientId, from, to),
        fetchActivityByDay(clientId, from, to),
        fetchSessionsInPeriod(clientId, from, to),
      ]);
      setGoals(g); setDraft(goalsToDraft(g));
      setNutrition(n); setActivities(a); setSessions(s);
    } catch (e) { console.error("[GoalsDashboard] loadAll:", e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, [clientId, period]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const p = parseFloat(draft.protein || "0") || 0;
      const c = parseFloat(draft.carbs || "0") || 0;
      const f = parseFloat(draft.fat || "0") || 0;
      const parsed: ClientGoals = {};
      if (p > 0) parsed.protein = p;
      if (c > 0) parsed.carbs = c;
      if (f > 0) parsed.fat = f;
      if (p > 0 || c > 0 || f > 0) parsed.calories = calcCals(p, c, f);
      const water = parseFloat(draft.water || "0") || 0;
      if (water > 0) parsed.water = water;
      for (const field of ACTIVITY_FIELDS) {
        const v = parseFloat(draft[field.key as string] ?? "");
        if (!isNaN(v) && v > 0) (parsed as any)[field.key] = v;
      }
      await saveClientGoals(clientId, parsed);
      setGoals(parsed);
    } finally { setSaving(false); }
  };

  const { from: rangeFrom, to: rangeTo } = periodRange(period);
  const allDates = dateRange(rangeFrom, rangeTo);
  const totalDays = allDates.length;

  const nutSum = (key: keyof DayNutrition) => nutrition.reduce((s, d) => s + (d[key] as number), 0);
  const actSum = (key: keyof DayActivity) => activities.reduce((s, d) => s + (d[key] as number), 0);

  const weeksInPeriod = Math.max(1, period / 7);
  const expectedSessions = Math.round((goals.sessionsPerWeek ?? 0) * weeksInPeriod);
  const sessionPct = expectedSessions > 0 ? Math.min(100, Math.round((sessions / expectedSessions) * 100)) : 0;
  const sessionColor = sessionPct >= 90 ? "#a3e635" : sessionPct >= 65 ? "#fbbf24" : "#f87171";

  const hasNutGoals = goals.calories || goals.protein || goals.carbs || goals.fat;
  const hasActGoals = goals.steps || goals.activeMinutes;
  const hasSessionGoal = goals.sessionsPerWeek;

  if (loading) return <div className="text-zinc-500 text-sm p-4">Загрузка…</div>;

  return (
    <div className="space-y-4">
      {/* Goals editor */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <button onClick={() => setGoalsOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-800/30 transition">
          <span className="flex items-center gap-2 font-semibold text-sm">
            <Target size={15} className="text-lime-400" /> Цели для подопечного
          </span>
          {goalsOpen ? <ChevronDown size={16} className="text-zinc-500" /> : <ChevronRight size={16} className="text-zinc-500" />}
        </button>
        {goalsOpen && (
          <div className="px-4 pb-4 space-y-4 border-t border-zinc-800">
            <div>
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 uppercase tracking-wide mt-3 mb-2"><Apple size={12} /> Питание на день</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <GoalInput label="Белок" unit="г" placeholder="150" value={draft.protein ?? ""} onChange={(v) => setDraft((d) => ({ ...d, protein: v }))} />
                <GoalInput label="Углеводы" unit="г" placeholder="200" value={draft.carbs ?? ""} onChange={(v) => setDraft((d) => ({ ...d, carbs: v }))} />
                <GoalInput label="Жиры" unit="г" placeholder="70" value={draft.fat ?? ""} onChange={(v) => setDraft((d) => ({ ...d, fat: v }))} />
                <GoalInput label="Калории (авто)" unit="ккал" placeholder="—" value={autoCals()} readOnly />
                <GoalInput label="Вода" unit="мл" placeholder="2000" value={draft.water ?? ""} onChange={(v) => setDraft((d) => ({ ...d, water: v }))} />
              </div>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 uppercase tracking-wide mb-2"><Footprints size={12} /> Активность</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ACTIVITY_FIELDS.map((f) => (
                  <GoalInput key={String(f.key)} label={f.label} unit={f.unit} placeholder={f.placeholder}
                    value={draft[String(f.key)] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [String(f.key)]: v }))} />
                ))}
              </div>
            </div>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-4 py-2 text-sm hover:bg-lime-300 transition disabled:opacity-50">
              <Save size={14} /> {saving ? "Сохранение…" : "Сохранить цели"}
            </button>
          </div>
        )}
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500 shrink-0">Период:</span>
        <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5">
          {([7, 14, 30] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1 rounded-md text-sm font-medium transition ${period === p ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>
              {p} дн.
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-600 hidden sm:inline">{fmtDate(rangeFrom)} — {fmtDate(rangeTo)}</span>
      </div>

      {/* Compliance */}
      {!hasNutGoals && !hasActGoals && !hasSessionGoal ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center space-y-2">
          <Target size={28} className="mx-auto text-zinc-700" />
          <p className="text-zinc-400 text-sm">Цели не заданы</p>
          <p className="text-zinc-600 text-xs">Нажми «Цели для подопечного» выше, чтобы задать нормы</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hasNutGoals && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-1"><Apple size={14} className="text-lime-400" /> Питание</h3>
              {!nutrition.length && <p className="text-xs text-zinc-600 mb-3">Клиент не вёл дневник питания в этом периоде</p>}
              <p className="text-[10px] text-zinc-600 mb-3">Суммарно за {totalDays} дн. / цель × {totalDays}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 justify-items-center">
                <RingCard label="Калории" unit="ккал" actual={nutSum("calories")} goal={goals.calories ?? 0} periodDays={totalDays} color="#fb923c" />
                <RingCard label="Белок" unit="г" actual={nutSum("protein")} goal={goals.protein ?? 0} periodDays={totalDays} color="#a3e635" />
                <RingCard label="Углеводы" unit="г" actual={nutSum("carbs")} goal={goals.carbs ?? 0} periodDays={totalDays} color="#22d3ee" />
                <RingCard label="Жиры" unit="г" actual={nutSum("fat")} goal={goals.fat ?? 0} periodDays={totalDays} color="#f472b6" />
              </div>
            </div>
          )}

          {hasActGoals && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-1"><Footprints size={14} className="text-lime-400" /> Активность</h3>
              {!activities.length && <p className="text-xs text-zinc-600 mb-3">Клиент не логировал активность в этом периоде</p>}
              <p className="text-[10px] text-zinc-600 mb-3">Суммарно за {totalDays} дн. / цель × {totalDays}</p>
              <div className="grid grid-cols-2 gap-4 justify-items-center">
                <RingCard label="Шаги" unit="шаг" actual={actSum("steps")} goal={goals.steps ?? 0} periodDays={totalDays} color="#a3e635" />
                <RingCard label="Акт. минут" unit="мин" actual={actSum("activeMinutes")} goal={goals.activeMinutes ?? 0} periodDays={totalDays} color="#22d3ee" />
              </div>
            </div>
          )}

          {hasSessionGoal && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
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
    </div>
  );
}
