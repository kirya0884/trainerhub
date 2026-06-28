import { useCallback, useRef } from "react";

// Debounce: текстовые поля копят правки и сохраняются через 400мс простоя, чтобы не слать запрос на каждую букву.
export function useDebouncedPersist() {
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, Record<string, any>>>({});
  const fn = useCallback((key: string, patch: Record<string, any>, save: (p: Record<string, any>) => void) => {
    pending.current[key] = { ...(pending.current[key] ?? {}), ...patch };
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      const p = pending.current[key];
      delete pending.current[key];
      save(p);
    }, 400);
  }, []) as ((key: string, patch: Record<string, any>, save: (p: Record<string, any>) => void) => void) & { cancel: (key: string) => void };
  // ponytail: отменяет отложенную запись — нужно перед immediate-патчем, иначе старый debounce
  // "выстрелит" позже и затрёт свежие данные (гонка), см. ClientProfile.patchMembership.
  fn.cancel = useCallback((key: string) => {
    clearTimeout(timers.current[key]);
    delete pending.current[key];
  }, []);
  return fn;
}
