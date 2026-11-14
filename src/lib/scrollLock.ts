import { useEffect } from "react";

// Пока открыто окно поверх экрана, экран под ним не прокручивается: палец листает окно.
// Счётчик — окна бывают вложенными (вопрос поверх тренировки): закрытие верхнего
// не должно вернуть прокрутку, пока открыто нижнее.
let locks = 0;

export function lockScroll(): () => void {
  if (locks++ === 0) {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
  };
}

/** active=false — окно скрыто или свёрнуто, экран под ним листается */
export function useScrollLock(active = true) {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}
