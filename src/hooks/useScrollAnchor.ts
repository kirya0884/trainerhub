import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Экран не прыгает, когда над пальцем меняется высота. Отметка подхода в следующем
 * упражнении сворачивает выполненное выше (карточка → строка), всё ниже уезжает вверх,
 * и кнопка, на которую только что нажали, оказывается в другом месте.
 *
 * anchor() запоминает, где на экране была последняя нажатая кнопка; после перерисовки
 * компонента прокрутка сдвигается ровно на столько, на сколько кнопка уехала.
 * Браузерная «привязка прокрутки» (overflow-anchor) этого не решает: в Safari её нет.
 * Нажатый элемент берём из pointerdown — кнопки на iPhone фокус при тапе не получают.
 *
 * Компенсировать можно только то, что ушло за верх экрана: если сворачивается карточка,
 * которая ещё видна, прокрутки сверху может не хватить. Поэтому offscreenAbove() отдаёт
 * упражнения (по data-exid), целиком ушедшие вверх, — сворачивать стоит только их.
 */
export function useScrollAnchor() {
  const lastTap = useRef<HTMLElement | null>(null);
  const pending = useRef<{ el: HTMLElement; top: number; box: HTMLElement } | null>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { lastTap.current = e.target instanceof HTMLElement ? e.target : null; };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  // Без зависимостей — после каждой перерисовки; работает только если есть отложенная привязка
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    if (!p.el.isConnected) return; // сама кнопка свернулась — двигать нечего
    const delta = p.el.getBoundingClientRect().top - p.top;
    if (Math.abs(delta) > 1) p.box.scrollTop += delta;
  });

  const scrollBox = (el: HTMLElement) => {
    let box = el.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    return box;
  };

  const anchor = () => {
    const el = lastTap.current;
    if (!el?.isConnected) return;
    const box = scrollBox(el);
    if (box) pending.current = { el, top: el.getBoundingClientRect().top, box };
  };

  /** id упражнений, чьи карточки целиком выше видимой области прокрутки */
  const offscreenAbove = (ids: string[]) => {
    const el = lastTap.current;
    const box = el?.isConnected ? scrollBox(el) : null;
    if (!box) return [];
    const top = box.getBoundingClientRect().top;
    return ids.filter((id) => {
      const card = box.querySelector<HTMLElement>(`[data-exid="${CSS.escape(id)}"]`);
      return !!card && card.getBoundingClientRect().bottom <= top;
    });
  };

  return { anchor, offscreenAbove };
}
