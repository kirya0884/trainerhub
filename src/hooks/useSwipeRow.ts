import { useEffect, useRef, useState } from "react";

const ARM = 10;   // сдвиг, после которого считаем жест начавшимся
const MAX = 96;   // ширина панели действий

/**
 * B11: свайп по строке списка открывает панель действий.
 *
 * Только ВЛЕВО: свайп вправо занят возвратом назад (Н1). Конфликта нет — возврат
 * стартует лишь от левого края экрана, а этот жест берётся из любой точки строки,
 * но тянет в другую сторону.
 *
 * Вертикальное движение отменяет жест: в списке это прокрутка, и вырывать её
 * из-под пальца нельзя.
 *
 * Открытая панель одна на список: свайпнули вторую строку — первая закрылась.
 * Хранится id открытой строки, а не флаг на каждой.
 */
export function useSwipeRow() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: string } | null>(null);
  const armed = useRef(false);
  const dxRef = useRef(0);

  // Нажатие мимо открытой панели закрывает её
  useEffect(() => {
    if (!openId) return;
    const close = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.(`[data-row-id="${openId}"]`)) return;
      setOpenId(null);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [openId]);

  const rowProps = (id: string) => ({
    "data-row-id": id,
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, id };
      armed.current = false;
      dxRef.current = 0;
    },
    onTouchMove: (e: React.TouchEvent) => {
      const s = start.current;
      if (!s || s.id !== id || e.touches.length !== 1) return;
      const t = e.touches[0];
      const ddx = t.clientX - s.x;
      const ddy = Math.abs(t.clientY - s.y);

      if (!armed.current) {
        // Вертикаль победила — это прокрутка списка, жест не наш
        if (ddy > Math.abs(ddx)) { start.current = null; return; }
        if (ddx > -ARM) return; // тянут вправо или ещё не тянут — не наше
        armed.current = true;
        if (openId && openId !== id) setOpenId(null);
      }
      const v = Math.max(-MAX, Math.min(0, ddx));
      dxRef.current = v;
      setDx(v);
    },
    onTouchEnd: () => {
      const s = start.current;
      const wasArmed = armed.current;
      const v = dxRef.current;
      start.current = null;
      armed.current = false;
      dxRef.current = 0;
      setDx(0);
      if (!s || !wasArmed) return;
      // Утянули больше половины — панель фиксируется, иначе строка возвращается
      setOpenId(v <= -MAX / 2 ? s.id : null);
    },
    onTouchCancel: () => {
      start.current = null;
      armed.current = false;
      dxRef.current = 0;
      setDx(0);
    },
  });

  /** Сдвиг строки: тянущаяся — за пальцем, открытая — на всю ширину панели. */
  const offsetFor = (id: string) =>
    start.current?.id === id && armed.current ? dx : openId === id ? -MAX : 0;

  return { openId, setOpenId, rowProps, offsetFor, PANEL_W: MAX };
}
