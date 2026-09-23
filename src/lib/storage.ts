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

/** Запись. Возвращает false при сбое — вызывающий решает, насколько это важно. */
export function writeJson(key: string, value: unknown, store: Storage = localStorage): boolean {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
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
