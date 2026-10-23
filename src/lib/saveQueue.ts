import { isNetworkError } from "./outbox";

// Очередь сохранений редактора плана.
//
// 22.10 сохранения висели по 10–17 с и падали по таймауту базы, а ошибки уходили только
// в консоль: тренер видел «Сохранено» и терял правки. Теперь:
// - у каждой сущности (упражнение, день, план…) одна очередь: одновременно не больше
//   одного запроса, перекрывающиеся сохранения одной строки больше не ждут блокировок друг друга;
// - правки копятся в «слоте» и уходят последним значением — повтор не затрёт новое старым;
// - временные сбои (сеть, таймаут, 5xx) повторяются через 1, 3, 8 с, дальше — состояние «error»,
//   которое держится, пока не сохранится (повтор вручную или следующей правкой);
// - отказ базы (права, валидация, связи) не повторяется: правка выбрасывается, onFatal сообщает;
// - сущность можно придержать (hold): пока идёт удаление или упражнение ещё создаётся.

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";

/** run бросает WAIT, если отправлять пока рано (упражнение ещё создаётся): слот ждёт release, без повторов и ошибки */
export const WAIT = new Error("ждёт создания");

type Patch = Record<string, any>;
type Slot = { patch: Patch; run: (p: Patch) => Promise<void> };
type Entity = {
  slots: Map<string, Slot>; timer?: ReturnType<typeof setTimeout>; loop: Promise<void> | null;
  inflight: Promise<void> | null; failed: boolean; hold: boolean;
};

const RETRY_DELAYS = [1000, 3000, 8000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Временный сбой — имеет смысл повторить. Права, валидация, связи (4xx) — нет. */
export function isTransient(e: unknown) {
  if (isNetworkError(e)) return true;
  const code = String((e as any)?.code ?? "");
  // Шлюз (502/503/504) отвечает не JSON'ом — у такой ошибки кода нет
  if (!code) return true;
  // 57014 — отмена по statement_timeout, 55P03 — lock_timeout, 53 — нехватка ресурсов,
  // 08 — соединение, 40001/40P01 — конфликт транзакций, PGRST000–003 — пул соединений
  return /^(57|53|08|55P03|40001|40P01|XX)/.test(code) || /^PGRST00\d$/.test(code);
}

/** Разовая операция (удаление): те же повторы, что у очереди, без слотов. Только для идемпотентных. */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (!isTransient(e) || i >= RETRY_DELAYS.length) throw e;
      await sleep(RETRY_DELAYS[i]);
    }
  }
}

