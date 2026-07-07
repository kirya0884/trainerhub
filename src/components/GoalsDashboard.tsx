import { Apple, ChevronDown, ChevronRight, Dumbbell, Footprints, Save, Target, Timer, Droplets } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type ClientGoals, type DayActivity, type DayNutrition,
  fetchClientGoals, fetchNutritionByDay, fetchActivityByDay, fetchSessionsInPeriod,
  saveClientGoals, dateRange, periodRange,
} from "../lib/goals";
import { fmtDate } from "../lib/format";

type Period = 7 | 14 | 30;

interface GoalField {
  key: keyof ClientGoals;
  label: string;
  unit: string;
  placeholder: string;
}

const NUTRITION_FIELDS: GoalField[] = [
  { key: "calories", label: "Калории", unit: "ккал", placeholder: "2000" },
  { key: "protein", label: "Белок", unit: "г", placeholder: "150" },
  { key: "carbs", label: "Углеводы", unit: "г", placeholder: "200" },
  { key: "fat", label: "Жиры", unit: "г", placeholder: "70" },
  { key: "water", label: "Вода", unit: "мл", placeholder: "2000" },
];

const ACTIVITY_FIELDS: GoalField[] = [
  { key: "steps", label: "Шаги", unit: "шаг/день", placeholder: "10000" },
  { key: "activeMinutes", label: "Акт. минут", unit: "мин/день", placeholder: "30" },
  { key: "sessionsPerWeek", label: "Тренировок", unit: "в неделю", placeholder: "3" },
];

function ComplianceRow({ label, unit, avg, target, daysMet, totalDays, daysWithData }: {
  label: string; unit: string; avg: number; target: number; daysMet: number; totalDays: number; daysWithData: number;
}) {
  if (!target) return null;
  const pct = Math.min(100, Math.round((avg / target) * 100));
  const barColor = pct >= 90 ? "bg-lime-400" : pct >= 65 ? "bg-amber-400" : "bg-red-400";
  const metPct = totalDays > 0 ? Math.round((daysMet / totalDays) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-300">{label}</span>
        <span className="text-zinc-400">
          <span className={pct >= 90 ? "text-lime-400 font-semibold" : pct >= 65 ? "text-amber-400 font-semibold" : "text-red-400 font-semibold"}>{Math.round(avg)}</span>
          <span className="text-zinc-600"> / {target} {unit}</span>
        </span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-zinc-600">
        <span>{daysWithData} дн. с данными</span>
        <span>{daysMet} из {totalDays} дн. ≥ цели ({metPct}%)</span>
      </div>
    </div>
  );
}

