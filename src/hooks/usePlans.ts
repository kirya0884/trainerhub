import { useEffect, useRef, useState } from "react";
import * as api from "../lib/clients";
import type { PlanOverviewItem } from "../lib/clients";

// B04: все планы тренера поднимаем в App — их ищет глобальный поиск, и заодно
// раздел «Планы» перестаёт грузить их заново при каждом заходе (та же схема, что
// у useClients из B17). Гард пустого trainerId — App вызывает хуки до ранних return.
export function usePlans(trainerId: string) {
  const [plans, setPlans] = useState<PlanOverviewItem[] | null>(null);
  const reqRef = useRef(0);

  const load = () => {
    if (!trainerId) return;
    const req = ++reqRef.current;
    api.fetchAllPlans(trainerId)
      .then((p) => { if (req === reqRef.current) setPlans(p); })
      .catch((e) => console.error("[usePlans]", e));
  };
  useEffect(() => { load(); }, [trainerId]);

  return { plans, reload: load };
}
