// Человеческие названия событий, функций и тарифов

const TARGETS: Record<string, string> = {
  dashboard: "Главная", clients: "Подопечные", client: "Карточка подопечного", plans: "Планы", plan: "План", calendar: "Календарь",
  trainerProfile: "Профиль", me: "Вкладка «Я»", profile: "Главная (клиент)", program: "Программа (клиент)", nutrition: "Питание (клиент)",
  reporting: "Прогресс (клиент)", nutrition_report: "Отчёты питания", nutrition_diary: "Дневник питания", booking: "Запись", start: "Начало сеанса",
  workout_start: "Тренировка начата", workout_finish: "Тренировка завершена", payment: "Оплата принята", renew: "Продление абонемента",
  client_created: "Новый подопечный (мастер)", no_show: "«Не пришёл»", remind: "Напоминание", backup_export: "Резервная копия: выгрузка",
  backup_import: "Резервная копия: загрузка", food_add: "Еда добавлена", water: "Вода", nutrition_goal: "Цель питания", nutrition_comment: "Комментарий к питанию",
  recipe: "Рецепт создан", recipe_edit: "Рецепт изменён", offline_queued: "Без сети: отложено", offline_sent: "Без сети: дослано",
  open_booking: "Открыта запись", start_workout: "Тренировка начата (старое)",
};
const EVENTS: Record<string, string> = { view: "Экран", open_client: "Открыт подопечный", create: "Создание", search: "Поиск", action: "Действие", session: "Сеанс" };

export const eventLabel = (event: string, target: string | null) => {
  if (event === "open_client") return "Открыт подопечный";
  const t = target ? TARGETS[target] ?? target : "";
  if (event === "view") return t ? `Экран: ${t}` : "Экран";
  if (event === "create") return `Создание: ${target === "client" ? "подопечный" : target === "plan" ? "план" : target === "booking" ? "запись" : t}`;
  if (event === "search") return "Поиск";
  return t || EVENTS[event] || event;
};

/** kind из ленты активности: «view:plan», «workout:client», «food:self»… */
export const kindLabel = (kind: string) => {
  const [a, b] = kind.split(":");
  const special: Record<string, string> = {
    "workout:trainer": "Тренировка с тренером", "workout:client": "Тренировка клиента сам", "workout:self": "Своя тренировка тренера",
    "food:client": "Питание клиента", "food:self": "Питание тренера", "message:client": "Сообщение клиента", "message:trainer": "Сообщение тренера", payment: "Оплата",
  };
  return special[kind] ?? eventLabel(a, b ?? null);
};

export const FEATURES: Record<string, string> = {
  workouts: "Проведение тренировок", client_workouts: "Клиенты тренируются сами", calendar: "Календарь и записи", payments: "Оплаты",
  nutrition: "Питание клиентов", portal: "Кабинет клиента", chat: "Чат", me: "Вкладка «Я»", plans: "Планы", reminders: "Напоминания",
  renewals: "Продление абонемента", no_show: "«Не пришёл»", offline: "Работа без сети",
};

export const FUNNEL: Record<string, string> = {
  signup: "Регистрация", client: "Добавил подопечного", plan: "Создал план", workout: "Провёл тренировку", booking: "Записал в календарь",
  payment: "Принял оплату", portal: "Пригласил в кабинет", client_active: "Клиент активен",
};

export const TIERS: Record<string, string> = { start: "Старт", basic: "Базовый", pro: "Про", studio: "Студия" };
export const DEVICES: Record<string, string> = {
  ios: "iPhone (браузер)", "ios-pwa": "iPhone (приложение)", android: "Android (браузер)", "android-pwa": "Android (приложение)",
  desktop: "Компьютер", "desktop-pwa": "Компьютер (приложение)", неизвестно: "До сбора устройств",
};
