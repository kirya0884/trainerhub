import { Check, ChevronDown, ChevronUp, History, Layers, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { addDays, fmtDate, fmtSet, today } from "../lib/format";
import type { LastFact, LastTime } from "../lib/sessionUtils";
import { RPE_SCALE, doneSets, exKey, fmtRpe, isEmptyDay, isRepeatOf, tonnageOf } from "../lib/sessionUtils";
import { fetchProgress } from "../lib/progress";
import { ask, choose } from "../lib/dialog";
import { pending } from "../lib/outbox";
import type { Day, Exercise, Session } from "../types";

// Общие куски экранов проведения тренировки: у тренера (SessionModal), у клиента
// (ClientSessionView) и в группе (GroupSessionModal) — чтобы вели себя одинаково.

type SetVal = { weight: string; reps: string; rpe?: number };
export { doneSets, tonnageOf };
// Только то, что читает блок суперсета — у тренера и клиента состояние подхода чуть разное
type ExMeta = { note?: string; setsDone?: Record<number, boolean> };

/**
 * Дата проведения: «Сегодня» или другая — чтобы внести пропущенную тренировку задним
 * числом. null — сегодня (берётся в момент завершения, по местному времени).
 */
export function WorkoutDatePick({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const t = today();
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1">Дата тренировки</p>
      <div className="flex gap-1 p-1 bg-zinc-800/60 rounded-xl">
        {([[false, "Сегодня"], [true, "Другая дата"]] as const).map(([other, label]) => (
          <button key={label} type="button" onClick={() => onChange(other ? value ?? addDays(t, -1) : null)} aria-pressed={(value !== null) === other}
            className={`flex-1 h-8 rounded-lg text-sm font-semibold transition ${(value !== null) === other ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"}`}>
            {label}
          </button>
        ))}
      </div>
      {value !== null && (
        <input type="date" value={value} max={t} onChange={(e) => onChange(e.target.value)} aria-label="Дата тренировки"
          className="w-full h-10 mt-1.5 bg-zinc-800 rounded-xl px-3 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-lime-400/60" />
      )}
    </div>
  );
}

/** Дата для записи: выбранная или сегодняшняя; null — выбрана пустая или будущая */
export const resolveWorkoutDate = (v: string | null) => {
  const t = today();
  if (v === null) return t;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= t ? v : null;
};

/**
 * Вопросы перед записью тренировки у тренера. Каждая запись — списание из абонемента,
 * поэтому повтор того же дня за ту же дату переспрашиваем (в данных были дубли через
 * 8 минут и через 12 секунд), а пустой день пишем только без списания.
 * История читается заново (окно могло висеть свёрнутым, пока день провели на другом
 * устройстве); без сети — sessions, загруженная при открытии, плюс завершения, ждущие
 * в очереди отправки. Завершение без сети не держим.
 * false — тренер передумал, ничего не записываем.
 */
export async function confirmFinish(day: Day, date: string, planId: string | undefined, sessions: Session[] | null) {
  if (planId) {
    let list = sessions;
    try { list = (await fetchProgress(planId)).sessions; }
    catch (e) { console.error("[confirmFinish] история плана:", e); }
    const queued = pending(undefined, "finish").some((i) => {
      const p = i.payload as { planId?: string; day?: Day; session?: { date?: string } };
      return p.planId === planId && p.day?.id === day.id && p.session?.date === date;
    });
    if ((queued || (list && isRepeatOf(list, day, date))) &&!(await ask(`«${day.name}» уже проведена ${fmtDate(date)}. Записать ещё раз?`, { ok: "Записать" }))) return false;
  }
  if (isEmptyDay(day)) return ask("В дне нет упражнений — записать без списания? Чтобы списать за пропуск, отметь «Не пришёл» в календаре.", { ok: "Записать" });
  return true;
}

/**
 * Перед записью: есть упражнения, где подходы заполнены, но не отмечены (часто — тренировку
 * вносят задним числом или забыли отметить). В итог идут только отмеченные, поэтому спрашиваем.
 * «Отметить» — отмечаются только эти заполненные подходы; «как есть» — без изменений;
 * закрыли окно — null: завершение отменяется, человек возвращается к тренировке.
 */
export async function askUnmarked<M extends { done: boolean; setsDone?: Record<number, boolean> }>(
  day: Day, vals: Record<string, SetVal[]>, meta: Record<string, M>, client = false,
): Promise<Record<string, M> | null> {
  // У тренера «заполнен» — есть вес или повторы (нужно для внесения задним числом).
  // У клиента — только подход, который он менял сам: отличается от плана или стоит RPE;
  // нетронутые плановые подходы — не факт, о них не спрашиваем.
  const filled = (ex: Exercise, r: SetVal, i: number) => {
    if (!(r.weight || r.reps)) return false;
    if (!client) return true;
    const p = ex.detailed && ex.setRows?.length ? ex.setRows[i] : { weight: ex.weight, reps: ex.reps };
    return !!r.rpe || !p || r.weight !== (p.weight || "") || r.reps !== (p.reps || "");
  };
  const open = day.exercises
    .filter((ex) => ex.name && ex.kind !== "functional" && meta[ex.id] && !meta[ex.id].done)
    .map((ex) => ({ ex, idx: (vals[ex.id] ?? []).flatMap((r, i) => (filled(ex, r, i) && !meta[ex.id].setsDone?.[i] ? [i] : [])) }))
    .filter((x) => x.idx.length);
  if (!open.length) return meta;
  const n = open.length;
  const names = open.slice(0, 4).map((x) => `«${x.ex.name}»`).join(", ") + (n > 4 ? ` и ещё ${n - 4}` : "");
  // По умолчанию (фокус) — «как есть»: случайный Enter ничего не засчитывает
  const res = client
    ? await choose(`Не отмечены подходы: ${names}. Засчитать заполненные как сделанные?`,
      { ok: "Засчитать", alt: "Отправить как есть", cancel: "Вернуться к тренировке" })
    : await choose(`Есть неотмеченные подходы: ${names}. Отметить их как сделанные?`,
      { ok: "Отметить", alt: "Сохранить как есть", cancel: "Вернуться к тренировке" });
  if (res === null) return null;
  if (res === "alt") return meta;
  const next = { ...meta };
  for (const { ex, idx } of open) {
    const rows = vals[ex.id] ?? [];
    const sd = { ...(next[ex.id].setsDone ?? {}) };
    idx.forEach((i) => { sd[i] = true; });
    // Выполнено, если отмечены все непустые подходы
    next[ex.id] = { ...next[ex.id], setsDone: sd, done: rows.every((r, i) => sd[i] || !(r.weight || r.reps)) };
  }
  return next;
}

/**
 * RPE подхода — одна шкала по запасу повторов. Компактная ячейка 44×44: по тапу системный
 * список значений с подписями (на телефоне — крупный выбор). 9,5 — только у тренера.
 */
export function RpePick({ value, onChange, trainer, label }: { value?: number; onChange: (v: number) => void; trainer?: boolean; label: string }) {
  return (
    <span className="relative h-11 w-full min-w-0 rounded-lg bg-zinc-800 flex items-center justify-center font-semibold focus-within:ring-2 focus-within:ring-cyan-400/60">
      <span aria-hidden className={value ? "text-sm text-cyan-400" : "text-[11px] text-zinc-500"}>{value ? fmtRpe(value) : "RPE"}</span>
      <select value={value || ""} onChange={(e) => onChange(Number(e.target.value) || 0)} aria-label={label} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
        <option value="">Не указано</option>
        {RPE_SCALE.filter((o) => trainer || !o.trainerOnly).map((o) => <option key={o.v} value={o.v}>{fmtRpe(o.v)} — {o.label}</option>)}
      </select>
    </span>
  );
}

/**
 * Суперсет в проведении тренировки — подходы по очереди: 1-й подход первого
 * упражнения, 1-й второго, затем 2-й первого и т. д. Раньше каждое упражнение
 * показывало все свои подходы подряд, и порядок выполнения не читался.
 */
/** Колонки подходов: #, вес, повторы, RPE, отметка; с «было» — ещё колонка после # */
// Разбор путей 4.1: подход на ходу. «+ подход» — копия последнего (без RPE), «Убрать» — последний,
// если он не отмечен и не единственный. Меняется только эта тренировка, план — нет.
type SetMeta = { done: boolean; note: string; setsDone?: Record<number, boolean> };
export const addSetRow = (rows: SetVal[]): SetVal[] => [...rows, { weight: rows[rows.length - 1]?.weight ?? "", reps: rows[rows.length - 1]?.reps ?? "" }];
export const canRemoveSet = (rows: SetVal[], m?: SetMeta) => rows.length > 1 && !m?.setsDone?.[rows.length - 1];
export function metaAfterRemove<M extends SetMeta>(m: M, left: number): M {
  const sd = { ...(m.setsDone || {}) };
  delete sd[left];
  // Отмечено целиком кнопкой «Готово», без отметок подходов, — так и остаётся выполненным
  const wholeDone = m.done && !Object.values(m.setsDone || {}).some(Boolean);
  return { ...m, setsDone: sd, done: wholeDone || Array.from({ length: left }, (_, k) => k).every((k) => sd[k]) };
}
export function SetCountRow({ onAdd, onRemove }: { onAdd: () => void; onRemove?: () => void }) {
  return (
    <div className="flex gap-1.5 pt-0.5">
      <button onClick={onAdd} className="flex-1 h-10 rounded-lg bg-zinc-800/60 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 transition flex items-center justify-center gap-1.5"><Plus size={15} /> Подход</button>
      {onRemove && <button onClick={onRemove} aria-label="Убрать последний подход" className="h-10 px-3 rounded-lg bg-zinc-800/60 text-sm text-zinc-400 hover:bg-zinc-800 transition flex items-center justify-center gap-1.5"><Minus size={15} /> Убрать</button>}
    </div>
  );
}

export const SET_COLS = "grid-cols-[1.25rem_1fr_1fr_2.75rem_3rem]";
export const PREV_COLS = "grid-cols-[1.25rem_3.25rem_1fr_1fr_2.75rem_3rem]";
/** «было»: вес×повторы этого подхода в прошлый раз (или прочерк, если подходов тогда было меньше) */
export function PrevCell({ p }: { p?: { weight: string; reps: string; dir?: string } }) {
  return <span className="text-[12px] text-zinc-500 text-center truncate" title="В прошлый раз">{p && p.dir !== "skip" ? fmtSet(p.weight, p.reps) : "—"}</span>;
}

// Суперсет: на узком экране (до 640 px) название — отдельной строкой во всю ширину, под ним
// вес/повторы/RPE/отметка; шире — всё в одну строку. Иначе на 320 px названию оставалось ~40 px.
const SUPERSET_COLS = "grid-cols-[1fr_1fr_2.75rem_3rem] sm:grid-cols-[1fr_3.5rem_3.5rem_2.75rem_3rem]";

export function SupersetRounds({ title, color, items, labels, vals, meta, onSetVal, onTapSet, onNote, prev = {}, trainer }: {
  title: string; color: string; items: Exercise[]; labels: string[]; prev?: Record<string, LastFact>;
  vals: Record<string, SetVal[]>; meta: Record<string, ExMeta | undefined>;
  onSetVal: (exId: string, i: number, patch: Partial<SetVal>) => void;
  onTapSet: (ex: Exercise, i: number, total: number) => void;
  onNote: (exId: string, note: string) => void;
  trainer?: boolean;
}) {
  const named = items.filter((ex) => ex.name);
  const rounds = Math.max(0, ...named.map((ex) => (vals[ex.id] || []).length));
  // Текущий подход — первый, где есть неотмеченное
  const current = Array.from({ length: rounds }, (_, r) => r)
    .find((r) => named.some((ex) => r < (vals[ex.id] || []).length && !meta[ex.id]?.setsDone?.[r]));
  const tonnage = named.reduce((s, ex) => s + (ex.kind === "functional" ? 0 : tonnageOf(doneSets(vals[ex.id] || [], meta[ex.id]))), 0);
  // Двусет можно свернуть, как одиночное упражнение после «Готово»: занимает экран, а уже
  // сделан или отложен. Все подходы отмечены — сворачивается сам, тап разворачивает.
  const totalSets = named.reduce((n, ex) => n + (vals[ex.id] || []).length, 0);
  const doneCount = named.reduce((n, ex) => n + (vals[ex.id] || []).filter((_, i) => meta[ex.id]?.setsDone?.[i]).length, 0);
  const allDone = totalSets > 0 && doneCount === totalSets;
  const [collapsed, setCollapsed] = useState(allDone);
  useEffect(() => { if (allDone) setCollapsed(true); }, [allDone]);
  const kg = tonnage > 0 ? `${Math.round(tonnage).toLocaleString("ru-RU")} кг` : "";

  if (collapsed) return (
    <button onClick={() => setCollapsed(false)} aria-expanded={false} aria-label={`${title}: развернуть`}
      className="w-full rounded-2xl bg-zinc-900 border border-zinc-800 pl-4 pr-3 py-2.5 flex items-center gap-2.5 text-left hover:border-zinc-700 transition" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color }}><Layers size={13} /> {title}{allDone && <Check size={13} strokeWidth={3} className="text-lime-400" />}</span>
        <span className="block text-sm font-semibold truncate mt-0.5">{named.map((ex) => ex.name).join(" · ")}</span>
        <span className="block text-xs text-zinc-500">{doneCount} из {totalSets} подходов{kg ? ` · ${kg}` : ""}</span>
      </span>
      <ChevronDown size={18} className="text-zinc-500 shrink-0" />
    </button>
  );

  return (
    <div className="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
      <div className="pl-4 pr-1.5 pt-1.5 pb-1">
        <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color }}>
          <Layers size={13} /> {title}
          {kg && <span className="ml-auto text-zinc-400 font-semibold">{kg}</span>}
          <button onClick={() => setCollapsed(true)} aria-expanded aria-label={`${title}: свернуть`} title="Свернуть"
            className={`${kg ? "" : "ml-auto"} h-9 px-2 flex items-center gap-1 rounded-lg text-zinc-400 font-semibold hover:bg-zinc-800 hover:text-zinc-100 transition`}><ChevronUp size={15} /> Свернуть</button>
        </div>
        <p className="text-sm font-semibold mt-1 leading-snug">
          {named.map((ex, k) => <span key={ex.id}>{k > 0 && <span className="text-zinc-600"> · </span>}<span style={{ color }}>{labels[items.indexOf(ex)]}</span> {ex.name}</span>)}
        </p>
      </div>

      {Array.from({ length: rounds }, (_, r) => (
        <div key={r} className={`pl-4 pr-3 py-2 border-t border-zinc-800 ${r === current ? "bg-lime-400/5" : ""}`}>
          <div className={`grid ${SUPERSET_COLS} gap-1.5 items-center text-[11px] text-zinc-500 mb-1`}>
            <span className={`col-span-4 sm:col-span-1 font-semibold ${r === current ? "text-lime-400" : ""}`}>Подход {r + 1}</span>
            <span className="text-center">Кг</span><span className="text-center">Повт.</span><span className="text-center">RPE</span><span />
          </div>
          <div className="space-y-1.5">
            {named.map((ex) => {
              const rows = vals[ex.id] || [];
              if (r >= rows.length) return null;
              const row = rows[r];
              const md = meta[ex.id];
              const isDone = md?.setsDone?.[r] ?? false;
              const was = prev[exKey(ex.name)]?.sets[r];
              return (
                <div key={ex.id}>
                  <div className={`grid ${SUPERSET_COLS} gap-1.5 items-center`}>
                    <span className={`col-span-4 sm:col-span-1 min-w-0 truncate text-sm font-medium ${isDone ? "text-zinc-500" : ""}`}>
                      <span className="font-bold mr-1" style={{ color }}>{labels[items.indexOf(ex)]}</span>{ex.name}
                      {was && was.dir !== "skip" && <span className="block text-[11px] text-zinc-500 font-normal">было {fmtSet(was.weight, was.reps)}</span>}
                    </span>
                    {ex.kind === "functional" ? (
                      <span className="col-span-3 text-xs text-zinc-400 text-center truncate">{[ex.duration, ex.weight].filter(Boolean).join(" · ") || "функц."}</span>
                    ) : (
                      <>
                        <input value={row.weight} onChange={(e) => onSetVal(ex.id, r, { weight: e.target.value })} inputMode="decimal" placeholder="кг" aria-label={`${ex.name}, подход ${r + 1}: вес`}
                          className={`h-12 w-full min-w-0 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                        <input value={row.reps} onChange={(e) => onSetVal(ex.id, r, { reps: e.target.value })} inputMode="numeric" placeholder="повт" aria-label={`${ex.name}, подход ${r + 1}: повторы`}
                          className={`h-12 w-full min-w-0 bg-zinc-800 rounded-lg px-1 font-semibold text-center outline-none focus:ring-2 focus:ring-lime-400/60 ${isDone ? "text-zinc-400" : ""}`} />
                        <RpePick value={row.rpe} onChange={(v) => onSetVal(ex.id, r, { rpe: v })} trainer={trainer} label={`${ex.name}, подход ${r + 1}: RPE`} />
                      </>
                    )}
                    <button onClick={() => onTapSet(ex, r, rows.length)} aria-pressed={isDone} aria-label={isDone ? `${ex.name}: снять отметку с подхода ${r + 1}` : `${ex.name}: подход ${r + 1} выполнен`}
                      className={`h-12 w-12 rounded-xl flex items-center justify-center transition active:scale-95 ${isDone ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>
                      <Check size={20} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="pl-4 pr-3 py-2 border-t border-zinc-800 space-y-1.5">
        {named.map((ex) => (
          <input key={ex.id} value={meta[ex.id]?.note || ""} onChange={(e) => onNote(ex.id, e.target.value)} placeholder={`Примечание: ${ex.name}`}
            className="w-full bg-zinc-800/60 rounded-lg px-3 h-9 outline-none focus:ring-2 focus:ring-lime-400/40" />
        ))}
      </div>
    </div>
  );
}

/** «Как в прошлый раз»: подставить вес и повторы с последнего проведения этого дня.
 *  После подстановки — «Вернуть план». Нет прошлого раза — ничего не показываем. */
export function LastTimeBar({ last, applied, onApply, onUndo }: { last: LastTime | null; applied: boolean; onApply: () => void; onUndo: () => void }) {
  if (!last) return null;
  return applied ? (
    <div className="flex items-center gap-2 rounded-xl bg-lime-400/10 border border-lime-400/25 pl-3 pr-1 h-11 text-sm">
      <Check size={16} className="text-lime-400 shrink-0" />
      <span className="flex-1 min-w-0 truncate">Веса как {fmtDate(last.date, true)}</span>
      <button onClick={onUndo} className="h-9 px-3 rounded-lg font-semibold text-zinc-300 hover:bg-zinc-800 transition shrink-0">Вернуть план</button>
    </div>
  ) : (
    <button onClick={onApply} className="w-full flex items-center gap-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 px-3 h-11 text-sm font-semibold transition">
      <History size={16} className="text-lime-400 shrink-0" />
      <span className="flex-1 text-left truncate">Как в прошлый раз · {fmtDate(last.date, true)}</span>
      <span className="text-[13px] font-medium text-zinc-500 shrink-0">подставить веса</span>
    </button>
  );
}
