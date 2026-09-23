import { useEffect, useRef, useState } from "react";
import * as api from "../lib/clients";
import { onClientsChanged } from "../lib/clientsBus";
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

  // Н3: перезагрузка по сигналу об изменении абонемента. Склеиваем всплеск —
  // сплит платежа пишет две записи подряд, дёргать базу дважды незачем.
  useEffect(() => {
    let t: number | undefined;
    const off = onClientsChanged(() => {
      if (t) clearTimeout(t);
      t = window.setTimeout(load, 250);
    });
    return () => { off(); if (t) clearTimeout(t); };
  }, [trainerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { clients, reload: load };
}
