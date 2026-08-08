import { supabase } from "./supabase";

// B16: событийная аналитика. Таблица app_events append-only на уровне RLS —
// политик на UPDATE и DELETE нет вовсе, поэтому база их отклонит.
//
// ВАЖНО: в meta кладём только идентификаторы. Никаких имён, телефонов и сумм —
// связка «тренер открыл клиента» и так персональные данные, дублировать
// содержимое карточек в журнал событий не нужно.
export type AppEvent = "view" | "open_client" | "create" | "search" | "action";

// ponytail: fire-and-forget без очереди и батчинга. Событий у одного тренера
// десятки в день, отдельный insert дешевле любой машинерии.
// Логирование не имеет права ломать интерфейс, поэтому ошибки только в консоль.
export function logEvent(trainerId: string, event: AppEvent, target?: string, meta?: Record<string, string | number | boolean>) {
  if (!trainerId) return;
  supabase
    .from("app_events")
    .insert({ trainer_id: trainerId, event, target: target ?? null, meta: meta ?? {} })
    .then(({ error }) => { if (error) console.error("[logEvent]", error.message); });
}
