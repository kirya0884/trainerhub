import { ask } from "./dialog";
import { isFlushing } from "./outbox";

// Перезагрузка страницы (обновление приложения, догрузка части после выкатки) не должна
// терять правки. Очередь сохранений плана живёт только в памяти — пока в ней что-то есть,
// перезагружать нельзя. Очередь досылки (outbox) лежит в localStorage и переживает
// перезагрузку; опасен только момент, когда запрос уже ушёл, а ответа ещё нет.

type Entry = { check: () => boolean; done: boolean };
const entries = new Set<Entry>();

/** Подключить источник несохранённого. dispose — источник ушёл с экрана; он ещё
 *  считается, пока не дошлёт своё (очередь плана досылает в фоне после закрытия). */
export function trackUnsaved(check: () => boolean) {
  const e: Entry = { check, done: false };
  entries.add(e);
  return () => { e.done = true; };
}

export function hasUnsaved() {
  let busy = isFlushing();
  for (const e of entries) {
    if (e.check()) busy = true;
    else if (e.done) entries.delete(e);
  }
  return busy;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Дождаться, пока всё сохранится, но не дольше ms (зависший запрос не держит вечно). true — сохранилось */
export async function whenSaved(ms = 45_000) {
  for (const t0 = Date.now(); hasUnsaved() && Date.now() - t0 < ms; ) await sleep(500);
  return !hasUnsaved();
}

/** Перед перезагрузкой по просьбе пользователя: подождать сохранения до ms, потом спросить.
 *  true — можно перезагружать (всё сохранилось или пользователь решил не ждать);
 *  false — ждали «после сохранения», но не дождались: обновление отложить. */
export async function beforeReload(ms = 5000): Promise<boolean> {
  for (const t0 = Date.now(); hasUnsaved() && Date.now() - t0 < ms; ) await sleep(300);
  if (!hasUnsaved()) return true;
  const now = await ask("Не все изменения успели сохраниться. Если обновить сейчас, они пропадут.", {
    ok: "Обновить сейчас", cancel: "После сохранения", danger: true,
  });
  return now || whenSaved();
}
