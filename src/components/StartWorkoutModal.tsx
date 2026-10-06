import { ChevronRight, Play } from "lucide-react";
import { useEffect, useState } from "react";
import ModalShell from "./ModalShell";
import { SkeletonRows } from "./Skeleton";
import { fetchPlan } from "../lib/plans";
import type { PlanListItem } from "../lib/clients";
import type { Plan } from "../types";
import { useActiveWorkout } from "../hooks/useActiveWorkout";

// Запуск тренировки прямо из карточки подопечного: выбор плана (если их несколько) и дня.
// Дальше всё как с кнопкой ▶ в редакторе плана — тренировка живёт в ActiveWorkoutHost.
export default function StartWorkoutModal({ clientId, clientName, plans, onClose }: {
  clientId: string; clientName: string; plans: PlanListItem[]; onClose: () => void;
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const workout = useActiveWorkout();

  useEffect(() => {
    if (!planId) return;
    let alive = true;
    setPlan(null); setError("");
    fetchPlan(planId).then((p) => { if (alive) setPlan(p); }).catch((e) => {
      console.error("[StartWorkoutModal] план:", e);
      if (alive) setError("Не удалось загрузить план");
    });
    return () => { alive = false; };
  }, [planId]);

  // Только рабочие дни: без проведённых и без дней из блоков в архиве
  const archivedMesos = new Set((plan?.mesocycles ?? []).filter((m) => m.archivedAt).map((m) => m.id));
  const mesoName = (id?: string | null) => plan?.mesocycles?.find((m) => m.id === id)?.name;
  const days = (plan?.days ?? []).filter((d) => !d.archivedAt && !(d.mesocycleId && archivedMesos.has(d.mesocycleId)));

  const start = (dayId: string) => {
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    if (!workout.start({ day, planId, clientId, clientName })) { alert("Одна тренировка уже идёт — заверши или сверни её."); return; }
    onClose();
  };

  return (
    <ModalShell title="Начать тренировку" icon={<Play size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3">
        {plans.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1">
            {plans.map((p) => (
              <button key={p.id} onClick={() => setPlanId(p.id)}
                className={`shrink-0 px-3.5 h-9 rounded-lg text-sm font-semibold transition ${p.id === planId ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"}`}>
                {p.name}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-400 text-center py-6">{error}</p>}
        {!error && !plan && <SkeletonRows rows={4} />}
        {plan && days.length === 0 && <p className="text-sm text-zinc-500 text-center py-6">В плане нет тренировочных дней</p>}
        {plan && days.length > 0 && (
          <div className="space-y-2">
            {days.map((d) => (
              <button key={d.id} onClick={() => start(d.id)}
                className="w-full flex items-center gap-3 text-left bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 hover:border-zinc-700 transition active:scale-[0.99]">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{d.name || "Без названия"}</p>
                  <p className="text-xs text-zinc-500 truncate">
                    {[mesoName(d.mesocycleId), `${d.exercises.length} упр.`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <ChevronRight size={18} className="shrink-0 text-zinc-500" />
              </button>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
