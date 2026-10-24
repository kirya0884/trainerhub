import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { onRevalidate } from "../lib/offlineCache";

const FOCUS_COOLDOWN = 10_000; // не чаще раза в 10 с при возврате в окно
const BURST = 250;             // склейка всплеска событий, как в Н3

/**
 * А4: общий список перечитывается, когда данные могли измениться в другом окне.
 *
 * Списки подопечных, записей и планов грузились один раз при входе. Сценарий
 * «планы на большом экране, календарь в соседнем окне» для тренера обычный —
 * и второе окно не узнавало об изменениях вовсе.
 *
 * Источники обновления:
 *  - возврат в окно (visibilitychange/focus) — самое дешёвое и самое действенное;
 *  - события репликации по таблицам;
 *  - вернулась сеть или на экране сохранённые данные — перечитываем (lib/offlineCache onRevalidate).
 *
 * ВАЖНО: перечитываются только общие СПИСКИ. Открытый редактор плана и режим
 * проведения тренировки держат своё состояние и сюда не подключены — иначе
 * обновление вырывало бы текст из-под пальцев.
 *
 * Это уменьшает окно, в котором два окна затирают правки друг друга, но не
 * закрывает его: честная защита — проверка версии строки при записи, это
 * отдельная задача с миграцией.
 *
 * filters — необязательный фильтр событий по таблице (`client_id=eq.<id>`): кабинету
 * клиента не нужны чужие события. Тренерские вызовы его не передают.
 */
export function useSharedListSync(enabled: boolean, tables: string[], reload: () => void, channelKey: string, filters: Record<string, string> = {}) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!enabled) return;
    let burst: number | undefined;
    let lastFocusAt = 0;

    const soon = () => {
      if (burst) clearTimeout(burst);
      burst = window.setTimeout(() => reloadRef.current(), BURST);
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFocusAt < FOCUS_COOLDOWN) return;
      lastFocusAt = now;
      reloadRef.current();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const offRevalidate = onRevalidate(soon);

    const channel = supabase.channel(channelKey);
    for (const table of tables) {
      const filter = filters[table];
      channel.on("postgres_changes", filter ? { event: "*", schema: "public", table, filter } : { event: "*", schema: "public", table }, soon);
    }
    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR") console.error(`[useSharedListSync] канал ${channelKey} не подключился`);
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      offRevalidate();
      if (burst) clearTimeout(burst);
      supabase.removeChannel(channel);
    };
  }, [enabled, channelKey, tables.join(","), JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
}
