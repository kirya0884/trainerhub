// Браузерные уведомления (native Notification API, без библиотек) — один раз в день на тренера,
// чтобы не спамить при каждом открытии дашборда. Флаг дня храним в localStorage.
export function requestNotifyPermission() {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
}

export function notifyDailyDigest(trainerId: string, items: { todayCount: number; debtNames: string[]; expiringNames: string[] }) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const key = `trainerhub-notified-${trainerId}-${new Date().toISOString().slice(0, 10)}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");

  if (items.todayCount > 0) {
    new Notification("Reps", { body: `Сегодня ${items.todayCount} тренировк${items.todayCount === 1 ? "а" : "и"} по записи` });
  }
  if (items.debtNames.length > 0) {
    new Notification("Reps — остаток исчерпан", { body: items.debtNames.join(", ") });
  }
  if (items.expiringNames.length > 0) {
    new Notification("Reps — мало тренировок осталось", { body: items.expiringNames.join(", ") });
  }
}
