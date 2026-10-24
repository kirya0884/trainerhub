// А3: одна система работы с локальным хранилищем.
//
// Правило простое и делит все случаи надвое:
//   ЧТЕНИЕ  — молчит и возвращает умолчание. Повреждённая запись не повод шуметь:
//             пользователю нечего с этим делать, а откат на умолчание корректен.
//   ЗАПИСЬ  — никогда не молчит. Раньше все записи были обёрнуты в catch {}, и сбой
//             (чаще всего переполнение квоты) проходил незамеченным: настройки
//             не сохранялись, а черновик проведения тренировки терялся вместе
//             с введёнными весами и повторами.

/** Чтение с откатом на умолчание. Молчит намеренно — см. комментарий выше. */
export function readJson<T>(key: string, fallback: T, store: Storage = localStorage): T {
  try {
    const raw = store.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/** Префикс кэша для зала (lib/offlineCache) — его всегда можно снова загрузить из сети */
export const CACHE_PREFIX = "th-cache:";

/**
 * Освободить место за счёт кэша для зала и выполнить write (бросает, если не влезло).
 * Удаляем по одной записи, начиная с самых крупных (главная, планы, истории). Роль и PIN
 * (access) и шапку (trainer) — последними: они маленькие, а без них приложение не откроется
 * без сети. true — write в итоге прошла.
 */
export function freeCacheSpace(write: () => void): boolean {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(CACHE_PREFIX)) keys.push(k); }
    const keep = (k: string) => /:(access|trainer)$/.test(k);
    const size = (k: string) => localStorage.getItem(k)?.length ?? 0;
    const order = [...keys.filter((k) => !keep(k)).sort((a, b) => size(b) - size(a)), ...keys.filter(keep)];
    for (const k of order) {
      localStorage.removeItem(k);
      try { write(); return true; } catch { /* мало — удаляем следующую */ }
    }
  } catch { /* ниже */ }
  return false;
}

// Хранилище забито до нуля: supabase-js при загрузке пробует записать, не может и больше не
// пользуется localStorage — вход забыт, открывается экран входа. Этот модуль загружается раньше
// supabase-js (lib/supabase импортирует его первым), поэтому место под сессию (~4 КБ с запасом)
// освобождаем здесь — за счёт кэша для зала.
{
  const probe = () => { localStorage.setItem("th-probe", "x".repeat(4096)); localStorage.removeItem("th-probe"); };
  try { probe(); } catch { freeCacheSpace(probe); }
}

/** Запись. Возвращает false при сбое — вызывающий решает, насколько это важно.
 *  Не влезло — жертвуем кэшем для зала: черновик тренировки и настройки важнее. */
export function writeJson(key: string, value: unknown, store: Storage = localStorage): boolean {
  const raw = JSON.stringify(value);
  try {
    store.setItem(key, raw);
    return true;
  } catch (e) {
    if (store === localStorage && !key.startsWith(CACHE_PREFIX) && freeCacheSpace(() => store.setItem(key, raw))) return true;
    console.error(`[storage] не удалось записать «${key}»:`, e);
    return false;
  }
}

export function removeKey(key: string, store: Storage = localStorage): void {
  try {
    store.removeItem(key);
  } catch (e) {
    console.error(`[storage] не удалось удалить «${key}»:`, e);
  }
}

/**
 * Уборка при старте — снимает саму причину переполнения.
 *
 * Черновик проведения тренировки лежит под th-tsess-<id дня> и чистится только при
 * завершении или явном «Прервать». Свернул экран и не вернулся — пара ключей осталась
 * навсегда. Свёртки плана копятся по ключу на план и хранят идентификаторы давно
 * удалённых дней. За месяцы это растёт и не убирается.
 */
const STAMP = "trainerhub-draft-stamps-v1";
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function touchDraft(prefix: string): void {
  const st = readJson<Record<string, number>>(STAMP, {});
  st[prefix] = Date.now();
  writeJson(STAMP, st);
}

export function cleanupStorage(): void {
  try {
    const st = readJson<Record<string, number>>(STAMP, {});
    const now = Date.now();
    let changed = false;

    // Черновики старше недели: тренировка либо давно завершена, либо брошена
    for (const [prefix, at] of Object.entries(st)) {
      if (now - at < WEEK) continue;
      removeKey(`${prefix}-vals`);
      removeKey(`${prefix}-meta`);
      delete st[prefix];
      changed = true;
    }

    // Черновики без отметки времени — остались от версий до этой уборки
    const orphan: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("th-tsess-")) continue;
      const prefix = k.replace(/-(vals|meta)$/, "");
      if (st[prefix] === undefined) orphan.push(prefix);
    }
    for (const prefix of new Set(orphan)) {
      st[prefix] = now; // дадим им неделю жизни, а не снесём вслепую
      changed = true;
    }

    if (changed) writeJson(STAMP, st);
  } catch (e) {
    // Уборка не имеет права ломать запуск приложения
    console.error("[storage] уборка:", e);
  }
}
