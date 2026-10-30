import { lazy, type ComponentType } from "react";
import { whenSaved } from "./unsavedGuard";

// Разделы грузятся по мере открытия: так первый запуск (особенно у клиента, которому
// не нужен код тренера) скачивает в разы меньше.
//
// После выкатки новой версии старые файлы частей исчезают с сервера. Открытая вкладка
// со старой версией при первом переходе в раздел получила бы ошибку загрузки — в этом
// случае один раз перезагружаем страницу (она возьмёт новую версию). Метка в
// sessionStorage не даёт уйти в бесконечную перезагрузку, если ошибка не из-за версии.
const KEY = "th-chunk-reload";

export function lazyRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() =>
    factory()
      .then((m) => { try { sessionStorage.removeItem(KEY); } catch { /* приватный режим */ } return m; })
      .catch((e) => {
        let reloaded = false;
        try { reloaded = sessionStorage.getItem(KEY) === "1"; sessionStorage.setItem(KEY, "1"); } catch { /* приватный режим */ }
        // Перезагрузка — когда очередь сохранений пуста (иначе пропадут правки плана), но не позже
        // потолка whenSaved: без перезагрузки раздел так и висел бы на загрузке
        if (!reloaded) { whenSaved().then(() => location.reload()); return new Promise<{ default: T }>(() => {}); }
        throw e;
      }),
  );
}
