import { ChevronRight, Play, Users } from "lucide-react";
import ClientPickModal, { type PickClient } from "./ClientPickModal";
import { useEffect, useState } from "react";
import ModalShell from "./ModalShell";
import { SkeletonRows } from "./Skeleton";
import { fetchPlanCached } from "../lib/plans";
import { cached, releaseStale } from "../lib/offlineCache";
import { confirmEmptyMembership, fetchClients, type ClientListItem, type PlanListItem } from "../lib/clients";
import type { Plan } from "../types";
import { supabase } from "../lib/supabase";
import { nextDayOf } from "../lib/sessionUtils";
import { useActiveWorkout, type GroupClient } from "../hooks/useActiveWorkout";
import { notify } from "../lib/dialog";

// Запуск тренировки прямо из карточки подопечного: выбор плана (если их несколько) и дня.
// Дальше всё как с кнопкой ▶ в редакторе плана — тренировка живёт в ActiveWorkoutHost.
// «Тренировать вместе с…» открывает совместную тренировку на 2–4 человек (не только сплит):
// у каждого свой план и день, выбираются уже на экране тренировки.
export default function StartWorkoutModal({ trainerId, self, partner, plans, onClose }: {
  trainerId: string; self: GroupClient; partner?: { id: string; name: string } | null; plans: PlanListItem[]; onClose: () => void;
}) {
  const clientId = self.id, clientName = self.name;
  const workout = useActiveWorkout();
  const [others, setOthers] = useState<ClientListItem[] | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    let alive = true;
    cached("clients", () => fetchClients(trainerId)).then((list) => { if (alive) setOthers(list.filter((c) => c.id !== self.id)); })
      .catch((e) => { console.error("[StartWorkoutModal] подопечные:", e); if (alive) setOthers([]); });
    return () => { alive = false; };
  }, [trainerId, self.id]);
  // Совместная на 2–4 человек: этот подопечный + выбранные
  const startWith = async (picked: { id: string; name: string }[]) => {
    const list: GroupClient[] = picked.map(({ id, name }) => {
      const c = others?.find((x) => x.id === id);
      return { id, name: c?.name ?? name, color: c?.color || "#22d3ee", remaining: c?.remaining ?? null };
    });
    if (!(await confirmEmptyMembership([self, ...list]))) return;
    if (!workout.start({ kind: "group", id: String(Date.now()), clients: [self, ...list] })) { notify("Одна тренировка уже идёт — заверши или сверни её."); return; }
    onClose();
  };
  const candidates: PickClient[] | null = others && others.map((c) => ({ id: c.id, name: c.name, color: c.color, avatarUrl: c.avatarUrl, remaining: c.remaining }));
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  // Проведённые тренировки плана — только чтобы подсветить следующий день. Лёгкий запрос
  // (без упражнений); пока грузятся или не загрузились — без подсветки.
  const [done, setDone] = useState<{ date: string; dayId: string | null; dayName: string }[] | null>(null);

  useEffect(() => {
    if (!planId) return;
    let alive = true;
    setPlan(null); setError("");
    fetchPlanCached(planId).then((p) => { if (alive) setPlan(p); }).catch((e) => {
      console.error("[StartWorkoutModal] план:", e);
      if (alive) setError("Не удалось загрузить план");
    });
    return () => { alive = false; releaseStale(`plan:${planId}`); };
  }, [planId]);
  useEffect(() => {
    if (!planId) return;
    let alive = true;
    setDone(null);
    (async () => {
      try {
        const { data, error } = await supabase.from("plan_sessions").select("date,day_id,day_name").eq("plan_id", planId).is("deleted_at", null).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(50);
        if (error) throw error;
        if (alive) setDone((data ?? []).map((r) => ({ date: r.date, dayId: r.day_id ?? null, dayName: r.day_name ?? "" })));
      } catch (e) { console.error("[StartWorkoutModal] тренировки плана:", e); }
    })();
    return () => { alive = false; };
  }, [planId]);

  // Все дни, кроме дней из блоков в архиве (проведённые дни остаются в плане)
  const archivedMesos = new Set((plan?.mesocycles ?? []).filter((m) => m.archivedAt).map((m) => m.id));
  const mesoName = (id?: string | null) => plan?.mesocycles?.find((m) => m.id === id)?.name;
  const days = (plan?.days ?? []).filter((d) => !(d.mesocycleId && archivedMesos.has(d.mesocycleId)));
  const nextId = done ? nextDayOf(days, done)?.id : undefined;

  const start = async (dayId: string) => {
    const day = days.find((d) => d.id === dayId);
    if (!day || !(await confirmEmptyMembership([self]))) return;
    if (!workout.start({ day, planId, clientId, clientName })) { notify("Одна тренировка уже идёт — заверши или сверни её."); return; }
    onClose();
  };

  return (
    <ModalShell title="Начать тренировку" icon={<Play size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3">
        <p className="text-sm text-zinc-400">Выбери день тренировки:</p>
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
                className={`w-full flex items-center gap-3 text-left bg-zinc-900 border rounded-2xl px-4 py-3 transition active:scale-[0.99] ${d.id === nextId ? "border-lime-400/70 ring-1 ring-lime-400/40" : "border-zinc-800 hover:border-zinc-700"}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold flex items-center gap-2 min-w-0">
                    <span className="truncate">{d.name || "Без названия"}</span>
                    {d.id === nextId && <span className="shrink-0 text-[11px] font-semibold bg-lime-400/15 text-lime-400 rounded-full px-1.5 py-0.5 leading-none">Следующий</span>}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">
                    {[mesoName(d.mesocycleId), `${d.exercises.length} упр.`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <ChevronRight size={18} className="shrink-0 text-zinc-500" />
              </button>
            ))}
          </div>
        )}

        {/* Вместе с кем-то — совместная тренировка; партнёр по сплиту предлагается первым */}
        <div className="bg-zinc-800/50 rounded-2xl p-3 space-y-2">
          <p className="text-sm font-semibold flex items-center gap-1.5"><Users size={16} className="text-lime-400" /> Тренировать вместе с…</p>
          {partner && (
            <button onClick={() => startWith([partner])}
              className="w-full h-11 rounded-xl bg-lime-400 text-zinc-950 font-bold text-sm flex items-center justify-center gap-2 hover:bg-lime-300 transition active:scale-[0.98]">
              <Users size={16} /> Сплит · {partner.name}
            </button>
          )}
          <button onClick={() => setPicking(true)} className="w-full h-11 rounded-xl bg-zinc-800 text-zinc-100 font-semibold text-sm hover:bg-zinc-700 transition">
            {partner ? "С другими клиентами" : "Выбрать клиентов"}
          </button>
          {picking && <ClientPickModal title="Тренировать вместе" multi max={3} candidates={candidates} onPick={startWith} onClose={() => setPicking(false)} />}
          <p className="text-xs text-zinc-500">План и день для каждого — на экране тренировки.</p>
        </div>
      </div>
    </ModalShell>
  );
}
