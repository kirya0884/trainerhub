// Плашка свёрнутой тренировки висит над нижней панелью. Её высота уходит в CSS-переменную
// --minibar-h, чтобы круглая кнопка «+» поднималась над плашкой, а не перекрывала её.
// Ref-колбэк: при монтировании пишет высоту, при размонтировании (null) — убирает.
export const minibarRef = (el: HTMLElement | null) => {
  if (el) document.documentElement.style.setProperty("--minibar-h", `${el.offsetHeight}px`);
  else document.documentElement.style.removeProperty("--minibar-h");
};