function GoalInput({ field, value, onChange }: { field: GoalField; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-zinc-500">{field.label}</label>
      <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-2 focus-within:border-lime-400/40">
        <input
          type="number" inputMode="numeric" min="0" value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="w-full bg-transparent text-sm outline-none"
        />
        <span className="text-xs text-zinc-500 whitespace-nowrap shrink-0">{field.unit}</span>
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

  const goalsToDraft = (g: ClientGoals) =>
    Object.fromEntries(([...NUTRITION_FIELDS, ...ACTIVITY_FIELDS] as GoalField[]).map((f) => [f.key, g[f.key] != null ? String(g[f.key]) : ""]));

  const loadAll = async () => {
    setLoading(true);
    const { from, to } = periodRange(period);
    const [g, n, a, s] = await Promise.all([
      fetchClientGoals(clientId),
      fetchNutritionByDay(clientId, from, to),
      fetchActivityByDay(clientId, from, to),
      fetchSessionsInPeriod(clientId, from, to),
    ]);
    setGoals(g);
    setDraft(goalsToDraft(g));
    setNutrition(n);
    setActivities(a);
    setSessions(s);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [clientId, period]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed: ClientGoals = {};
      for (const f of [...NUTRITION_FIELDS, ...ACTIVITY_FIELDS] as GoalField[]) {
        const v = parseFloat(draft[f.key] ?? "");
        if (!isNaN(v) && v > 0) parsed[f.key] = v;
      }
      await saveClientGoals(clientId, parsed);
      setGoals(parsed);
    } finally {
      setSaving(false);
    }
  };

  // --- Compliance calculations ---
  const { from: rangeFrom, to: rangeTo } = periodRange(period);
  const allDates = dateRange(rangeFrom, rangeTo);
  const totalDays = allDates.length;

  const nutMap = Object.fromEntries(nutrition.map((d) => [d.date, d]));
  const actMap = Object.fromEntries(activities.map((d) => [d.date, d]));

  const avg = (key: keyof DayNutrition) =>
    nutrition.length ? nutrition.reduce((s, d) => s + (d[key] as number), 0) / nutrition.length : 0;

  const metNutrition = (key: keyof DayNutrition, target?: number) =>
    !target ? 0 : allDates.filter((d) => nutMap[d] && (nutMap[d][key] as number) >= target * 0.8).length;

  const avgAct = (key: keyof DayActivity) =>
    activities.length ? activities.reduce((s, d) => s + (d[key] as number), 0) / activities.length : 0;

  const metActivity = (key: keyof DayActivity, target?: number) =>
    !target ? 0 : allDates.filter((d) => actMap[d] && (actMap[d][key] as number) >= target).length;

  const weeksInPeriod = Math.max(1, period / 7);
  const expectedSessions = Math.round((goals.sessionsPerWeek ?? 0) * weeksInPeriod);
  const sessionPct = expectedSessions > 0 ? Math.min(100, Math.round((sessions / expectedSessions) * 100)) : 0;

  const hasNutritionGoals = goals.calories || goals.protein || goals.carbs || goals.fat;
  const hasActivityGoals = goals.steps || goals.activeMinutes;
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
                {NUTRITION_FIELDS.map((f) => (
                  <GoalInput key={f.key} field={f} value={draft[f.key] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                ))}
              </div>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 uppercase tracking-wide mb-2"><Footprints size={12} /> Активность</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ACTIVITY_FIELDS.map((f) => (
                  <GoalInput key={f.key} field={f} value={draft[f.key] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
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

      {/* Compliance dashboard */}
      {!hasNutritionGoals && !hasActivityGoals && !hasSessionGoal ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center space-y-2">
          <Target size={28} className="mx-auto text-zinc-700" />
          <p className="text-zinc-400 text-sm">Цели не заданы</p>
          <p className="text-zinc-600 text-xs">Нажми «Цели для подопечного» выше, чтобы задать нормы</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Nutrition */}
          {hasNutritionGoals && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Apple size={14} className="text-lime-400" /> Питание</h3>
              {!nutrition.length && <p className="text-xs text-zinc-600">Клиент не вёл дневник питания в этом периоде</p>}
              <ComplianceRow label="Калории" unit="ккал" avg={avg("calories")} target={goals.calories ?? 0} daysMet={metNutrition("calories", goals.calories)} totalDays={totalDays} daysWithData={nutrition.length} />
              <ComplianceRow label="Белок" unit="г" avg={avg("protein")} target={goals.protein ?? 0} daysMet={metNutrition("protein", goals.protein)} totalDays={totalDays} daysWithData={nutrition.length} />
              <ComplianceRow label="Углеводы" unit="г" avg={avg("carbs")} target={goals.carbs ?? 0} daysMet={metNutrition("carbs", goals.carbs)} totalDays={totalDays} daysWithData={nutrition.length} />
              <ComplianceRow label="Жиры" unit="г" avg={avg("fat")} target={goals.fat ?? 0} daysMet={metNutrition("fat", goals.fat)} totalDays={totalDays} daysWithData={nutrition.length} />
            </div>
          )}

          {/* Activity */}
          {hasActivityGoals && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Footprints size={14} className="text-lime-400" /> Активность</h3>
              {!activities.length && <p className="text-xs text-zinc-600">Клиент не логировал активность в этом периоде</p>}
              <ComplianceRow label="Шаги" unit="шаг" avg={avgAct("steps")} target={goals.steps ?? 0} daysMet={metActivity("steps", goals.steps)} totalDays={totalDays} daysWithData={activities.length} />
              <ComplianceRow label="Активных минут" unit="мин" avg={avgAct("activeMinutes")} target={goals.activeMinutes ?? 0} daysMet={metActivity("activeMinutes", goals.activeMinutes)} totalDays={totalDays} daysWithData={activities.length} />
            </div>
          )}

          {/* Sessions */}
          {hasSessionGoal && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Dumbbell size={14} className="text-lime-400" /> Тренировки</h3>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-300">Проведено за период</span>
                <span>
                  <span className={`font-semibold ${sessionPct >= 90 ? "text-lime-400" : sessionPct >= 65 ? "text-amber-400" : "text-red-400"}`}>{sessions}</span>
                  <span className="text-zinc-600"> / {expectedSessions} ({sessionPct}%)</span>
                </span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${sessionPct >= 90 ? "bg-lime-400" : sessionPct >= 65 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${sessionPct}%` }} />
              </div>
              <p className="text-[11px] text-zinc-600">Цель: {goals.sessionsPerWeek} тр./нед. × {weeksInPeriod.toFixed(1)} нед. = {expectedSessions} ожидаемых</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
