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

// Тренеру: подопечный начал тренировку
export function notifyClientStarted(clientName: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification("Reps — Тренировка началась", { body: `${clientName} начал тренировку` });
}

// Тренеру: подопечный завершил тренировку
export function notifyClientFinished(clientName: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification("Reps — Тренировка завершена", { body: `${clientName} завершил тренировку` });
}

// Клиенту: мало тренировок осталось (≤2)
export function notifyLowBalance(clientId: string, remaining: number) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const key = `trainerhub-lowbal-${clientId}-${new Date().toISOString().slice(0, 10)}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  new Notification("Reps — Осталось мало тренировок", { body: `У вас осталось ${remaining} тренировк${remaining === 1 ? "а" : "и"} в пакете` });
}

// Клиенту: скоро продление подписки (≤2 дня)
export function notifyRenewalSoon(clientId: string, daysLeft: number, date: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const key = `trainerhub-renewal-${clientId}-${date}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  const body = daysLeft === 0 ? "Сегодня дата продления подписки" : `Продление подписки через ${daysLeft} дн.`;
  new Notification("Reps — Скоро продление", { body });
}

// Напоминание о предстоящей тренировке (клиенту за 2ч, тренеру за 1ч)
export function notifyUpcomingBooking(role: "client" | "trainer", id: string, date: string, time: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const key = `trainerhub-upcoming-${role}-${id}-${date}-${time}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  const ahead = role === "client" ? "через 2 часа" : "через 1 час";
  new Notification("Reps — Скоро тренировка", { body: `Тренировка сегодня в ${time} — ${ahead}` });
}
