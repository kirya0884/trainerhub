import { useEffect, useState } from "react";

/** Загрузка данных страницы; при смене периода — заново, старый ответ не перетирает новый */
export function useData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    load().then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) { setError(String(e.message ?? e)); setData(null); } });
    return () => { alive = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading: data === null && !error };
}
