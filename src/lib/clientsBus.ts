// Н3: сигнал «данные подопечных изменились».
//
// Список подопечных один на всё приложение: грузится в App.tsx и раздаётся в
// календарь, дашборд, окно записи, список планов и аналитику. Значит любая правка
// абонемента обязана его обновить, иначе остаток тренировок остаётся старым везде,
// кроме экрана, где правили. Из восьми мест, меняющих остаток, обновляли три —
// например оплата из карточки подопечного правила только своё локальное состояние.
//
// Сигнал шлётся у источника (lib/clients.ts, lib/payments.ts), а не из компонентов:
// новое место, меняющее абонемент, получит обновление само, без правки интерфейса.

const bus = new EventTarget();
const EVT = "clients-changed";

export function notifyClientsChanged() {
  bus.dispatchEvent(new Event(EVT));
}

export function onClientsChanged(fn: () => void) {
  bus.addEventListener(EVT, fn);
  return () => bus.removeEventListener(EVT, fn);
}

// Д3: тренировка завершена. PlanEditor может быть размонтирован в этот момент
// (тренировка теперь живёт на уровне приложения), поэтому он перечитывает
// прогресс по сигналу, а не полагается на собственный колбэк.
const FIN = "workout-finished";

export function notifyWorkoutFinished(planId: string) {
  bus.dispatchEvent(new CustomEvent(FIN, { detail: planId }));
}

export function onWorkoutFinished(fn: (planId: string) => void) {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  bus.addEventListener(FIN, h);
  return () => bus.removeEventListener(FIN, h);
}
