import { useEffect, useRef, useState } from "react";
import { useSharedListSync } from "./useSharedListSync";
import * as api from "../lib/clients";
import type { PlanOverviewItem } from "../lib/clients";
import { cached, peekCache } from "../lib/offlineCache";

// B04: все планы тренера поднимаем в App — их ищет глобальный поиск, и заодно
// раздел «Планы» перестаёт грузить их заново при каждом заходе (та же схема, что
// у useClients из B17). Гард пустого trainerId — App вызывает хуки до ранних return.
export function usePlans(trainerId: string) {
  const [plans, setPlans] = useState<PlanOverviewItem[] | null>(null);
  const reqRef = useRef(0);

  const load = () => {
    if (!trainerId) return;
    const req = ++reqRef.current;
    cached("plans", () => api.fetchAllPlans(trainerId))
      .then((p) => { if (req === reqRef.current) setPlans(p); })
      .catch((e) => console.error("[usePlans]", e));
  };
  // Смена или выход пользователя — чужие планы не держим и поздний ответ не принимаем.
  // Сохранённые показываем сразу, пока идёт запрос
  useEffect(() => { reqRef.current++; setPlans(trainerId ? peekCache<PlanOverviewItem[]>("plans")?.data ?? null : null); load(); }, [trainerId]);

  // А4: обновление из другого окна — возврат к окну и события репликации
  useSharedListSync(!!trainerId, ["plans"], load, `plans-sync-${trainerId}`);

  return { plans, reload: load };
}
