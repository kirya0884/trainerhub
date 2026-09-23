import { useEffect, useRef, useState } from "react";

const EDGE = 28;      // откуда стартует жест, px от левого края
const ARM = 12;       // сдвиг, после которого считаем жест начавшимся
const TRIGGER = 70;   // сдвиг, после которого срабатывает возврат
const MAX = 120;      // дальше экран не тянется

/**
 * Н1: свайп «назад» от левого края.
 *
 * В установленном PWA системного жеста нет — standalone-режим идёт без браузерных
 * жестов, поэтому рисуем свой. Возвращает сдвиг для содержимого: экран едет за
 * пальцем и возвращается на место, если отпустить раньше порога.
 *
 * Жест намеренно узкий, чтобы не драться с остальным:
 *  - стартует только от самого края;
 *  - только при явном горизонтальном движении;
 *  - не начинается над открытым модалом ([role="dialog"] — их проставил А1),
 *    над зоной перетаскивания и над полями ввода.
 */
export function useSwipeBack(enabled: boolean, onBack: () => void) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);
  const dxRef = useRef(0);
  const backRef = useRef(onBack);
  backRef.current = onBack;

  useEffect(() => {
    if (!enabled) { setDx(0); dxRef.current = 0; return; }

    const reset = () => { start.current = null; armed.current = false; dxRef.current = 0; setDx(0); };

    const blocked = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el?.closest) return false;
      return !!el.closest('[role="dialog"],[data-ds-root],[draggable="true"],input,textarea,select');
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE || blocked(e.target)) return;
      start.current = { x: t.clientX, y: t.clientY };
      armed.current = false;
      dxRef.current = 0;
    };

    const onMove = (e: TouchEvent) => {
      const s = start.current;
      if (!s || e.touches.length !== 1) return;
      const t = e.touches[0];
      const ddx = t.clientX - s.x;
      const ddy = Math.abs(t.clientY - s.y);

      if (!armed.current) {
        // Вертикальное движение — это прокрутка, жест не наш
        if (ddy > Math.abs(ddx)) { start.current = null; return; }
        if (ddx < ARM) return;
        armed.current = true;
      }
      // Пока жест идёт, страница под пальцем не должна прокручиваться
      if (e.cancelable) e.preventDefault();
      const v = Math.max(0, Math.min(MAX, ddx));
      dxRef.current = v;
      setDx(v);
    };

    const onEnd = () => {
      const fire = armed.current && dxRef.current >= TRIGGER;
      reset();
      if (fire) backRef.current();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  return dx;
}
