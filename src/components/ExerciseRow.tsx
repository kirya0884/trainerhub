import { Activity, ArrowDown, ArrowUp, GripVertical, Layers, Pencil, Plus, TrendingUp, Video, X } from "lucide-react";
import { memo, useState } from "react";
import type { Exercise, Metric } from "../types";
import type { LastFact } from "../lib/sessionUtils";
import NumField from "./NumField";
import { ask } from "../lib/dialog";

// Конвертирует ссылку YouTube в embed-форму; прочие ссылки (прямые .mp4 и т.п.) возвращает как есть.
function toEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtu\.be\/|[?&]v=|embed\/)([\w-]{11})/);
  return yt ? `https://www.youtube.com/embed/${yt[1]}` : url;
}

// Черновик текстового поля: ввод меняет своё состояние синхронно. Раньше поле обновлялось через
// startTransition, React до применения перехода откатывал его к старому значению — на Android-клавиатурах
// с композицией название превращалось в «ППрПри…», при быстром вводе терялись буквы.
// Значение снаружи (перезагрузка плана) подхватываем, только пока поле не в фокусе.
// active=false — поле убрано с экрана (Enter, свернули): blur при этом не приходит, фокус сбрасываем сами.
function useDraft(value: string, onValue: (v: string) => void, active = true) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  if (!active && focused) setFocused(false);
  if (!(focused && active) && draft !== value) setDraft(value);
  const set = (v: string) => { setDraft(v); onValue(v); };
  return {
    set,
    props: {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value),
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
}
type DraftProps = { value: string; onValue: (v: string) => void };
function DraftInput({ value, onValue, ...rest }: DraftProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onFocus" | "onBlur">) {
  return <input {...rest} {...useDraft(value, onValue).props} />;
}
function DraftNum({ value, onValue, ...rest }: DraftProps & { label: string; placeholder?: string }) {
  return <NumField {...rest} {...useDraft(value, onValue).props} />;
}
function ExerciseRow({
  ex, label, groupColor, suggestions, addToLibrary, canMoveUp, canMoveDown, onMoveUp, onMoveDown, cycleGroup, update, remove, lastMetric, lastFact,
  index, dragging, dropBefore, dropAfter, collapsed, onToggleCollapse, historyCount, onOpenHistory, readOnly,
}: {
  ex: Exercise; label: string; groupColor: string | null; suggestions: string[]; addToLibrary: (name: string) => void;
  canMoveUp: boolean; canMoveDown: boolean; onMoveUp: () => void; onMoveDown: () => void;
  index: number; dragging?: boolean; dropBefore?: boolean; dropAfter?: boolean;
  collapsed?: boolean; onToggleCollapse?: (id: string) => void;
  historyCount?: number; onOpenHistory?: (name: string) => void;
  /** План с телефона без сети — только просмотр: поле названия не забирает фокус */
  readOnly?: boolean;
  cycleGroup: () => void; update: (patch: Partial<Exercise>) => void; remove: () => void;
  lastMetric?: Metric; lastFact?: LastFact;
}) {
  const [acOpen, setAcOpen] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  // Новое упражнение (без названия) открыто, пока его не свернут вручную, — иначе
  // оно схлопнулось бы в строку на первой же набранной букве.
  const [forceOpen, setForceOpen] = useState(() => !ex.name.trim());
  // Название — текстом (нажатие сворачивает/раскрывает, как у дня); правка — по карандашу.
  // Новое упражнение без названия сразу в режиме правки.
  const [editingName, setEditingName] = useState(() => !ex.name.trim());
  // Поле названия есть на экране только в режиме правки и в раскрытой строке
  const nameShown = editingName && !(collapsed && !forceOpen && onToggleCollapse && ex.name.trim());
  const name = useDraft(ex.name, (v) => update({ name: v }), nameShown);
  const collapseNow = () => { setEditingName(false); if (forceOpen) setForceOpen(false); else onToggleCollapse?.(ex.id); };
  const q = ex.name.trim().toLowerCase();
  const matches = q ? suggestions.filter((n) => n.toLowerCase().includes(q)).sort((a, b) => (a.toLowerCase().startsWith(q) === b.toLowerCase().startsWith(q) ? 0 : a.toLowerCase().startsWith(q) ? -1 : 1)).slice(0, 8) : [];
  const exactExists = suggestions.some((n) => n.toLowerCase() === q);
  const toggleDetailed = () => {
    if (ex.detailed) { update({ detailed: false }); return; }
    let rows = ex.setRows.length ? ex.setRows : null;
    if (!rows) {
      const n = Math.max(1, Math.min(12, parseInt(ex.sets) || 3));
      rows = Array.from({ length: n }, () => ({ id: crypto.randomUUID(), weight: ex.weight || "", reps: ex.reps || "" }));
    }
    update({ detailed: true, setRows: rows });
  };
  const addSetRow = () => update({ setRows: [...ex.setRows, { id: crypto.randomUUID(), weight: "", reps: "" }] });
  const updateSetRow = (sid: string, patch: Partial<{ weight: string; reps: string }>) =>
    update({ setRows: ex.setRows.map((s) => (s.id === sid ? { ...s, ...patch } : s)) });
  const removeSetRow = (sid: string) => update({ setRows: ex.setRows.filter((s) => s.id !== sid) });
  const dragCls = `${dragging ? "opacity-40 ring-2 ring-lime-400" : ""} ${dropBefore ? "shadow-[0_-2px_0_0_var(--accent)]" : ""} ${dropAfter ? "shadow-[0_2px_0_0_var(--accent)]" : ""}`;
  const handle = (
    <button data-ds-handle type="button"
      title="Перетащить. С клавиатуры — стрелки вверх и вниз"
      aria-label="Перетащить упражнение. Стрелки вверх и вниз меняют порядок"
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" && canMoveUp) { e.preventDefault(); onMoveUp(); }
        if (e.key === "ArrowDown" && canMoveDown) { e.preventDefault(); onMoveDown(); }
      }}
      className="shrink-0 p-1.5 -ml-1 text-zinc-600 hover:text-zinc-300 cursor-grab active:cursor-grabbing touch-none select-none">
      <GripVertical size={16} />
    </button>
  );

  // Свёрнутое упражнение — одна строка «4 × 8 · 60 кг»; нажатие раскрывает редактирование.
  // Без названия всегда раскрыто: только что добавленное упражнение сразу готово к вводу.
  if (collapsed && !forceOpen && onToggleCollapse && ex.name.trim()) {
    const summary = ex.kind === "functional"
      ? [ex.duration, ex.weight].filter(Boolean).join(" · ")
      : ex.detailed
        ? `${ex.setRows.length} подх.${ex.setRows[0]?.weight ? ` · ${ex.setRows[0].weight}` : ""}`
        : [ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : ex.sets || ex.reps, ex.weight].filter(Boolean).join(" · ");
    return (
      <div data-ds-idx={index} className={`flex items-center gap-1 rounded-xl transition-shadow ${dragCls}`}>
        {handle}
        <button type="button" onClick={() => onToggleCollapse(ex.id)} aria-label={`${ex.name}: развернуть`}
          className="flex-1 min-w-0 flex items-center gap-2.5 py-2 pr-1.5 text-left rounded-xl hover:bg-zinc-800/50 transition">
          <span className="w-7 h-7 shrink-0 rounded-lg bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">{label}</span>
          <span className="flex-1 min-w-0 font-semibold truncate">{ex.name}</span>
          {summary && <span className="shrink-0 text-sm font-semibold text-zinc-400 whitespace-nowrap">{summary}</span>}
        </button>
        <button type="button" onClick={() => { setEditingName(true); onToggleCollapse(ex.id); }} title="Переименовать" aria-label={`Переименовать «${ex.name || "упражнение"}»`}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 transition"><Pencil size={14} /></button>
      </div>
    );
  }

  return (
    <div data-ds-idx={index}
      className={`bg-zinc-800/40 rounded-xl p-2.5 space-y-2 transition-shadow ${dragCls}`}
      style={groupColor ? { borderLeft: `3px solid ${groupColor}` } : undefined}>
      <div className="flex items-center gap-1">
        {handle}
        {editingName ? (
          <div className="relative flex-1 min-w-0">
            <input autoFocus={!readOnly} value={name.props.value} onChange={(e) => { name.set(e.target.value); setAcOpen(true); }} onFocus={() => { name.props.onFocus(); setAcOpen(true); }}
              onBlur={() => { name.props.onBlur(); setTimeout(() => { setAcOpen(false); if (ex.name.trim()) setEditingName(false); }, 150); }}
              onKeyDown={(e) => { if (e.key === "Enter" && ex.name.trim()) { setAcOpen(false); setEditingName(false); } }}
              placeholder="Название упражнения" aria-label="Название упражнения" className="w-full h-9 bg-zinc-800 rounded-xl px-2.5 text-sm font-medium outline-none focus:ring-1 focus:ring-lime-400/40" />
            {acOpen && q && !exactExists && (
              <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                {matches.map((n) => (<button key={n} onMouseDown={(e) => { e.preventDefault(); name.set(n); setAcOpen(false); }} className="w-full text-left text-sm px-3 py-2 hover:bg-zinc-800 text-zinc-200 transition">{n}</button>))}
                {matches.length === 0 && (<button onMouseDown={(e) => { e.preventDefault(); addToLibrary(ex.name.trim()); setAcOpen(false); }} className="w-full text-left text-sm px-3 py-2 hover:bg-zinc-800 text-lime-400 transition flex items-center gap-1.5"><Plus size={14} /> Добавить «{ex.name.trim()}» в библиотеку</button>)}
              </div>
            )}
          </div>
        ) : (
          <button type="button" onClick={onToggleCollapse ? collapseNow : undefined} title={onToggleCollapse ? "Свернуть упражнение" : undefined}
            aria-label={onToggleCollapse ? `${ex.name}: свернуть` : undefined}
            className="flex-1 min-w-0 py-1.5 pl-1 text-left rounded-lg font-semibold truncate">
            {ex.name}
          </button>
        )}
        {!editingName && <button type="button" onClick={() => setEditingName(true)} title="Переименовать" aria-label={`Переименовать «${ex.name || "упражнение"}»`}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 transition"><Pencil size={14} /></button>}
      </div>
      <div className="flex items-center gap-1 pl-7">
        <button onClick={cycleGroup} title="Суперсет: объединить упражнения в группу" className={`shrink-0 min-w-7 h-7 px-1 rounded-lg text-xs font-bold flex items-center justify-center transition ${ex.group ? "text-zinc-950" : "text-zinc-500 bg-zinc-800 hover:bg-zinc-700"}`} style={ex.group ? { background: groupColor ?? undefined } : undefined}>{label}</button>
        <button onClick={() => setShowVideo((v) => !v)} title="Видео-превью" className={`p-1.5 rounded-lg transition shrink-0 ${showVideo ? "text-lime-400 bg-lime-400/10" : ex.video ? "text-cyan-400 bg-cyan-400/10" : "text-zinc-500 hover:bg-zinc-700"}`}><Video size={15} /></button>
        <button onClick={() => update({ kind: ex.kind === "functional" ? "" : "functional" })} title="Функциональное упражнение (время/пульс вместо подходов)" className={`p-1.5 rounded-lg transition shrink-0 ${ex.kind === "functional" ? "text-orange-400 bg-orange-400/10" : "text-zinc-500 hover:bg-zinc-700"}`}><Activity size={15} /></button>
        {ex.kind !== "functional" && <button onClick={toggleDetailed} title="Разные подходы" className={`p-1.5 rounded-lg transition shrink-0 ${ex.detailed ? "text-lime-400 bg-lime-400/10" : "text-zinc-500 hover:bg-zinc-700"}`}><Layers size={15} /></button>}
        <span className="flex-1" />
        <button onClick={async () => { if (await ask(`Удалить упражнение «${ex.name || "без названия"}»? Подходы и комментарии удалятся вместе с ним.`, { danger: true, ok: "Удалить" })) remove(); }} title="Удалить упражнение" aria-label="Удалить упражнение" className="p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={15} /></button>
      </div>

      {/* П1: свёрнутое упражнение показывает только строку с названием и кнопками */}
      {(!collapsed || forceOpen || !onToggleCollapse) && (<>
        {showVideo && (
          <div className="pl-6 space-y-1.5">
            <DraftInput value={ex.video} onValue={(v) => update({ video: v })} placeholder="Ссылка на видео (YouTube или .mp4)" className="w-full bg-zinc-800 rounded-xl px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40" />
            {ex.video && (
              /\.(mp4|webm|ogg)$/i.test(ex.video) ? (
                <video src={ex.video} controls className="w-full max-h-56 rounded-xl bg-black" />
              ) : (
                <iframe src={toEmbedUrl(ex.video)} className="w-full aspect-video rounded-xl" allowFullScreen loading="lazy" title={ex.name || "Видео упражнения"} />
              )
            )}
          </div>
        )}
        {ex.kind === "functional" ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-6">
            <DraftNum label="Время выполнения" value={ex.duration} onValue={(v) => update({ duration: v })} placeholder="40 с / 2 мин" />
            <DraftNum label="Вес отягощения" value={ex.weight} onValue={(v) => update({ weight: v })} placeholder="16 кг" />
            <DraftNum label="Отдых" value={ex.rest} onValue={(v) => update({ rest: v })} placeholder="30 с" />
            <DraftNum label="Пульсовая зона" value={ex.pulseZone} onValue={(v) => update({ pulseZone: v })} placeholder="Z2 120-140" />
          </div>
        ) : ex.detailed ? (
          <div className="pl-6 space-y-1.5">
            {ex.setRows.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-5 text-center shrink-0 font-medium">{i + 1}</span>
                <DraftInput value={s.weight} inputMode="decimal" onValue={(v) => updateSetRow(s.id, { weight: v })} placeholder="вес" className="h-9 w-16 bg-zinc-800 rounded-lg px-1 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
                <span className="text-xs text-zinc-500">×</span>
                <DraftInput value={s.reps} inputMode="numeric" onValue={(v) => updateSetRow(s.id, { reps: v })} placeholder="повт" className="h-9 w-16 bg-zinc-800 rounded-lg px-1 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
                <button onClick={() => removeSetRow(s.id)} className="ml-auto p-1 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-600 transition" title="Удалить подход"><X size={13} /></button>
              </div>
            ))}
            <div className="flex items-center gap-3 mt-0.5">
              <button onClick={addSetRow} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-lime-400 transition"><Plus size={13} /> подход</button>
              <span className="text-xs text-zinc-500 ml-auto">Отдых</span>
              <DraftInput value={ex.rest} inputMode="decimal" onValue={(v) => update({ rest: v })} placeholder="90 с" className="w-16 bg-zinc-800 rounded-lg px-1.5 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-6">
            <DraftNum label="Подходы" value={ex.sets} onValue={(v) => update({ sets: v })} placeholder="4" />
            <DraftNum label="Повторы" value={ex.reps} onValue={(v) => update({ reps: v })} placeholder="8-12" />
            <DraftNum label="Вес" value={ex.weight} onValue={(v) => update({ weight: v })} placeholder="60 кг" />
            <DraftNum label="Отдых" value={ex.rest} onValue={(v) => update({ rest: v })} placeholder="90 с" />
          </div>
        )}
        <DraftInput value={ex.note} onValue={(v) => update({ note: v })} placeholder="Комментарий: техника, на что обратить внимание..." className="w-full bg-transparent text-xs text-zinc-400 px-1 py-0.5 pl-6 outline-none focus:text-zinc-200" />
        {/* П10: строка факта стала входом в историю — свободного места в шапке строки нет */}
        {/* План/факт: подходы последней тренировки; отличия от плана того дня — стрелкой */}
        {lastFact && (
          <button onClick={() => onOpenHistory?.(ex.name)} type="button" title="Факт последней тренировки — нажмите для всей истории"
            className="pl-6 flex items-start gap-1.5 text-[12px] w-full text-left hover:opacity-80 transition">
            <span className="text-zinc-500 shrink-0">Факт {lastFact.date.slice(8)}.{lastFact.date.slice(5, 7)}{lastFact.fromClient ? " · клиент сам" : ""}:</span>
            <span className="flex flex-wrap gap-x-2 gap-y-0.5 min-w-0">
              {lastFact.sets.map((s, i) => (
                <span key={i} className={`inline-flex items-center whitespace-nowrap ${s.dir === "up" ? "text-lime-400" : s.dir === "down" ? "text-orange-400" : s.dir === "extra" ? "text-cyan-400" : "text-zinc-400"}`}>
                  {s.weight || "—"}×{s.reps || "—"}
                  {s.dir === "up" && <ArrowUp size={11} aria-label="больше плана" />}
                  {s.dir === "down" && <ArrowDown size={11} aria-label="меньше плана" />}
                  {s.dir === "extra" && <Plus size={11} aria-label="сверх плана" />}
                </span>
              ))}
            </span>
            {(historyCount ?? 0) > 1 && <TrendingUp size={12} className="ml-auto shrink-0 mt-0.5 text-cyan-400/80" />}
          </button>
        )}
        {!lastFact && (lastMetric || (historyCount ?? 0) > 0) && (
          onOpenHistory ? (
            <button onClick={() => onOpenHistory(ex.name)} type="button"
              title="История упражнения: подходы по датам и график"
              className="pl-6 flex items-center gap-1.5 text-[11px] text-cyan-400/80 hover:text-cyan-300 transition w-full text-left">
              {lastMetric ? (
                <>
                  <span className="text-zinc-600">Факт {lastMetric.date.slice(5).replace("-", ".")}:</span>
                  {lastMetric.sets && <span>{lastMetric.sets}×{lastMetric.reps}</span>}
                  {lastMetric.weight && <span>· {lastMetric.weight}</span>}
                </>
              ) : <span className="text-zinc-600">История упражнения</span>}
              {(historyCount ?? 0) > 1 && <span className="text-zinc-600">· {historyCount} трен.</span>}
              <TrendingUp size={12} className="ml-auto shrink-0" />
            </button>
          ) : (
            <div className="pl-6 flex items-center gap-1.5 text-[11px] text-cyan-400/80">
              <span className="text-zinc-600">Факт {lastMetric!.date.slice(5).replace("-", ".")}:</span>
              {lastMetric!.sets && <span>{lastMetric!.sets}×{lastMetric!.reps}</span>}
              {lastMetric!.weight && <span>· {lastMetric!.weight}</span>}
            </div>
          )
        )}
      </>)}
    </div>
  );
}

export default memo(ExerciseRow, (prev, next) =>
  prev.ex === next.ex &&
  prev.label === next.label &&
  prev.canMoveUp === next.canMoveUp &&
  prev.canMoveDown === next.canMoveDown &&
  prev.dragging === next.dragging &&
  prev.dropBefore === next.dropBefore &&
  prev.dropAfter === next.dropAfter &&
  prev.collapsed === next.collapsed &&
  prev.onToggleCollapse === next.onToggleCollapse &&
  prev.historyCount === next.historyCount &&
  prev.onOpenHistory === next.onOpenHistory &&
  prev.readOnly === next.readOnly &&
  prev.index === next.index &&
  prev.lastMetric === next.lastMetric &&
  prev.lastFact === next.lastFact &&
  prev.groupColor === next.groupColor &&
  prev.suggestions === next.suggestions
);
