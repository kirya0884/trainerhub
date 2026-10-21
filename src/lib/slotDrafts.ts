import { readJson, removeKey, writeJson } from "./storage";
import type { ExMeta, SetVal } from "../hooks/useSessionSlot";

// Черновик слота совместной тренировки: всё введённое, чтобы пережить перезагрузку,
// сворачивание и переключение «Рядом» ↔ «Вкладки» (там слоты монтируются заново).
// Отдельно от useSessionSlot: App пишет и чистит черновики сразу, не дожидаясь
// загрузки модуля совместной тренировки (без сети её могло не быть).
export type SlotDraft = {
  planId: string; dayId: string; vals: Record<string, SetVal[]>; meta: Record<string, ExMeta>;
  mood: number; wellbeing: number; review: string; clientRating: number; finished: boolean;
};
export const draftPrefix =(groupId: string, clientId: string) => `th-gslot-${groupId}-${clientId}`;
export const readSlotDraft = (groupId: string, clientId: string) => readJson<SlotDraft | null>(`${draftPrefix(groupId, clientId)}-vals`, null);
/** Черновик слота заранее — так одиночная тренировка переходит в совместную без потери отметок */
export const writeSlotDraft = (groupId: string, clientId: string, d: SlotDraft) => writeJson(`${draftPrefix(groupId, clientId)}-vals`, d);
export const clearSlotDrafts = (groupId: string, clientIds: string[]) => clientIds.forEach((id) => removeKey(`${draftPrefix(groupId, id)}-vals`));
