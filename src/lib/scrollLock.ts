import { useEffect } from "react";

// Пока открыто окно поверх экрана, экран под ним не прокручивается: палец листает окно.
// Счётчик — окна бывают вложенными (вопрос поверх тренировки): закрытие верхнего
// не должно вернуть прокрутку, пока открыто нижнее.
//
// На iPhone overflow:hidden прокрутку пальцем не держит, поэтому body фиксируем на месте
// (top = −прокрутка) и возвращаем позицию при закрытии. И ещё: с открытой клавиатурой iOS
// сдвигает видимую область, если вести пальцем по неподвижной части окна (шапка, поле ввода), —
// окно, привязанное к видимой области, дёргается за ней. Такие касания гасим: двигаться
// пальцем можно только там, где внутри окна есть что листать.
let locks = 0;
let savedY = 0;
let lastX = 0, lastY = 0;

const canScroll = (el: Element, axis: "x" | "y") => {
  const s = getComputedStyle(el);
  const o = axis === "y" ? s.overflowY : s.overflowX;
  if (o !== "auto" && o !== "scroll") return false;
  return axis === "y" ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
};

const onStart = (e: TouchEvent) => {
  lastX = e.touches[0]?.clientX ?? 0;
  lastY = e.touches[0]?.clientY ?? 0;
};

const onMove = (e: TouchEvent) => {
  if (e.touches.length !== 1) return; // масштаб двумя пальцами не трогаем
  const t = e.touches[0];
  const dx = t.clientX - lastX, dy = t.clientY - lastY;
  lastX = t.clientX; lastY = t.clientY;
  const target = e.target as Element | null;
  if (!target || target.closest?.('input[type="range"]')) return;
  const axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
  for (let el: Element | null = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (!canScroll(el, axis)) continue;
    if (axis === "x") return;
    // Упёрлись в край списка — дальше потянулась бы вся страница, это и гасим
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if ((dy > 0 && atTop) || (dy < 0 && atBottom)) break;
    return;
  }
  if (e.cancelable) e.preventDefault();
};

export function lockScroll(): () => void {
  if (locks++ === 0) {
    savedY = window.scrollY;
    document.documentElement.style.overflow = "hidden";
    Object.assign(document.body.style, { position: "fixed", top: `-${savedY}px`, left: "0", right: "0", overflow: "hidden" });
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.documentElement.style.overflow = "";
      Object.assign(document.body.style, { position: "", top: "", left: "", right: "", overflow: "" });
      window.scrollTo(0, savedY);
    }
  };
}

/** active=false — окно скрыто или свёрнуто, экран под ним листается */
export function useScrollLock(active = true) {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}
