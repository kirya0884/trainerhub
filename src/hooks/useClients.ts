import { useEffect, useRef, useState } from "react";
import * as api from "../lib/clients";
import type { ClientListItem } from "../lib/clients";

// Общий список подопечных на всё приложение: грузится один раз в App.tsx и раздаётся пропсами,
// иначе каждое переключение вкладки размонтирует компонент и тянет тех же клиентов заново.
// clients === null означает «ещё не загружено» — на это опирается экран загрузки в ClientsList.
export function useClients(trainerId: string) {
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const reqRef = useRef(0);

  const load = () => {
    if (!trainerId) return;
    const req = ++reqRef.current;
    api.fetchClients(trainerId)
      .then((c) => { if (req === reqRef.current) setClients(c); })
      .catch((e) => console.error("[useClients]", e));
  };
  useEffect(() => { load(); }, [trainerId]);

  return { clients, reload: load };
}