export function createSaveQueue(onChange: (s: SaveStatus) => void, onFatal: (key: string, e: unknown) => void) {
  const entities = new Map<string, Entity>();
  let ops = 0;          // разовые операции в полёте (добавить, удалить)
  let saved = false;    // было ли что-то сохранено — до первой правки индикатор не нужен
  let offline = false;  // последняя ошибка — из-за сети

  const status = (): SaveStatus => {
    let busy = ops > 0, failed = false;
    for (const e of entities.values()) {
      if (e.failed) failed = true;
      else if (e.slots.size || e.loop) busy = true;
    }
    if (failed) return offline ? "offline" : "error";
    // Сети нет — сразу так и сказать; повторы идут своим чередом
    if (busy && typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    if (busy) return "saving";
    return saved ? "saved" : "idle";
  };
  const emit = () => onChange(status());

  const entity = (key: string) => {
    let e = entities.get(key);
    if (!e) entities.set(key, (e = { slots: new Map(), loop: null, inflight: null, failed: false, hold: false }));
    return e;
  };

  const drain = async (ent: Entity, key: string) => {
    let attempt = 0;
    while (ent.slots.size && !ent.hold) {
      const [name, slot] = ent.slots.entries().next().value!;
      ent.slots.delete(name);
      try {
        await (ent.inflight = slot.run(slot.patch));
        ent.inflight = null;
        attempt = 0; saved = true; offline = false;
      } catch (e) {
        ent.inflight = null;
        if (entities.get(key) !== ent) return; // сущность удалена или переехала (drop/move)
        if (e !== WAIT && !isTransient(e)) {
          // Повтор не поможет: упавшую правку выбрасываем, новые уходят сами по себе
          console.error(`[saveQueue] ${key} ${name}: отклонено`, e);
          attempt = 0;
          saved = false; // не «Сохранено», пока не пройдёт успешная запись
          onFatal(key, e);
          continue;
        }
        // Несохранённое — обратно в слот. Если за время запроса пришла новая правка, она поверх.
        const newer = ent.slots.get(name);
        ent.slots.set(name, { patch: { ...slot.patch, ...newer?.patch }, run: newer?.run ?? slot.run });
        if (e === WAIT) { ent.hold = true; return; }
        offline = isNetworkError(e);
        if (attempt >= RETRY_DELAYS.length) { console.error(`[saveQueue] ${key} ${name}: не сохранилось после повторов`, e); ent.failed = true; return; }
        if (!attempt) console.warn(`[saveQueue] ${key} ${name}: сбой, повторяю`, e);
        emit();
        await sleep(RETRY_DELAYS[attempt++]);
        if (entities.get(key) !== ent) return; // за паузу сущность удалили или она переехала
      }
    }
  };

  const flush = (key: string) => {
    const ent = entities.get(key);
    // Нечего отправлять — цикл не запускаем, иначе статус на миг становится «saving»
    if (!ent || ent.loop || ent.hold || !ent.slots.size) return;
    clearTimeout(ent.timer);
    ent.failed = false;
    ent.loop = drain(ent, key).finally(() => { ent.loop = null; emit(); });
    emit();
  };

  /** Правка сущности. Слоты одной сущности уходят строго по одному; patch сливается с ещё не отправленным. */
  const enqueue = (key: string, name: string, patch: Patch, run: (p: Patch) => Promise<void>, delay = 400) => {
    const ent = entity(key);
    ent.slots.set(name, { patch: { ...ent.slots.get(name)?.patch, ...patch }, run });
    // Пока идёт запрос, новая правка просто ждёт в слоте — цикл заберёт её следующей
    if (!ent.loop && !ent.hold) { clearTimeout(ent.timer); ent.timer = setTimeout(() => flush(key), delay); }
    emit();
  };
  /** Убрать неотправленные правки (сущность удалена) */
  const drop = (key: string) => {
    const ent = entities.get(key);
    if (!ent) return;
    entities.delete(key);
    clearTimeout(ent.timer);
    ent.slots.clear();
    emit();
  };
  /** Снять удержание и отправить, что накопилось */
  const release = (key: string) => {
    const ent = entities.get(key);
    if (!ent) return;
    ent.hold = false;
    flush(key);
  };
  /** Отправить всё отложенное и упавшее прямо сейчас */
  const flushAll = () => { for (const key of entities.keys()) flush(key); };

  return {
    enqueue,
    flushAll,
    status,
    /** Есть неотправленное: правки в слотах (в т.ч. упавшие и придержанные) или запрос в полёте */
    pending: () => [...entities.values()].some((e) => e.slots.size > 0 || e.loop !== null),
    drop,
    release,
    /** Разовая операция: учитывается в «Сохраняю…» */
    async track<T>(fn: () => Promise<T>): Promise<T> {
      ops++; emit();
      try { const r = await fn(); saved = true; return r; }
      finally { ops--; emit(); }
    },
    /** Придержать сущность (идёт её удаление): новые запросы не уходят. Ждём только запрос в полёте,
     *  не паузу между повторами. Дальше — drop при успехе или release при неудаче. */
    async pause(key: string) {
      const ent = entity(key);
      ent.hold = true;
      clearTimeout(ent.timer);
      await ent.inflight?.catch(() => {});
    },
    /** Временный id стал настоящим: правки, сделанные по временному, — поверх уже поставленных */
    move(from: string, to: string) {
      const src = entities.get(from);
      if (!src) return;
      entities.delete(from);
      clearTimeout(src.timer);
      for (const [name, slot] of src.slots) enqueue(to, name, slot.patch, slot.run);
      src.slots.clear();
      emit();
    },
    /** Отправить всё и подождать до ms; вернуть, чем кончилось */
    async settle(ms: number): Promise<SaveStatus> {
      flushAll();
      for (const t0 = Date.now(); status() === "saving" && Date.now() - t0 < ms; ) await sleep(100);
      return status();
    },
  };
}
