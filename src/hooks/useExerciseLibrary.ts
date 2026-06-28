import { useEffect, useState } from "react";
import { BUILTIN_EX_NAMES } from "../data/exerciseLibrary";
import * as api from "../lib/library";

// Объединяет встроенный каталог упражнений с персональной библиотекой тренера ("Мои").
export function useExerciseLibrary(trainerId: string) {
  const [customNames, setCustomNames] = useState<string[]>([]);

  useEffect(() => { api.fetchCustomExercises(trainerId).then(setCustomNames); }, [trainerId]);

  const allNames = [...BUILTIN_EX_NAMES, ...customNames];

  const addToLibrary = async (name: string) => {
    const n = name.trim();
    if (!n) return;
    const nl = n.toLowerCase();
    if (allNames.some((x) => x.toLowerCase() === nl)) return;
    await api.addCustomExercise(trainerId, n);
    setCustomNames((prev) => [...prev, n]);
  };

  return { customNames, allNames, addToLibrary };
}
