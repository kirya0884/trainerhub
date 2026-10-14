import { useEffect, useId, useRef } from "react";

/** Стек открытых модалов: Escape должен закрывать только верхний, а не всю стопку. */
const stack: symbol[] = [];

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * А1: доступность модала одним хуком — роль, подпись, ловушка Tab, возврат фокуса
 * и Escape только для верхнего окна.
 *
 * Возвращает props для корневой панели и id заголовка.
 *
 * Осторожно с начальным фокусом: в режиме проведения тренировки внутри есть поля
 * с autoFocus, и перехват фокуса подрался бы с ними. Поэтому фокус ставится один
 * раз, на саму панель, и только если внутри нет autoFocus и ничего ещё не в фокусе.
 */
export function useModalA11y(onClose: () => void, label?: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  // onClose родители передают новой стрелкой на каждой отрисовке. Раньше эффект зависел
  // от неё и перезапускался при любой перерисовке родителя (в кабинете клиента — фоновое
  // обновление раз в 20 с): возвращал фокус «назад» и ставил его на панель — поле ввода
  // теряло фокус, клавиатура на телефоне закрывалась. Теперь эффект живёт с окном.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const me = Symbol("modal");
    stack.push(me);
    const restoreTo = document.activeElement as HTMLElement | null;

    const panel = ref.current;
    if (panel && !panel.querySelector("[autofocus]") && !panel.contains(document.activeElement)) {
      panel.focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      // Не верхний модал — не наше событие
      if (stack[stack.length - 1] !== me) return;

      if (e.key === "Escape") { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== "Tab") return;

      const p = ref.current;
      if (!p) return;
      const items = Array.from(p.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); p.focus({ preventScroll: true }); return; }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Фон не должен попадать в обход по Tab — замыкаем круг внутри панели
      if (e.shiftKey && (active === first || !p.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !p.contains(active))) { e.preventDefault(); first.focus(); }
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      // Возврат фокуса туда, откуда открыли, — иначе он падает на body
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus({ preventScroll: true });
    };
  }, []);

  return {
    titleId,
    panelProps: {
      ref,
      role: "dialog" as const,
      "aria-modal": true,
      ...(label ? { "aria-label": label } : { "aria-labelledby": titleId }),
      tabIndex: -1,
    },
  };
}
