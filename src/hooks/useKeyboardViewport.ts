import { useEffect, useState } from "react";

type Box = { top: number; bottom: number; height: number };

/** Поле, для которого телефон открывает клавиатуру (флажки, кнопки и т. п. — нет) */
export const isTextField = (el: Element | null) =>
  !!el && (el.matches("textarea, select, [contenteditable=''], [contenteditable='true']")
    || (el.matches("input") && !["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"].includes((el as HTMLInputElement).type)));

/**
 * Видимая над экранной клавиатурой часть экрана — для нижних листов с полями ввода.
 *
 * На iOS (и на Android при interactive-widget=resizes-visual в index.html) клавиатура
 * сжимает только visualViewport: fixed-окно остаётся во всю высоту, и его низ уходит
 * под клавиатуру. Пока клавиатура открыта, хук отдаёт отступы видимой области от верха
 * и низа экрана (низ = innerHeight − высота − offsetTop) и её высоту — окно ставится в неё. Если браузер сам сжал страницу (resizes-content), разницы
 * между innerHeight и visualViewport нет — вернётся null, двойного сдвига не будет.
 *
 * Клавиатурой считаем только сжатие при фокусе в поле ввода и без масштаба: pinch-zoom тоже
 * уменьшает visualViewport, но сжимать экран и прятать панели тогда нельзя. По focusin/focusout
 * пересчитываем сами — в standalone iOS после закрытия клавиатуры resize может не прийти.
 */
export function useKeyboardViewport() {
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Меньше 120 px — это не клавиатура, а панели браузера или погрешность
      const open = isTextField(document.activeElement) && Math.abs(vv.scale - 1) < 0.01 && window.innerHeight - vv.height > 120;
      const next = open ? {
        top: Math.round(vv.offsetTop),
        bottom: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
        height: Math.round(vv.height),
      } : null;
      setBox((b) => (b?.top === next?.top && b?.bottom === next?.bottom && b?.height === next?.height ? b : next));
    };
    // Фокус может сразу перейти в соседнее поле — после ухода проверяем чуть позже
    let t = 0;
    const onOut = () => { clearTimeout(t); t = window.setTimeout(update, 50); };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", onOut);
    return () => {
      clearTimeout(t);
      vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update); document.removeEventListener("focusout", onOut);
    };
  }, []);

  return box;
}
