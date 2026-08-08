import { useEffect, useRef } from "react";
import { loadViewState, saveViewState } from "../lib/viewState";

// B12: возвращает прокрутку на прежнее место при возврате на экран.
// ready нужен потому, что до загрузки списка страница короткая и браузер
// прижмёт восстановленную позицию к нулю.
// ponytail: если список за это время сократился, попадём не точно в ту же строку —
// якоря по id ради этого не городим.
export function useScrollRestore(key: string, ready: boolean) {
  const restored = useRef(false);

  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const y = loadViewState(`scroll-${key}`, 0);
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [key, ready]);

  useEffect(() => {
    return () => { saveViewState(`scroll-${key}`, window.scrollY); };
  }, [key]);
}
