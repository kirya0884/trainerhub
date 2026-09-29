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
 *
 * B25: к записи истории добавился адрес. Состояние экрана по-прежнему живёт в
 * history.state — оно надёжнее разбора строки; адрес нужен, чтобы экран можно было
 * прислать ссылкой и чтобы он пережил обновление страницы.
 */
export function useHistoryNav<T>(initial: T, toUrl?: (v: T) => string, fromUrl?: (hash: string) => T | null) {
  const [view, setView] = useState<T>(() => {
    // Адрес при запуске важнее умолчания: по ссылке и после обновления страницы
    // должен открыться тот экран, что в адресе.
    if (fromUrl && location.hash) {
      const v = fromUrl(location.hash);
      if (v) return v;
    }
    return initial;
  });
  const ref = useRef(view);
  ref.current = view;

  const url = useCallback((v: T) => (toUrl ? toUrl(v) : location.hash || "#/"), [toUrl]);

  useEffect(() => {
    history.replaceState({ ...(history.state ?? {}), [KEY]: ref.current }, "", url(ref.current));

    const onPop = (e: PopStateEvent) => {
      const v = (e.state as Record<string, unknown> | null)?.[KEY];
      if (v !== undefined) { setView(v as T); return; }
      // Записи без нашего состояния: адрес правили руками или пришли по ссылке
      if (fromUrl) {
        const fromHash = fromUrl(location.hash);
        if (fromHash) setView(fromHash);
      }
    };
    // Ручная правка адреса даёт hashchange, но НЕ popstate. Свои переходы тоже
    // меняют хеш, поэтому сравниваем с адресом текущего экрана и молчим, если он тот же.
    const onHash = () => {
      if (!fromUrl) return;
      if (location.hash === url(ref.current)) return;
      const v = fromUrl(location.hash);
      if (v) { history.replaceState({ ...(history.state ?? {}), [KEY]: v }, "", location.hash); setView(v); }
    };

    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onHash);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback((v: T) => {
    const same = JSON.stringify(v) === JSON.stringify(ref.current);
    if (same) history.replaceState({ ...(history.state ?? {}), [KEY]: v }, "", url(v));
    else history.pushState({ [KEY]: v }, "", url(v));
    setView(v);
  }, [url]);

  /** Замена текущего экрана без новой записи — для смены под-вкладки и похожего. */
  const replace = useCallback((v: T) => {
    history.replaceState({ ...(history.state ?? {}), [KEY]: v }, "", url(v));
    setView(v);
  }, [url]);

  const back = useCallback(() => history.back(), []);

  return { view, push, replace, back };
}
