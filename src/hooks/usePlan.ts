import { useEffect, useRef, useState } from "react";
import * as api from "../lib/plans";
import { notify } from "../lib/dialog";
import { humanError } from "../lib/errors";
import { createSaveQueue, isTransient, withRetry, WAIT, type SaveStatus } from "../lib/saveQueue";
import type { Day, Exercise, Mesocycle, Plan, SetRow } from "../types";
import { onRevalidate, releaseStale, staleAtOf } from "../lib/offlineCache";
import { trackUnsaved } from "../lib/unsavedGuard";

// Сбой сети — «проверьте интернет»; отказ базы (права, связи) — про интернет не говорить
const failMsg = (what: string, e: unknown) => isTransient(e)
  ? `Не удалось ${what}. Проверь интернет и попробуй ещё раз.`
  : `Не удалось ${what}: сервер отклонил действие. Обнови план и попробуй ещё раз.`;

export function usePlan(planId: string) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Все записи редактора идут через одну очередь: настоящий статус, повторы, без перекрытий
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // База отказала (права, валидация, связи): правка выброшена — показать и перечитать план,
  // когда в очереди не останется ничего неотправленного (иначе перечитанный план затрёт на экране
  // правки, которые ещё уйдут). Сообщение — одно на серию отказов.
  const reloadPending = useRef(false);
  const fatalToastAt = useRef(0);
  const [q] = useState(() => createSaveQueue(setSaveStatus, async (_key, e) => {
    if (Date.now() - fatalToastAt.current > 10_000) {
      fatalToastAt.current = Date.now();
      notify((e as any)?.code === "42501"
        ? "Нет прав на это изменение — оно не сохранено. Загружаю план заново."
        : "Не удалось сохранить изменение: сервер его не принял. Загружаю план заново — проверь последние правки.");
    }
    if (reloadPending.current) return;
    reloadPending.current = true;
    while (mountedRef.current && (q.pending() || q.status() === "saving")) await new Promise((r) => setTimeout(r, 300));
    reloadPending.current = false;
    load();
  }));
  // temp-id → real-id map for optimistic exercise creation
  const tempIdMap = useRef<Map<string, string>>(new Map());
  const realId = (exId: string) => tempIdMap.current.get(exId) ?? exId;
  // real-id → temp-id: ключ строки на экране не меняется, когда упражнение получило настоящий id
  const tempKey = useRef<Map<string, string>>(new Map());
  // Упражнения, удалённые (или не созданные), пока шла вставка: temp-id
  const gone = useRef<Set<string>>(new Set());
  // Актуальный план для обработчиков из старых замыканий (строки упражнений мемоизированы)
  const planRef = useRef(plan);
  planRef.current = plan;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    // Обновление приложения не перезагрузит страницу, пока очередь не дошлёт правки (и после ухода с экрана)
    const untrack = trackUnsaved(q.active);
    return () => {
      untrack();
      mountedRef.current = false;
      // Ушли с экрана (вкладки, системный «назад»): отложенное — сразу, а если что-то не ушло — сказать
      q.flushAll();
      if (q.pending()) notify("Есть несохранённые изменения плана. Досылаю их в фоне — открой план позже и проверь.");
    };
  }, [q]);

  // Сеть вернулась — отправить упавшее. Приложение ушло в фон (на iPhone это часто конец
  // страницы) — отправить отложенное, не дожидаясь 400 мс простоя.
  useEffect(() => {
    const online = () => q.flushAll();
    const hide = () => { if (document.visibilityState === "hidden") q.flushAll(); };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("online", online); document.removeEventListener("visibilitychange", hide); };
  }, [q]);

  // Без сети план берётся с телефона (lib/offlineCache) — и тогда он только для просмотра:
  // очередь сохранений живёт в памяти и пропадает при закрытии приложения, а перестановки
  // шлют позиции всех строк по старой копии и затёрли бы правки с другого устройства.
  // offlineAt — время сохранённой копии; null — план свежий из сети.
  const [offlineAt, setOfflineAt] = useState<number | null>(null);
  const offlineRef = useRef(offlineAt);
  offlineRef.current = offlineAt;
  const lockedToastAt = useRef(0);
  const locked = () => {
    if (offlineRef.current === null) return false;
    if (Date.now() - lockedToastAt.current > 4000) {
      lockedToastAt.current = Date.now();
      notify("Нет сети: план открыт с телефона, только для просмотра. Править можно, когда появится интернет.");
    }
    return true;
  };
  const got = (p: Plan) => { setPlan(p); setOfflineAt(staleAtOf(`plan:${planId}`)); setLoading(false); };

  const load = () =>
    api.fetchPlanCached(planId)
      .then((p) => { if (!mountedRef.current) return; got(p); })
      .catch((e) => { if (!mountedRef.current) return; console.error("[usePlan] load:", e); setError(humanError(e, "Не удалось загрузить план")); setLoading(false); });

  useEffect(() => {
    if (!planId) { setPlan(null); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api.fetchPlanCached(planId)
      .then((p) => { if (alive) got(p); })
      .catch((e) => { if (alive) { console.error("[usePlan] load:", e); setError(humanError(e, "Не удалось загрузить план")); setLoading(false); } });
    return () => { alive = false; };
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Сеть вернулась, а на экране копия с телефона — перечитываем (правок в ней быть не могло)
  useEffect(() => {
    const off = onRevalidate(() => { if (offlineRef.current !== null) load(); });
    // Ушли с экрана — отметка «план из кэша» больше не про то, что на экране
    return () => { off(); releaseStale(`plan:${planId}`); };
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePlanMeta = (patch: Partial<Pick<Plan, "name" | "note" | "visibleToClient">>) => {
    if (locked()) return;
    setPlan((p) => (p ? { ...p, ...patch } : p));
    // Переключатель — сразу, текст — после 400 мс простоя
    q.enqueue("plan", "meta", patch, (pp) => api.updatePlanMeta(planId, pp), "visibleToClient" in patch ? 0 : 400);
  };

  // Порядок не откатываем при сбое: очередь повторит и отправит последний, а сбой виден в статусе
  const saveDayOrder = (days: Day[]) =>
    q.enqueue("days", "order", { rows: days.map((d, i) => ({ id: d.id, position: i })) }, (pp) => api.reorderDays(pp.rows), 0);
  const saveMesoOrder = (mesos: Mesocycle[]) =>
    q.enqueue("mesos", "order", { rows: mesos.map((m, i) => ({ id: m.id, position: i })) }, (pp) => api.reorderMesocycles(pp.rows), 0);

  const addDay = async (name: string) => {
    if (locked()) return;
    if (!plan || !name.trim()) return;
    // П2: новый день встаёт сверху. Самый свежий блок теперь тоже наверху,
    // то есть с наименьшей позицией — сортировка по возрастанию, не по убыванию.
    const sortedMesos = [...(plan.mesocycles ?? [])].sort((a, b) => a.position - b.position);
    const activeMeso = sortedMesos.find((m) => m.visibleToClient !== false) ?? null;
    const snapshot = plan.days;
    // Вставку сами не повторяем: при обрыве связи она могла пройти, и повтор задвоил бы день
    const row = await q.track(() => api.addDay(planId, name.trim(), 0, activeMeso?.id));
    const day: Day = {
      id: row.id, name: row.name, weekday: row.weekday, dateOf: null,
      exercises: [], visibleToClient: true, mesocycleId: activeMeso?.id ?? null, archivedAt: null,
    };
    const next = [day, ...snapshot];
    setPlan((p) => (p ? { ...p, days: next } : p));
    saveDayOrder(next);
  };

  const updateDay = (dayId: string, patch: Partial<Pick<Day, "name" | "weekday" | "dateOf" | "visibleToClient" | "mesocycleId" | "method" | "archivedAt">>) => {
    if (locked()) return;
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) } : p));
    // Переключатели пишем сразу, без дебаунса: пользователь может уйти с экрана раньше,
    // чем сработает отложенная запись, и «день проведён» потеряется.
    const now = "visibleToClient" in patch || "archivedAt" in patch;
    q.enqueue(`day:${dayId}`, "fields", patch, (pp) => api.updateDay(dayId, pp), now ? 0 : 400);
  };

  const deleteDay = async (dayId: string) => {
    if (locked()) return;
    const plan = planRef.current;
    if (!plan) return;
    const snapshot = plan.days;
    const exIds = (snapshot.find((d) => d.id === dayId)?.exercises ?? []).map((e) => realId(e.id));
    // Ещё создающиеся упражнения дня: после вставки не воскрешать
    const temps = exIds.filter((id) => id.startsWith("temp-"));
    temps.forEach((id) => gone.current.add(id));
    const keys = [`day:${dayId}`, `order:${dayId}`, ...exIds.filter((id) => !id.startsWith("temp-")).map((id) => `ex:${id}`)];
    setPlan((p) => (p ? { ...p, days: p.days.filter((d) => d.id !== dayId) } : p));
    try {
      // Пока удаляем, правки дня и его упражнений не уходят; запрос в полёте дожидаемся
      await q.track(async () => { await Promise.all(keys.map(q.pause)); await withRetry(() => api.deleteDay(dayId)); });
      keys.forEach(q.drop);
    } catch (e) {
      console.error("[usePlan] deleteDay:", e);
      keys.forEach(q.release);
      temps.forEach((id) => gone.current.delete(id));
      setPlan((p) => (p ? { ...p, days: snapshot } : p));
      notify(failMsg("удалить день", e));
    }
  };

  const reorderDays = async (from: number, to: number) => {
    if (locked()) return;
    if (!plan || from === to) return;
    const arr = [...plan.days];
    const [m] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(arr.length, to)), 0, m);
    setPlan((p) => (p ? { ...p, days: arr } : p));
    saveDayOrder(arr);
  };

  const addExercise = async (dayId: string, name = "") => {
    if (locked()) return;
    if (!plan) return;
    const day = plan.days.find((d) => d.id === dayId);
    if (!day) return;
    // Optimistic: показываем сразу с temp ID, потом заменяем на реальный
    const tempId = `temp-${crypto.randomUUID()}`;
    // П13: новое упражнение сразу в режиме «разные подходы» — тренер почти всегда
    // включал его вручную. Три пустые строки, как их делает toggleDetailed: без них
    // раскрытый вид был бы пустым. Существующие упражнения не трогаем.
    const setRows = Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), weight: "", reps: "" }));
    const blank: Exercise = {
      id: tempId, name, sets: "", reps: "", weight: "", rest: "",
      note: "", video: "", detailed: true, group: "",
      tempo: "", duration: "", target: "", kind: "", pulseZone: "", setRows,
    };
    setPlan((p) => (p ? { ...p, days: p.days.map((d) =>
      d.id === dayId ? { ...d, exercises: [...d.exercises, blank] } : d
    )} : p));
    let row: { id: string };
    try {
      row = await q.track(() => api.addExercise(dayId, day.exercises.length, name, true));
    } catch (e) {
      // Rollback optimistic add
      console.error("[usePlan] addExercise:", e);
      q.drop(`ex:${tempId}`);
      setPlan((p) => (p ? { ...p, days: p.days.map((d) =>
        d.id === dayId ? { ...d, exercises: d.exercises.filter((e) => e.id !== tempId) } : d
      )} : p));
      // Удалили сами, пока создавалось, — сообщать не о чем
      if (!gone.current.has(tempId)) notify(failMsg("добавить упражнение", e));
      gone.current.add(tempId);
      q.release(`order:${dayId}`);
      return;
    }
    tempIdMap.current.set(tempId, row.id);
    tempKey.current.set(row.id, tempId);
    if (gone.current.has(tempId)) {
      // Удалили, пока создавалось: убрать и из базы, иначе воскреснет при следующей загрузке
      q.release(`order:${dayId}`);
      try { await q.track(() => withRetry(() => api.deleteExercise(row.id))); }
      catch (e) {
        console.error("[usePlan] deleteExercise:", e);
        notify(failMsg("удалить упражнение", e));
        load();
      }
      return;
    }
    // Строки подходов пишем уже по реальному id — по временному они ушли бы в никуда.
    // Правки, сделанные, пока упражнение создавалось, переезжают поверх.
    q.enqueue(`ex:${row.id}`, "setRows", { r: setRows }, (pp) => api.setSetRows(row.id, pp.r as SetRow[]), 0);
    q.move(`ex:${tempId}`, `ex:${row.id}`);
    q.release(`order:${dayId}`);
    // Только id: правки, сделанные на временном id, остаются на экране
    setPlan((p) => (p ? { ...p, days: p.days.map((d) =>
      d.id === dayId ? { ...d, exercises: d.exercises.map((e) =>
        e.id === tempId ? { ...e, id: row.id } : e
      )} : d
    )} : p));
  };

  const updateExercise = (dayId: string, exId: string, patch: Partial<Exercise>) => {
    if (locked()) return;
    setPlan((p) =>
      p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: d.exercises.map((e) => (e.id === exId ? { ...e, ...patch } : e)) } : d)) } : p
    );
    // Подходы и поля упражнения — в одной очереди: запросы по одному упражнению не перекрываются.
    // Temp ID разрешаем в момент отправки; пока упражнение создаётся — правки ждут (WAIT) без повторов,
    // addExercise перенесёт их на настоящий id.
    const key = `ex:${realId(exId)}`;
    const send = (fn: (id: string) => Promise<void>) => {
      const id = realId(exId);
      return id.startsWith("temp-") ? Promise.reject(WAIT) : fn(id);
    };
    if ("setRows" in patch) q.enqueue(key, "setRows", { r: patch.setRows }, (pp) => send((id) => api.setSetRows(id, pp.r as SetRow[])));
    const rest = { ...patch } as Record<string, any>;
    delete rest.setRows;
    if (Object.keys(rest).length) q.enqueue(key, "fields", rest, (pp) => send((id) => api.updateExercise(id, pp)));
  };

  const deleteExercise = async (dayId: string, exId: string) => {
    if (locked()) return;
    const snapshot = planRef.current?.days.find((d) => d.id === dayId)?.exercises;
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: d.exercises.filter((e) => e.id !== exId) } : d)) } : p));
    const id = realId(exId);
    if (id.startsWith("temp-")) {
      // Ещё создаётся: удалит addExercise, когда придёт ответ на вставку
      gone.current.add(id);
      q.drop(`ex:${id}`);
      q.release(`order:${dayId}`);
      return;
    }
    const key = `ex:${id}`;
    try {
      // Пока удаляем, правки не уходят; запрос в полёте дожидаемся, иначе update прилетит после delete
      await q.track(async () => { await q.pause(key); await withRetry(() => api.deleteExercise(id)); });
      q.drop(key);
    } catch (e) {
      console.error("[usePlan] deleteExercise:", e);
      q.release(key);
      if (snapshot) setPlan((p) => (p ? { ...p, days: p.days.map((d) => d.id === dayId ? { ...d, exercises: snapshot } : d) } : p));
      notify(failMsg("удалить упражнение", e));
    }
  };

  // Порядок упражнений: temp-id меняем на настоящий в момент отправки; пока какое-то ещё создаётся — ждём
  const sendExOrder = (pp: Record<string, any>) => {
    const rows = (pp.rows as { id: string; position: number }[])
      .filter((r) => !gone.current.has(r.id))
      .map((r) => ({ ...r, id: realId(r.id) }));
    return rows.some((r) => r.id.startsWith("temp-")) ? Promise.reject(WAIT) : api.reorderExercises(rows);
  };

  const reorderExercises = async (dayId: string, from: number, to: number) => {
    if (locked()) return;
    // Из актуального плана, а не из замыкания: стрелки живут в мемоизированной строке
    const day = planRef.current?.days.find((d) => d.id === dayId);
    if (!day || from === to) return;
    const move = (list: Exercise[]) => {
      const arr = [...list];
      const [m] = arr.splice(from, 1);
      arr.splice(Math.max(0, Math.min(arr.length, to)), 0, m);
      return arr;
    };
    const arr = move(day.exercises);
    setPlan((p) => (p ? { ...p, days: p.days.map((d) => (d.id === dayId ? { ...d, exercises: move(d.exercises) } : d)) } : p));
    q.enqueue(`order:${dayId}`, "order", { rows: arr.map((e, i) => ({ id: e.id, position: i })) }, sendExOrder, 0);
  };

  // ── Мезоциклы ──
  /** Р1: перестановка блоков. Пишем позиции разом, как reorderDays. */
  const reorderMesocycles = async (from: number, to: number) => {
    if (locked()) return;
    if (!plan || from === to) return;
    const list = [...(plan.mesocycles ?? [])].sort((a, b) => a.position - b.position);
    const arr = [...list];
    const [m] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(arr.length, to)), 0, m);
    const next = arr.map((x, i) => ({ ...x, position: i }));
    setPlan((p) => (p ? { ...p, mesocycles: next } : p));
    saveMesoOrder(next);
  };

  const addMesocycle = async () => {
    if (locked()) return;
    if (!plan) return;
    // П2: новый блок сверху. Имя считаем от количества — позиция теперь всегда 0.
    const snapshot = plan.mesocycles ?? [];
    try {
      const meso = await q.track(() => api.addMesocycle(planId, 0, `Блок ${snapshot.length + 1}`));
      const next = [meso, ...snapshot].map((m, i) => ({ ...m, position: i }));
      setPlan((p) => (p ? { ...p, mesocycles: next } : p));
      saveMesoOrder(next);
    } catch (e) {
      console.error("[usePlan] addMesocycle:", e);
      notify("Не удалось добавить блок. Проверь интернет и попробуй ещё раз.");
    }
  };

  const updateMesocycle = (mesoId: string, patch: Partial<Pick<Mesocycle, "name" | "visibleToClient" | "archivedAt">>) => {
    if (locked()) return;
    setPlan((p) => (p ? { ...p, mesocycles: (p.mesocycles ?? []).map((m) => (m.id === mesoId ? { ...m, ...patch } : m)) } : p));
    // Переключатели пишем сразу, без дебаунса — как у дней
    const now = "visibleToClient" in patch || "archivedAt" in patch;
    q.enqueue(`meso:${mesoId}`, "fields", patch, (pp) => api.updateMesocycle(mesoId, pp), now ? 0 : 400);
  };

  const deleteMesocycle = async (mesoId: string) => {
    if (locked()) return;
    if (!plan) return;
    const snapMesos = plan.mesocycles ?? [];
    const snapDays = plan.days;
    setPlan((p) => (p ? { ...p, mesocycles: (p.mesocycles ?? []).filter((m) => m.id !== mesoId), days: p.days.map((d) => d.mesocycleId === mesoId ? { ...d, mesocycleId: null } : d) } : p));
    const key = `meso:${mesoId}`;
    try {
      await q.track(async () => { await q.pause(key); await withRetry(() => api.deleteMesocycle(mesoId)); });
      q.drop(key);
    } catch (e) {
      q.release(key);
      setPlan((p) => (p ? { ...p, mesocycles: snapMesos, days: snapDays } : p)); console.error("[usePlan] deleteMesocycle:", e);
      notify(failMsg("удалить блок", e));
    }
  };

  return {
    plan, loading, error, offlineAt, locked,
    saveStatus, retrySaves: q.retry, settleSaves: q.settle,
    updatePlanMeta, addDay, updateDay, deleteDay, reorderDays,
    addExercise, updateExercise, deleteExercise, reorderExercises,
    exKey: (id: string) => tempKey.current.get(id) ?? id,
    addMesocycle, updateMesocycle, deleteMesocycle, reorderMesocycles,
    reload: load,
  };
}
