import { useRef, useState } from "react";
import StartWorkoutModal from "../components/StartWorkoutModal";
import { cached } from "../lib/offlineCache";
import { confirmEmptyMembership, fetchClientPlans, fetchClients, type PlanListItem } from "../lib/clients";
import { fetchPlanCached } from "../lib/plans";
import type { Occurrence } from "../lib/bookings";
import { notify } from "../lib/dialog";
import { useActiveWorkout, type GroupClient } from "./useActiveWorkout";

/**
 * «Начать тренировку» у записи календаря — с главной и из календаря (разбор путей 2.1, 4.7).
 * Один клиент: день из записи — сразу тренировка; дня нет, он не нашёлся или план в архиве —
 * выбор дня с отметкой «Следующий». Несколько клиентов — совместная, у слотов день из записи.
 * Запись передаётся дальше и при завершении отмечается «проведена» именно она.
 */
export function useStartFromBooking(trainerId: string) {
  const workout = useActiveWorkout();
  const [pick, setPick] = useState<{ self: GroupClient; plans: PlanListItem[]; booking: { id: string; occDate: string } } | null>(null);
  // Замок — ref, а не состояние: второй быстрый тап приходит раньше перерисовки
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);

  const start = async (o: Occurrence) => {
    if (lock.current) return;
    if (workout.active) { notify("Одна тренировка уже идёт — заверши или сверни её."); return; }
    lock.current = true; setBusy(true);
    try {
      const all = await cached("clients", () => fetchClients(trainerId)).catch(() => []);
      const list: GroupClient[] = o.clientIds.map((id) => {
        const c = all.find((x) => x.id === id);
        return { id, name: c?.name ?? "Клиент", color: c?.color || "#c6ff3d", remaining: c?.remaining ?? null };
      });
      if (!list.length) return;
      if (list.length > 1) {
        if (!(await confirmEmptyMembership(list))) return;
        const ok = workout.start({
          kind: "group", id: String(Date.now()), clients: list,
          booking: { id: o.id, occDate: o.occDate, isOccurrence: o.isOccurrence, clientIds: o.clientIds, planId: o.planId, dayId: o.dayId },
        });
        if (!ok) notify("Одна тренировка уже идёт — заверши или сверни её.");
        return;
      }
      const self = list[0];
      const booking = { id: o.id, occDate: o.occDate };
      const plans = (await cached(`client-plans:${self.id}`, () => fetchClientPlans(self.id)).catch(() => null))?.filter((p) => !p.archived);
      // День из записи — только из действующего плана и не из блока в архиве: у старой серии
      // записей план мог давно уйти в архив, и тренировка записалась бы не туда
      if (o.planId && o.dayId && plans?.some((p) => p.id === o.planId)) {
        const plan = await fetchPlanCached(o.planId).catch(() => null);
        const day = plan?.days.find((d) => d.id === o.dayId);
        const archivedMeso = !!day?.mesocycleId && !!plan?.mesocycles?.find((m) => m.id === day.mesocycleId)?.archivedAt;
        if (plan && day && !archivedMeso) {
          if (!(await confirmEmptyMembership([self]))) return;
          if (!workout.start({ day, planId: plan.id, clientId: self.id, clientName: self.name, booking })) notify("Одна тренировка уже идёт — заверши или сверни её.");
          return;
        }
      }
      if (!plans) { notify("Не удалось загрузить планы клиента. Проверь интернет и попробуй ещё раз."); return; }
      if (!plans.length) { notify(`У клиента ${self.name} нет действующего плана — создай его в карточке клиента.`); return; }
      setPick({ self, plans, booking });
    } finally { lock.current = false; setBusy(false); }
  };

  const modal = pick && <StartWorkoutModal trainerId={trainerId} self={pick.self} plans={pick.plans} booking={pick.booking} onClose={() => setPick(null)} />;
  return { start, modal, busy };
}
