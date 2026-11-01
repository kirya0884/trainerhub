// Разбор путей 1.9: событие «можно установить» (Android/Chrome) приходит один раз и рано —
// раньше, чем загрузится кабинет клиента. Ловим его при старте и отдаём по запросу.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; listeners.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((f) => f()); });
}
export const canPromptInstall = () => !!deferred;
export const onInstallChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  return (await e.userChoice).outcome === "accepted";
}
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
// iPadOS притворяется Mac — узнаём его по сенсорному экрану
export const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/** Встроенный браузер мессенджера: оттуда не установить, и вход там не сохранится в приложении */
export const isInAppBrowser = () => /Telegram|WhatsApp|Instagram|FBAN|FBAV|VKClient/i.test(navigator.userAgent);
