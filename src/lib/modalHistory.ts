// Разбор путей 0.1: «Назад» на телефоне закрывает верхнее окно, а не уводит экран под ним.
// Пока открыто хоть одно окно, в истории лежит одна запись-метка поверх экрана. «Назад»
// снимает её и закрывает верхнее окно; окно закрыли кнопкой — метку снимаем сами.
const MARK = "thModal";
const stack: { current: () => void }[] = [];
// Свои переходы по истории в пути (history.go асинхронный): их popstate — не нажатие
// «Назад», окна по ним не закрываем. Шаги назад, запрошенные в это время, ждут очереди.
let own = 0, ownAt = 0;
const queued: number[] = [];
// Переход за начало истории popstate не даёт — не даём счётчику зависнуть навсегда
const inFlight = () => { if (own > 0 && Date.now() - ownAt > 4000) { own = 0; queued.length = 0; } return own > 0; };

export const hasModalMark = () => !!(history.state as Record<string, unknown> | null)?.[MARK];
const pushMark = () => history.pushState({ ...(history.state ?? {}), [MARK]: true }, "");
const go = (n: number) => { own++; ownAt = Date.now(); history.go(n); };

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (inFlight()) {
      own--;
      if (own === 0 && queued.length) { stepBack(queued.shift()!); return; }
      // Пока шёл свой переход, открылось новое окно — ему нужна метка
      if (own === 0 && stack.length && !hasModalMark()) pushMark();
      return;
    }
    if (!stack.length || hasModalMark()) return;
    stack[stack.length - 1].current();
    // Окно не закрылось (спросило «Закрыть без сохранения?») или под ним есть ещё одно —
    // возвращаем метку, иначе следующий «Назад» уведёт с экрана
    setTimeout(() => { if (stack.length && !hasModalMark() && !inFlight()) pushMark(); }, 0);
  });
  // Перезагрузка страницы с открытым окном: окна нет, а метка осталась — снимаем её
  if (hasModalMark() && history.length > 1) go(-1);
}

/** Окно открылось; вернёт функцию «окно закрылось». close — ref на актуальный onClose */
export function registerModal(close: { current: () => void }) {
  stack.push(close);
  if (!hasModalMark() && !inFlight()) pushMark();
  return () => {
    const i = stack.indexOf(close);
    if (i >= 0) stack.splice(i, 1);
    // Откладываем: окно может смениться другим в той же отрисовке — тогда метка нужна дальше
    setTimeout(() => { if (!stack.length && hasModalMark() && !inFlight()) go(-1); }, 0);
  };
}

/** Шаг назад по своим записям (экран, режим выбора); метку окна сверху снимает заодно */
export function stepBack(n = 1) {
  if (inFlight()) { queued.push(n); return; }
  go(hasModalMark() ? -(n + 1) : -n);
}

/** «Назад» экрана */
export const screenBack = () => stepBack(1);
