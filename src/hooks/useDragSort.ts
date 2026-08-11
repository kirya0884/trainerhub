import { useCallback, useEffect, useRef, useState } from "react";

type Drag = { key: string; from: number; over: number };

/**
 * Перетаскивание элементов списка на нативных Pointer Events.
 *
 * Слушатели вешаются один раз на контейнер и работают делегированием: элемент
 * ищется по [data-ds-idx], ручка — по [data-ds-handle]. Так строкам не нужно
 * передавать объекты-обработчики, и их мемоизация остаётся рабочей.
 *
 * Порядок в DOM = порядок в массиве, поэтому вложенность (суперсеты) не мешает.
 * Наружу пишем один раз, на отпускании: onDrop(key, from, to).
 */
export function useDragSort(onDrop: (key: string, from: number, to: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const cancelPress = useCallback(() => {
    if (pressTimer.current != null) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    pressAt.current = null;
  }, []);

  const begin = useCallback((container: HTMLElement, key: string, from: number) => {
    containerRef.current = container;
    dragRef.current = { key, from, over: from };
    setDrag(dragRef.current);
    // Выделение текста при долгом нажатии — снимаем на время жеста
    document.body.style.userSelect = "none";
    (document.body.style as any).webkitUserSelect = "none";
  }, []);

  const rootProps = (key: string) => ({
    "data-ds-root": true,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const t = e.target as HTMLElement;
      const item = t.closest<HTMLElement>("[data-ds-idx]");
      if (!item) return;
      const container = e.currentTarget as HTMLElement;
      const idx = Number(item.dataset.dsIdx);
      if (!Number.isFinite(idx)) return;
      cancelPress();
      // Ручка — тащим сразу; остальная карточка — после удержания, и только мимо полей
      if (t.closest("[data-ds-handle]")) { begin(container, key, idx); return; }
      if (t.closest("input,button,textarea,select,a,[contenteditable]")) return;
      pressAt.current = { x: e.clientX, y: e.clientY };
      pressTimer.current = window.setTimeout(() => { pressTimer.current = null; begin(container, key, idx); }, 350);
    },
    onPointerMove: (e: React.PointerEvent) => {
      // Палец поехал до срабатывания таймера — это скролл, а не перетаскивание
      const at = pressAt.current;
      if (pressTimer.current != null && at &&
          (Math.abs(e.clientX - at.x) > 8 || Math.abs(e.clientY - at.y) > 8)) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
  });

  useEffect(() => {
    if (!drag) return;
    const container = containerRef.current;
    if (!container) return;

    const targetAt = (y: number) => {
      const els = Array.from(container.querySelectorAll<HTMLElement>("[data-ds-idx]"));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) return Number(el.dataset.dsIdx);
      }
      return els.length;
    };

    const move = (e: PointerEvent) => {
      const over = targetAt(e.clientY);
      if (dragRef.current && dragRef.current.over !== over) {
        dragRef.current = { ...dragRef.current, over };
        setDrag(dragRef.current);
      }
    };
    const finish = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      document.body.style.userSelect = "";
      (document.body.style as any).webkitUserSelect = "";
      if (!d) return;
      // over — позиция вставки до изъятия элемента; после изъятия индексы правее сдвигаются
      const to = d.over > d.from ? d.over - 1 : d.over;
      if (to !== d.from) dropRef.current(d.key, d.from, to);
    };
    const stopTouch = (e: TouchEvent) => e.preventDefault();
    const stopMenu = (e: Event) => e.preventDefault();

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    // Не-пассивный: иначе страница уедет скроллом вместе с пальцем
    window.addEventListener("touchmove", stopTouch, { passive: false });
    window.addEventListener("contextmenu", stopMenu);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("touchmove", stopTouch);
      window.removeEventListener("contextmenu", stopMenu);
    };
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => cancelPress, [cancelPress]);

  return { drag, rootProps };
}
