import { fetchClientDoneSessions, markSessionDone } from "./bookings";
import { decrementMembershipRemaining, fetchClient } from "./clients";
import type { Membership } from "./clients";
import { today } from "./format";
import { updateDay } from "./plans";
import { fetchProgress, logSession } from "./progress";
import { notifyWorkoutFinished } from "./clientsBus";
import type { Day, Metric, Session } from "../types";

// Записи тренировок, сохранённые в попытке, которая потом сорвалась (например, на
// списании). Повтор «Завершить» не пишет запись второй раз — иначе в истории дубль.
// Ключ снимается после полного успеха, так что вторая тренировка того же дня в тот
// же день запишется как обычно.
const loggedPending = new Set<string>();

/**
 * Д3: единственное место, где завершается проведённая тренировка.
 *
 * До этого одна и та же последовательность — запись сессии, архивация дня,
 * отметка записи в календаре, двойной гард списания — была скопирована в три
 * места: PlanEditor, useSessionSlot и CalendarView. Ровно из-за такого
 * расползания в П12 остаток уходил дважды: в CalendarView гарда не было вовсе.
 * Четвёртая копия (для тренировки, поднятой на уровень приложения) сделала бы
 * расхождение неизбежным, поэтому логика сведена сюда.
 *
 * ПРАВИЛО СПИСАНИЯ НЕ МЕНЯЛОСЬ: при ошибке любой из проверок списание
 * пропускается. Недосписать безопаснее, чем списать дважды.
 */
export async function finishWorkout(opts: {
  trainerId: string;
  clientId: string;
  planId: string;
  day: Day;
  metrics: Omit<Metric, "id">[];
  note: string;
  session: Omit<Session, "id">;
  /** Абонемент, загруженный вызывающим, — только для ответа, если списания не было.
   *  Для самого списания всегда читаем свежий: этот мог устареть за время тренировки. */
  membership?: Membership | null;
}): Promise<{ membership: Membership | null; charged: boolean }> {
  const { trainerId, clientId, planId, day, metrics, note, session } = opts;

  const logKey = `${clientId}|${planId}|${day.id}|${session.date}`;
  if (!loggedPending.has(logKey)) {
    await logSession(planId, metrics, note, { ...session, dayId: day.id });
    loggedPending.add(logKey);
  }

  // П3: проведённый день уходит в «Проведённые» насовсем
  updateDay(day.id, { archivedAt: new Date().toISOString() })
    .catch((e) => console.error("[finishWorkout] архивация дня:", e));

  // Гард двойного списания, два источника:
  // 1) клиент уже залогировал эту сессию сам (fromClient);
  // 2) П12: запись в календаре за эту дату уже отмечена «проведена» —
  //    значит списание там уже произошло.
  let skip = false;
  try {
    const { sessions } = await fetchProgress(planId);
    skip = sessions.some((s) => s.dayName === session.dayName && s.date === session.date && s.fromClient);
  } catch (e) {
    console.error("[finishWorkout] проверка сессий:", e);
    skip = true;
  }
  if (!skip) {
    try {
      const done = await fetchClientDoneSessions(trainerId, clientId);
      skip = done.some((d) => d.date === session.date);
    } catch (e) {
      console.error("[finishWorkout] проверка календаря:", e);
      skip = true;
    }
  }

  // Списываем только от свежего абонемента: переданный загружен в начале тренировки,
  // и если за это время его продлили, запись «старый минус один» стёрла бы продление.
  let membership = opts.membership ?? null;
  if (!skip) {
    try { membership = (await fetchClient(clientId)).membership; }
    catch (e) { console.error("[finishWorkout] чтение абонемента:", e); skip = true; }
  }

  let charged = false;
  if (membership && !skip) {
    membership = await decrementMembershipRemaining(clientId, membership);
    charged = true;
  }

  // Отметка записи в календаре — только ПОСЛЕ гарда и списания. Раньше она шла
  // до проверки, и гард 2 видел свою же свежую отметку «проведена» — тренировка
  // не списывалась у записей с выбранным днём плана. Fire-and-forget.
  markSessionDone(trainerId, clientId, day.name, today());

  loggedPending.delete(logKey);
  notifyWorkoutFinished(planId);
  return { membership, charged };
}
