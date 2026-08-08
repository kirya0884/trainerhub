// B12: состояние вида (поиск, фильтры, прокрутка) переживает переключение вкладок.
// sessionStorage, а не localStorage: фильтр, доживший до следующего запуска приложения,
// выглядит как пропавшие данные. В рамках сессии — ровно то поведение, которого ждут.
export function loadViewState<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

export function saveViewState(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
}
