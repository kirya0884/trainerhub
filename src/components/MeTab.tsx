import { useEffect, useState } from "react";
import { ChevronRight, ClipboardList, Dumbbell, Play, Plus } from "lucide-react";
import { SkeletonRows } from "./Skeleton";
import NutritionDiary from "./NutritionDiary";
import BodyTab from "./BodyTab";
import { ensureSelfClient } from "../lib/me";
import { addPlan, fetchClientPlans, fetchMeasurements, type Measurement, type PlanListItem } from "../lib/clients";
import { fetchPlan } from "../lib/plans";
import { useActiveWorkout } from "../hooks/useActiveWorkout";
import type { Plan } from "../types";
import { notify } from "../lib/dialog";

type Sub = "workouts" | "nutrition" | "progress";
const SUBS: [Sub, string][] = [["workouts", "Тренировки"], ["nutrition", "Питание"], ["progress", "Прогресс"]];
const card = "bg-zinc-900 border border-zinc-800 rounded-2xl";

// «Я» — свои тренировки, питание и замеры тренера. Под капотом это обычная карточка
// подопечного (is_self), поэтому план, проведение, дневник питания и замеры — те же экраны.
export default function MeTab({ trainerId, trainerName, action, onOpenPlan }: {
  trainerId: string; trainerName: string; onOpenPlan: (planId: string, clientId: string) => void;
  /** Команда из «+»: открыть добавление еды, тренировки или форму замера */
  action?: "food" | "workout" | "measure";
}) {
  const [sub, setSub] = useState<Sub>("workouts");
  // Счётчики — каждое нажатие «+» срабатывает, даже если команда та же, что в прошлый раз
  const [addFood, setAddFood] = useState(0);
  const [measureTick, setMeasureTick] = useState(0);
  useEffect(() => {
    if (action === "food") { setSub("nutrition"); setAddFood((n) => n + 1); }
    if (action === "workout") setSub("workouts");
    if (action === "measure") { setSub("progress"); setMeasureTick((n) => n + 1); }
  }, [action]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  useEffect(() => {
    let alive = true;
    ensureSelfClient(trainerId, trainerName)
      .then((id) => { if (!alive) return; setSelfId(id); fetchMeasurements(id).then((m) => alive && setMeasurements(m)).catch((e) => console.error("[MeTab] замеры:", e)); })
      .catch((e) => { console.error("[MeTab]", e); if (alive) setError("Не удалось открыть раздел. Проверьте интернет и попробуйте ещё раз."); });
    return () => { alive = false; };
  }, [trainerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3 max-w-2xl">
      <h1 className="text-[26px] font-extrabold tracking-tight">Я</h1>
      <div className="flex p-1 rounded-xl bg-zinc-900 border border-zinc-800">
        {SUBS.map(([k, l]) => (
          <button key={k} onClick={() => { setSub(k); setAddFood(0); setMeasureTick(0); }} aria-pressed={sub === k}
            className={`flex-1 h-9 rounded-lg text-sm font-semibold transition ${sub === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{l}</button>
        ))}
      </div>
      {error ? <p className="text-sm text-red-400 px-1">{error}</p> : !selfId ? <SkeletonRows rows={3} /> : (
        <>
          {sub === "workouts" && <Workouts trainerId={trainerId} selfId={selfId} name={trainerName} onOpenPlan={(id) => onOpenPlan(id, selfId)} />}
          {sub === "nutrition" && <NutritionDiary clientId={selfId} measurements={measurements} embedded addRequest={addFood} />}
          {sub === "progress" && <BodyTab key={measureTick} clientId={selfId} measurements={measurements} setMeasurements={setMeasurements} openForm={measureTick > 0} />}
        </>
      )}
    </div>
  );
}

// Свои планы; у текущего — дни с кнопкой ▶, как в редакторе плана
function Workouts({ trainerId, selfId, name, onOpenPlan }: { trainerId: string; selfId: string; name: string; onOpenPlan: (id: string) => void }) {
  const workout = useActiveWorkout();
  const [plans, setPlans] = useState<PlanListItem[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchClientPlans(selfId).then((l) => {
      if (!alive) return;
      setPlans(l);
      const cur = l.find((p) => !p.archived);
      if (cur) fetchPlan(cur.id).then((p) => alive && setPlan(p)).catch((e) => console.error("[MeTab] план:", e));
    }).catch((e) => { console.error("[MeTab] планы:", e); if (alive) setPlans([]); });
    return () => { alive = false; };
  }, [selfId]);

  const create = async () => {
    if (busy || !newName?.trim()) return;
    setBusy(true);
    try { const p = await addPlan(trainerId, selfId, newName.trim()); onOpenPlan(p.id); }
    catch (e) { console.error("[MeTab] новый план:", e); notify("Не удалось создать план."); setBusy(false); }
  };

  if (plans === null) return <SkeletonRows rows={3} />;
  const archivedMesos = new Set((plan?.mesocycles ?? []).filter((m) => m.archivedAt).map((m) => m.id));
  const days = (plan?.days ?? []).filter((d) => !(d.mesocycleId && archivedMesos.has(d.mesocycleId)));
  const others = plans.filter((p) => p.id !== plan?.id);

  return (
    <div className="space-y-3">
      {plan && (
        <>
          <button onClick={() => onOpenPlan(plan.id)} className={`${card} w-full flex items-center gap-3 p-4 text-left hover:border-zinc-700 transition`}>
            <span className="w-11 h-11 rounded-xl bg-lime-400/15 text-lime-400 flex items-center justify-center shrink-0"><ClipboardList size={20} /></span>
            <span className="flex-1 min-w-0"><span className="block font-bold truncate">{plan.name}</span><span className="block text-[13px] text-zinc-400">{days.length} дн. · открыть и редактировать</span></span>
            <ChevronRight size={18} className="text-zinc-500" />
          </button>
          {days.length > 0 ? (
            <div className={`${card} divide-y divide-zinc-800 overflow-hidden`}>
              {days.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <Dumbbell size={18} className="text-zinc-500 shrink-0" />
                  <span className="flex-1 min-w-0"><span className="block font-semibold truncate">{d.name || "Без названия"}</span><span className="block text-[13px] text-zinc-500">{d.exercises.length} упр.</span></span>
                  <button onClick={() => { if (!workout.start({ day: d, planId: plan.id, clientId: selfId, clientName: name || "Я" })) notify("Одна тренировка уже идёт — заверши или сверни её."); }}
                    aria-label={`Начать «${d.name}»`} className="w-10 h-10 shrink-0 rounded-xl bg-lime-400/15 text-lime-400 flex items-center justify-center hover:bg-lime-400/25 transition"><Play size={18} /></button>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-zinc-500 px-1">В плане пока нет дней — откройте его и добавьте тренировки.</p>}
        </>
      )}

      {!plan && plans.length === 0 && (
        <div className={`${card} p-4`}>
          <p className="font-bold">Свой план тренировок</p>
          <p className="text-sm text-zinc-400 mt-1">Соберите его так же, как для подопечного: дни, упражнения, подходы. Проводите тренировки здесь же — с «Как в прошлый раз» и таймером отдыха.</p>
        </div>
      )}

      {newName === null ? (
        <button onClick={() => setNewName("")} className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-semibold text-lime-400 hover:border-zinc-700 transition"><Plus size={17} /> Новый план</button>
      ) : (
        <div className={`${card} p-3 flex gap-2`}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Название, например «Мой сплит»"
            className="flex-1 min-w-0 h-11 px-3 rounded-xl bg-zinc-800 outline-none focus:ring-2 focus:ring-lime-400/50" />
          <button onClick={create} disabled={busy || !newName.trim()} className="h-11 px-4 rounded-xl bg-lime-400 text-zinc-950 font-bold text-sm disabled:opacity-40">Создать</button>
        </div>
      )}

      {others.length > 0 && (
        <>
          <p className="text-[17px] font-bold px-0.5 pt-1">Другие планы</p>
          <div className={`${card} divide-y divide-zinc-800 overflow-hidden`}>
            {others.map((p) => (
              <button key={p.id} onClick={() => onOpenPlan(p.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 transition">
                <span className="flex-1 min-w-0 truncate font-semibold">{p.name}</span>
                {p.archived && <span className="text-[13px] text-zinc-500">в архиве</span>}
                <ChevronRight size={17} className="text-zinc-500" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
