import { useEffect, useState } from "react";

type Box = { top: number; bottom: number; height: number };

/**
 * Видимая над экранной клавиатурой часть экрана — для нижних листов с полями ввода.
 *
 * На iOS (и на Android при interactive-widget=resizes-visual в index.html) клавиатура
 * сжимает только visualViewport: fixed-окно остаётся во всю высоту, и его низ уходит
 * под клавиатуру. Пока клавиатура открыта, хук отдаёт отступы видимой области от верха
 * и низа экрана (низ = innerHeight − высота − offsetTop) и её высоту — окно ставится в неё. Если браузер сам сжал страницу (resizes-content), разницы
 * между innerHeight и visualViewport нет — вернётся null, двойного сдвига не будет.
 */
export function useKeyboardViewport() {
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Меньше 120 px — это не клавиатура, а панели браузера или погрешность
      const open = window.innerHeight - vv.height > 120;
      const next = open ? {
        top: Math.round(vv.offsetTop),
        bottom: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
        height: Math.round(vv.height),
      } : null;
      setBox((b) => (b?.top === next?.top && b?.bottom === next?.bottom && b?.height === next?.height ? b : next));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);

  return box;
}
