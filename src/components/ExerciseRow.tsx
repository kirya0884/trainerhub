import { Activity, ChevronDown, ChevronUp, Layers, Plus, Video, X } from "lucide-react";
import { memo, startTransition, useState } from "react";
import type { Exercise, Metric } from "../types";
import NumField from "./NumField";

// Конвертирует ссылку YouTube в embed-форму; прочие ссылки (прямые .mp4 и т.п.) возвращает как есть.
function toEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtu\.be\/|[?&]v=|embed\/)([\w-]{11})/);
  return yt ? `https://www.youtube.com/embed/${yt[1]}` : url;
}
function ExerciseRow({
  ex, label, groupColor, suggestions, addToLibrary, canMoveUp, canMoveDown, onMoveUp, onMoveDown, cycleGroup, update, remove, lastMetric,
}: {
  ex: Exercise; label: string; groupColor: string | null; suggestions: string[]; addToLibrary: (name: string) => void;
  canMoveUp: boolean; canMoveDown: boolean; onMoveUp: () => void; onMoveDown: () => void;
  cycleGroup: () => void; update: (patch: Partial<Exercise>) => void; remove: () => void;
  lastMetric?: Metric;
}) {
  const [acOpen, setAcOpen] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
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

  return (
    <div className="bg-zinc-800/40 rounded-lg p-2.5 space-y-2" style={groupColor ? { borderLeft: `3px solid ${groupColor}` } : undefined}>
      <div className="flex items-center gap-1">
        <span className="hidden sm:flex flex-col shrink-0">
          <button onClick={onMoveUp} disabled={!canMoveUp} className="p-1.5 -my-0.5 text-zinc-600 hover:text-zinc-300 disabled:opacity-30 disabled:hover:text-zinc-600" title="Выше"><ChevronUp size={16} /></button>
          <button onClick={onMoveDown} disabled={!canMoveDown} className="p-1.5 -my-0.5 text-zinc-600 hover:text-zinc-300 disabled:opacity-30 disabled:hover:text-zinc-600" title="Ниже"><ChevronDown size={16} /></button>
        </span>
        <button onClick={cycleGroup} title="Суперсет: объединить упражнения в группу" className={`shrink-0 min-w-7 h-7 px-1 rounded-md text-xs font-bold flex items-center justify-center transition ${ex.group ? "text-zinc-950" : "text-zinc-500 bg-zinc-800 hover:bg-zinc-700"}`} style={ex.group ? { background: groupColor ?? undefined } : undefined}>{label}</button>
        <div className="relative flex-1 min-w-0">
          <input value={ex.name} onChange={(e) => { const v = e.target.value; startTransition(() => update({ name: v })); setAcOpen(true); }} onFocus={() => setAcOpen(true)} onBlur={() => setTimeout(() => setAcOpen(false), 150)} placeholder="Название упражнения" className="w-full bg-zinc-800 rounded-md px-2.5 py-1.5 text-sm font-medium outline-none focus:ring-1 focus:ring-lime-400/40" />
          {acOpen && q && !exactExists && (
            <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto">
              {matches.map((n) => (<button key={n} onMouseDown={(e) => { e.preventDefault(); update({ name: n }); setAcOpen(false); }} className="w-full text-left text-sm px-3 py-2 hover:bg-zinc-800 text-zinc-200 transition">{n}</button>))}
              {matches.length === 0 && (<button onMouseDown={(e) => { e.preventDefault(); addToLibrary(ex.name.trim()); setAcOpen(false); }} className="w-full text-left text-sm px-3 py-2 hover:bg-zinc-800 text-lime-400 transition flex items-center gap-1.5"><Plus size={14} /> Добавить «{ex.name.trim()}» в библиотеку</button>)}
            </div>
          )}
        </div>
        <button onClick={() => setShowVideo((v) => !v)} title="Видео-превью" className={`p-1.5 rounded-md transition shrink-0 ${showVideo ? "text-lime-400 bg-lime-400/10" : ex.video ? "text-cyan-400 bg-cyan-400/10" : "text-zinc-500 hover:bg-zinc-700"}`}><Video size={15} /></button>
        <button onClick={() => update({ kind: ex.kind === "functional" ? "" : "functional" })} title="Функциональное упражнение (время/пульс вместо подходов)" className={`p-1.5 rounded-md transition shrink-0 ${ex.kind === "functional" ? "text-orange-400 bg-orange-400/10" : "text-zinc-500 hover:bg-zinc-700"}`}><Activity size={15} /></button>
        {ex.kind !== "functional" && <button onClick={toggleDetailed} title="Разные подходы" className={`p-1.5 rounded-md transition shrink-0 ${ex.detailed ? "text-lime-400 bg-lime-400/10" : "text-zinc-500 hover:bg-zinc-700"}`}><Layers size={15} /></button>}
        <button onClick={remove} className="p-1.5 rounded-md hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={15} /></button>
      </div>

      {showVideo && (
        <div className="pl-6 space-y-1.5">
          <input value={ex.video} onChange={(e) => { const v = e.target.value; startTransition(() => update({ video: v })); }} placeholder="Ссылка на видео (YouTube или .mp4)" className="w-full bg-zinc-800 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40" />
          {ex.video && (
            /\.(mp4|webm|ogg)$/i.test(ex.video) ? (
              <video src={ex.video} controls className="w-full max-h-56 rounded-lg bg-black" />
            ) : (
              <iframe src={toEmbedUrl(ex.video)} className="w-full aspect-video rounded-lg" allowFullScreen loading="lazy" title={ex.name || "Видео упражнения"} />
            )
          )}
        </div>
      )}
      {ex.kind === "functional" ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-6">
          <NumField label="Время выполнения" value={ex.duration} onChange={(e) => { const v = e.target.value; startTransition(() => update({ duration: v })); }} placeholder="40 с / 2 мин" />
          <NumField label="Вес отягощения" value={ex.weight} onChange={(e) => { const v = e.target.value; startTransition(() => update({ weight: v })); }} placeholder="16 кг" />
          <NumField label="Отдых" value={ex.rest} onChange={(e) => { const v = e.target.value; startTransition(() => update({ rest: v })); }} placeholder="30 с" />
          <NumField label="Пульсовая зона" value={ex.pulseZone} onChange={(e) => { const v = e.target.value; startTransition(() => update({ pulseZone: v })); }} placeholder="Z2 120-140" />
        </div>
      ) : ex.detailed ? (
        <div className="pl-6 space-y-1.5">
          {ex.setRows.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 w-5 text-center shrink-0 font-medium">{i + 1}</span>
              <input value={s.weight} inputMode="decimal" onChange={(e) => { const v = e.target.value; startTransition(() => updateSetRow(s.id, { weight: v })); }} placeholder="вес" className="h-9 w-16 bg-zinc-800 rounded-md px-1 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
              <span className="text-xs text-zinc-500">×</span>
              <input value={s.reps} inputMode="numeric" onChange={(e) => { const v = e.target.value; startTransition(() => updateSetRow(s.id, { reps: v })); }} placeholder="повт" className="h-9 w-16 bg-zinc-800 rounded-md px-1 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40 shrink-0" />
              <button onClick={() => removeSetRow(s.id)} className="ml-auto p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-600 transition" title="Удалить подход"><X size={13} /></button>
            </div>
          ))}
          <div className="flex items-center gap-3 mt-0.5">
            <button onClick={addSetRow} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-lime-400 transition"><Plus size={13} /> подход</button>
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 ml-auto">Отдых</span>
            <input value={ex.rest} inputMode="decimal" onChange={(e) => { const v = e.target.value; startTransition(() => update({ rest: v })); }} placeholder="90 с" className="w-16 bg-zinc-800 rounded-md px-1.5 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-6">
          <NumField label="Подходы" value={ex.sets} onChange={(e) => { const v = e.target.value; startTransition(() => update({ sets: v })); }} placeholder="4" />
          <NumField label="Повторы" value={ex.reps} onChange={(e) => { const v = e.target.value; startTransition(() => update({ reps: v })); }} placeholder="8-12" />
          <NumField label="Вес" value={ex.weight} onChange={(e) => { const v = e.target.value; startTransition(() => update({ weight: v })); }} placeholder="60 кг" />
          <NumField label="Отдых" value={ex.rest} onChange={(e) => { const v = e.target.value; startTransition(() => update({ rest: v })); }} placeholder="90 с" />
        </div>
      )}
      <input value={ex.note} onChange={(e) => { const v = e.target.value; startTransition(() => update({ note: v })); }} placeholder="Комментарий: техника, на что обратить внимание..." className="w-full bg-transparent text-xs text-zinc-400 px-1 py-0.5 pl-6 outline-none focus:text-zinc-200" />
      {lastMetric && (
        <div className="pl-6 flex items-center gap-1.5 text-[11px] text-cyan-400/80">
          <span className="text-zinc-600">Факт {lastMetric.date.slice(5).replace("-", ".")}:</span>
          {lastMetric.sets && <span>{lastMetric.sets}×{lastMetric.reps}</span>}
          {lastMetric.weight && <span>· {lastMetric.weight}</span>}
        </div>
      )}
    </div>
  );
}

export default memo(ExerciseRow, (prev, next) =>
  prev.ex === next.ex &&
  prev.label === next.label &&
  prev.canMoveUp === next.canMoveUp &&
  prev.canMoveDown === next.canMoveDown &&
  prev.lastMetric === next.lastMetric &&
  prev.groupColor === next.groupColor &&
  prev.suggestions === next.suggestions
);
