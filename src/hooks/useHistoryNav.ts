import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "thView";

/**
 * Н1: навигация поверх history API.
 *
 * До этого весь переход был одним setView, и записей в истории не создавалось —
 * поэтому не работали ни свайп «назад», ни аппаратная кнопка на Android, ни кнопка
 * браузера: «назад» выбрасывал из приложения целиком.
 *
 * Стартовый экран кладётся через replaceState, иначе первый же «назад» уводил бы
 * с приложения. Повторный переход на тот же экран не плодит записи — заменяет.
 */
export function useHistoryNav<T>(initial: T) {
  const [view, setView] = useState<T>(initial);
  const ref = useRef(view);
  ref.current = view;

  useEffect(() => {
    history.replaceState({ ...(history.state ?? {}), [KEY]: ref.current }, "");
    const onPop = (e: PopStateEvent) => {
      const v = (e.state as Record<string, unknown> | null)?.[KEY];
      // Записи без нашего состояния не наши — не трогаем
      if (v !== undefined) setView(v as T);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const push = useCallback((v: T) => {
    const same = JSON.stringify(v) === JSON.stringify(ref.current);
    if (same) history.replaceState({ ...(history.state ?? {}), [KEY]: v }, "");
    else history.pushState({ [KEY]: v }, "");
    setView(v);
  }, []);

  /** Замена текущего экрана без новой записи — для смены под-вкладки и похожего. */
  const replace = useCallback((v: T) => {
    history.replaceState({ ...(history.state ?? {}), [KEY]: v }, "");
    setView(v);
  }, []);

  const back = useCallback(() => history.back(), []);

  return { view, push, replace, back };
}
