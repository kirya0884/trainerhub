import { fetchClientDoneSessions, markSessionDone } from "./bookings";
import { combinedRemaining, decrementMembershipRemaining, fetchClient } from "./clients";
import { enqueue, isNetworkError, registerHandler } from "./outbox";
import { notify } from "./dialog";
import type { Membership } from "./clients";
import { fetchProgress, logSession } from "./progress";
import { isEmptyDay } from "./sessionUtils";
import { notifyWorkoutFinished } from "./clientsBus";
import type { Day, Metric, Session } from "../types";
import { track } from "./events";

// Ключ от повторов записи (id сессии для log_workout) у попытки, которая сорвалась
// (например, на списании). Повтор «Завершить» идёт с тем же id — сервер второй раз не
// запишет. Снимается после полного успеха или когда завершение ушло в очередь (там свой
// ключ в FinishState), так что вторая тренировка того же дня запишется как обычно.
const pendingIds = new Map<string, string>();
const logKeyOf = (o: { clientId: string; planId: string; day: Day; session: Omit<Session, "id"> }) =>
  `${o.clientId}|${o.planId}|${o.day.id}|${o.session.date}`;

/** Какие шаги уже сделаны — хранится в очереди отправки, чтобы повтор их не повторял.
 *  sessionId — ключ от повторов записи; у записей из очереди версии до 31.10 его нет. */
export interface FinishState { logged?: boolean; charge?: "skip" | "done" | { before: number }; sessionId?: string }

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
  /** Повтор из очереди отправки — перед записью проверяем, не записана ли уже */
  retry?: boolean;
}, st: FinishState = {}, save: (s: FinishState) => void = () => {}): Promise<{ membership: Membership | null; charged: boolean }> {
  const { trainerId, clientId, planId, day, metrics, note, session } = opts;
  const put = (patch: FinishState) => { st = { ...st, ...patch }; save(st); };

  if (!st.logged) {
    // Повтор из очереди прежней версии (без ключа): прошлая попытка могла записать
    // тренировку, а ответ не дошёл. Тогда проверяем по истории, как раньше.
    // С ключом повтор отсекает сервер (log_workout).
    const already = opts.retry && !st.sessionId && (await fetchProgress(planId)).sessions.some((s) =>
      s.dayId === day.id && s.date === session.date && !s.fromClient && s.done === session.done && s.total === session.total);
    const sessionId = st.sessionId ?? crypto.randomUUID();
    // Ключ сохраняем ДО отправки: оборвётся — очередь или повтор «Завершить» пойдут с тем же
    if (!st.sessionId) put({ sessionId });
    if (!already) await logSession(planId, metrics, note, { ...session, dayId: day.id }, sessionId);
    put({ logged: true });
  }

  // День больше не уходит в «Проведённые»: он остаётся в плане, а отметку
  // «проведена <дата>» редактор берёт из истории тренировок.

  // Ошибка сети на проверках — не повод молча не списать: пробрасываем, и завершение
  // встанет в очередь отправки. Прочие ошибки — как раньше: недосписать безопаснее.
  const guard = (e: unknown, where: string) => { if (isNetworkError(e)) throw e; console.error(`[finishWorkout] ${where}:`, e); return true; };

  let membership = opts.membership ?? null;
  let charged = false;
  // Пустой день (ни одного упражнения) пишем без списания — тренер подтвердил это при
  // завершении. Шаг сохраняется в очередь отправки вместе с остальными.
  if (!st.charge && isEmptyDay(day)) put({ charge: "skip" });
  if (st.charge !== "skip" && st.charge !== "done") {
    // Гард двойного списания, два источника:
    // 1) клиент уже залогировал эту сессию сам (fromClient);
    // 2) П12: запись в календаре за эту дату уже отмечена «проведена» —
    //    значит списание там уже произошло.
    let skip = false;
    try {
      const { sessions } = await fetchProgress(planId);
      skip = sessions.some((s) => s.dayName === session.dayName && s.date === session.date && s.fromClient);
    } catch (e) { skip = guard(e, "проверка сессий"); }
    if (!skip) {
      try {
        const done = await fetchClientDoneSessions(trainerId, clientId);
        skip = done.some((d) => d.date === session.date);
      } catch (e) { skip = guard(e, "проверка календаря"); }
    }
    // Списываем только от свежего абонемента: переданный загружен в начале тренировки,
    // и если за это время его продлили, запись «старый минус один» стёрла бы продление.
    let fresh: Membership | null = null;
    if (!skip) {
      try { fresh = (await fetchClient(clientId)).membership; }
      catch (e) { skip = guard(e, "чтение абонемента"); }
    }
    if (skip || !fresh) put({ charge: "skip" });
    else {
      membership = fresh;
      const now = combinedRemaining(fresh);
      // Повтор после оборванного списания: остаток уже не тот, что был перед ним, —
      // значит, списание прошло (или абонемент меняли). Не списываем второй раз.
      if (typeof st.charge === "object" && now !== st.charge.before) put({ charge: "done" });
      else {
        put({ charge: { before: now } });
        membership = await decrementMembershipRemaining(clientId, fresh, { kind: "workout", date: session.date });
        charged = true;
        put({ charge: "done" });
      }
    }
  }

  // Отметка записи в календаре — только ПОСЛЕ гарда и списания. Раньше она шла
  // до проверки, и гард 2 видел свою же свежую отметку «проведена» — тренировка
  // не списывалась у записей с выбранным днём плана. Fire-and-forget.
  // Дата — тренировки, а не сегодняшняя: из очереди её могут дослать на следующий день.
  // Ждём её (ошибки она глотает сама) — иначе календарь перечитывается по сигналу ниже
  // раньше, чем запись стала «проведена», и показывает старый статус.
  // Пустой день запись не закрывает: иначе у неё пропадёт «Не пришёл» со списанием,
  // а гард выше не спишет настоящую тренировку в ту же дату.
  if (!isEmptyDay(day)) await markSessionDone(trainerId, clientId, day.name, session.date);

  notifyWorkoutFinished(planId);
  return { membership, charged };
}

type FinishOpts = Parameters<typeof finishWorkout>[0];

/**
 * Завершить сейчас, а если пропала сеть — положить в очередь отправки с уже сделанными
 * шагами. Тренер закрывает тренировку как обычно; очередь дошлёт её сама.
 */
export async function finishOrQueue(opts: FinishOpts): Promise<{ membership: Membership | null; charged: boolean; queued: boolean }> {
  const key = logKeyOf(opts);
  const prevId = pendingIds.get(key);
  let st: FinishState = prevId ? { sessionId: prevId } : {};
  try {
    const r = await finishWorkout(opts, st, (s) => { st = s; if (s.sessionId) pendingIds.set(key, s.sessionId); });
    pendingIds.delete(key);
    track("action", "workout_finish", { queued: false, charged: r.charged });
    return { ...r, queued: false };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    pendingIds.delete(key);
    await enqueue("finish", opts, st);
    track("action", "workout_finish", { queued: true });
    notify("Нет интернета — тренировка сохранена на телефоне и отправится сама, как только появится сеть.", "info");
    return { membership: opts.membership ?? null, charged: false, queued: true };
  }
}

registerHandler("finish", async (item, save) => {
  await finishWorkout({ ...(item.payload as FinishOpts), retry: true }, item.state as FinishState, save);
});
