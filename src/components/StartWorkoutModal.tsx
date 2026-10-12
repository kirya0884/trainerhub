import { ChevronRight, Play, Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import ModalShell from "./ModalShell";
import { SkeletonRows } from "./Skeleton";
import { fetchPlan } from "../lib/plans";
import { fetchClients, type ClientListItem, type PlanListItem } from "../lib/clients";
import type { Plan } from "../types";
import { useActiveWorkout, type GroupClient } from "../hooks/useActiveWorkout";

// Запуск тренировки прямо из карточки подопечного: выбор плана (если их несколько) и дня.
// Дальше всё как с кнопкой ▶ в редакторе плана — тренировка живёт в ActiveWorkoutHost.
// «Тренировать вместе с…» открывает совместную тренировку на двоих (сплит): у каждого
// свой план и день, выбираются уже на экране тренировки.
export default function StartWorkoutModal({ trainerId, self, partner, plans, onClose }: {
  trainerId: string; self: GroupClient; partner?: { id: string; name: string } | null; plans: PlanListItem[]; onClose: () => void;
}) {
  const clientId = self.id, clientName = self.name;
  const workout = useActiveWorkout();
  const [others, setOthers] = useState<ClientListItem[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    let alive = true;
    fetchClients(trainerId).then((list) => { if (alive) setOthers(list.filter((c) => c.id !== self.id)); })
      .catch((e) => { console.error("[StartWorkoutModal] подопечные:", e); if (alive) setOthers([]); });
    return () => { alive = false; };
  }, [trainerId, self.id]);
  const startWith = (id: string, name: string) => {
    const c = others?.find((x) => x.id === id);
    const other: GroupClient = { id, name: c?.name ?? name, color: c?.color || "#22d3ee", remaining: c?.remaining ?? null };
    if (!workout.start({ kind: "group", id: String(Date.now()), clients: [self, other] })) { alert("Одна тренировка уже идёт — заверши или сверни её."); return; }
    onClose();
  };
  const term = q.trim().toLowerCase();
  const options = (others ?? []).filter((c) => c.id !== partner?.id && (!term || c.name.toLowerCase().includes(term)));
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");

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

  // Все дни, кроме дней из блоков в архиве (проведённые дни остаются в плане)
  const archivedMesos = new Set((plan?.mesocycles ?? []).filter((m) => m.archivedAt).map((m) => m.id));
  const mesoName = (id?: string | null) => plan?.mesocycles?.find((m) => m.id === id)?.name;
  const days = (plan?.days ?? []).filter((d) => !(d.mesocycleId && archivedMesos.has(d.mesocycleId)));

  const start = (dayId: string) => {
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    if (!workout.start({ day, planId, clientId, clientName })) { alert("Одна тренировка уже идёт — заверши или сверни её."); return; }
    onClose();
  };

  return (
    <ModalShell title="Начать тренировку" icon={<Play size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3">
        {/* Вместе с кем-то — совместная тренировка; партнёр по сплиту предлагается первым */}
        <div className="bg-zinc-800/50 rounded-2xl p-3 space-y-2">
          <p className="text-sm font-semibold flex items-center gap-1.5"><Users size={16} className="text-lime-400" /> Тренировать вместе с…</p>
          {partner && (
            <button onClick={() => startWith(partner.id, partner.name)}
              className="w-full h-11 rounded-xl bg-lime-400 text-zinc-950 font-bold text-sm flex items-center justify-center gap-2 hover:bg-lime-300 transition active:scale-[0.98]">
              <Users size={16} /> Сплит · {partner.name}
            </button>
          )}
          {!picking ? (
            <button onClick={() => setPicking(true)} className="w-full h-11 rounded-xl bg-zinc-800 text-zinc-100 font-semibold text-sm hover:bg-zinc-700 transition">
              {partner ? "С другим подопечным" : "Выбрать подопечного"}
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-zinc-900 rounded-xl px-3 h-11">
                <Search size={16} className="text-zinc-500 shrink-0" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Подопечный..." className="flex-1 min-w-0 bg-transparent outline-none" />
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {!others && <SkeletonRows rows={2} />}
                {others && options.length === 0 && <p className="text-sm text-zinc-500 text-center py-3">Никого не найдено</p>}
                {options.map((c) => (
                  <button key={c.id} onClick={() => startWith(c.id, c.name)} className="w-full flex items-center gap-3 px-2 h-12 rounded-xl hover:bg-zinc-800 transition text-left">
                    <span className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-zinc-950" style={{ background: c.color }}>{c.name[0]}</span>
                    <span className="flex-1 min-w-0 font-semibold truncate">{c.name}</span>
                    <ChevronRight size={18} className="text-zinc-500 shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="text-xs text-zinc-500">План и день для каждого — на экране тренировки.</p>
        </div>

        <p className="text-sm text-zinc-400 pt-1">Или одна тренировка — выберите день:</p>
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
