// B33: ручная проверка обновлений из профиля тренера.
// Нужна как запасной выход: автоматическая кнопка «Доступно обновление» появляется
// только когда браузер сам заметил новую версию, а на iOS в режиме «на рабочий экран»
// это может занять заметное время.
//
// Работаем нативным API, а не virtual:pwa-register — чтобы компонент не зависел
// от модуля, который живёт в main.tsx.
export type UpdateResult = "updating" | "latest" | "unsupported" | "error";

export async function checkForUpdate(): Promise<UpdateResult> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return "unsupported";

    await reg.update();
    // Новая версия ждёт активации — она попадает сюда, потому что sw.ts больше
    // не вызывает skipWaiting() безусловно (см. B32).
    const waiting = reg.waiting;
    if (!waiting) return "latest";

    waiting.postMessage({ type: "SKIP_WAITING" });
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    // ponytail: страховка на случай, если controllerchange не придёт — на iOS бывает
    setTimeout(() => window.location.reload(), 2500);
    return "updating";
  } catch { return "error"; }
}
