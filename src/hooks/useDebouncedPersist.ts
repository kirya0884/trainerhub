import { useCallback, useRef } from "react";

// Debounce: текстовые поля копят правки и сохраняются через 400мс простоя, чтобы не слать запрос на каждую букву.
export function useDebouncedPersist() {
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, Record<string, any>>>({});
  const saves = useRef<Record<string, (p: Record<string, any>) => void>>({});
  const fn = useCallback((key: string, patch: Record<string, any>, save: (p: Record<string, any>) => void) => {
    pending.current[key] = { ...(pending.current[key] ?? {}), ...patch };
    saves.current[key] = save;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      const p = pending.current[key];
      delete pending.current[key];
      save(p);
    }, 400);
  }, []) as ((key: string, patch: Record<string, any>, save: (p: Record<string, any>) => void) => void) & { cancel: (key: string) => void; flush: (key: string) => void };
  // ponytail: отменяет отложенную запись — нужно перед immediate-патчем, иначе старый debounce
  // "выстрелит" позже и затрёт свежие данные (гонка), см. ClientProfile.patchMembership.
  fn.cancel = useCallback((key: string) => {
    clearTimeout(timers.current[key]);
    delete pending.current[key];
  }, []);
  // Отправляет накопленное сразу, не дожидаясь 400 мс. Нужно, когда сохраняются только
  // изменённые поля: cancel потерял бы ещё не отправленный ввод.
  fn.flush = useCallback((key: string) => {
    const p = pending.current[key];
    clearTimeout(timers.current[key]);
    delete pending.current[key];
    if (p) saves.current[key]?.(p);
  }, []);
  return fn;
}
