import { useCallback, useEffect, useMemo, useState } from "react";
import { isNetworkError } from "../lib/outbox";
import { BUILTIN_EX_NAMES } from "../data/exerciseLibrary";
import * as api from "../lib/library";

// Объединяет встроенный каталог упражнений с персональной библиотекой тренера ("Мои").
export function useExerciseLibrary(trainerId: string) {
  const [customNames, setCustomNames] = useState<string[]>([]);

  // Без сети — просто без своих упражнений в подсказках, это не ошибка
  useEffect(() => { let alive = true; api.fetchCustomExercises(trainerId).then((n) => { if (alive) setCustomNames(n); }).catch((e) => { if (!isNetworkError(e)) console.error("[useExerciseLibrary]", e); }); return () => { alive = false; }; }, [trainerId]);

  const allNames = useMemo(() => [...BUILTIN_EX_NAMES, ...customNames], [customNames]);

  const addToLibrary = useCallback(async (name: string) => {
    const n = name.trim();
    if (!n) return;
    const nl = n.toLowerCase();
    if (allNames.some((x) => x.toLowerCase() === nl)) return;
    await api.addCustomExercise(trainerId, n);
    setCustomNames((prev) => [...prev, n]);
  }, [allNames, trainerId]);

  return { customNames, allNames, addToLibrary };
}
