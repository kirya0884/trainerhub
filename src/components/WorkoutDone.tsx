import { useEffect, useMemo, useState } from "react";
import { Check, CircleX } from "lucide-react";
import { closeCelebrate, subscribeCelebrate, type DoneStats } from "../lib/celebrate";
import { useCountUp } from "../hooks/useCountUp";
import { useModalA11y } from "../hooks/useModalA11y";

// Этап 12: экран-итог тренировки — галочка выпрыгивает, числа «докручиваются», лёгкий салют.
export default function WorkoutDone() {
  const [s, setS] = useState<DoneStats | null>(null);
  useEffect(() => subscribeCelebrate(setS), []);
  return s ? <DoneScreen key={s.title + s.sub + s.sets} s={s} /> : null;
}

const COLORS = ["var(--accent)", "#22d3ee", "#a78bfa", "#fb923c", "#f2f1ec"];

function Stat({ value, label, delay }: { value: number; label: string; delay: number }) {
  const [go, setGo] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGo(true), 250 + delay); return () => clearTimeout(t); }, [delay]);
  const v = useCountUp(go ? value : 0, 900);
  return (
    <div className="anim-rise bg-zinc-900 border border-zinc-800 rounded-2xl px-2 py-3" style={{ animationDelay: `${delay}ms` }}>
      <p className="font-display text-[22px] font-extrabold tracking-tight">{v.toLocaleString("ru-RU")}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function DoneScreen({ s }: { s: DoneStats }) {
  const { panelProps } = useModalA11y(closeCelebrate, "Тренировка записана");
  const confetti = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    left: 8 + Math.random() * 84, dx: Math.random() * 160 - 80, rot: Math.random() * 720 - 360, delay: Math.random() * 0.25, color: COLORS[i % COLORS.length],
  })), []);
  return (
    <div className="anim-fade fixed inset-0 z-[65] bg-zinc-950/95 text-zinc-100 flex items-end sm:items-center justify-center" style={{ "--accent": s.accent } as React.CSSProperties}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        {confetti.map((c, i) => (
          <i key={i} className="absolute -top-3 w-2 h-3 rounded-sm" style={{ left: `${c.left}%`, background: c.color, animation: `r-fall 1.6s ${c.delay}s cubic-bezier(.22,1,.36,1) forwards`, opacity: 0, ["--dx" as string]: `${c.dx}px`, ["--rot" as string]: `${c.rot}deg` }} />
        ))}
      </div>
      <div {...panelProps} className="relative w-full max-w-md px-5 text-center outline-none" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" }}>
        <div className="anim-pop mx-auto w-24 h-24 rounded-full bg-lime-400 text-zinc-950 flex items-center justify-center">
          <Check size={48} strokeWidth={3} className="anim-draw" />
        </div>
        <h2 className="mt-5 text-[22px] font-extrabold">{s.title}</h2>
        <p className="mt-1 text-sm text-zinc-400">{s.sub}</p>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat value={s.sets} label="подходов" delay={0} />
          <Stat value={s.tonnage} label="кг тоннаж" delay={80} />
          <Stat value={s.exercises} label={`из ${s.total} упр.`} delay={160} />
        </div>
        {(!!s.skipped?.length || !!s.partial) && (
          <div className="anim-rise mt-3 text-left space-y-1.5" style={{ animationDelay: "240ms" }}>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {!!s.skipped?.length && <span className="text-xs font-semibold rounded-lg px-2 py-1 bg-red-400/15 text-red-400">{s.skipped.length} не сделано</span>}
              {!!s.partial && <span className="text-xs font-semibold rounded-lg px-2 py-1 bg-amber-400/15 text-amber-400">{s.partial} частично</span>}
            </div>
            {s.skipped?.map((x, i) => (
              <p key={i} className="flex items-center gap-2 text-sm bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
                <CircleX size={16} className="text-red-400 shrink-0" />
                <span className="min-w-0 truncate text-zinc-300">{x.name}{x.note && <span className="text-red-400"> · {x.note}</span>}</span>
              </p>
            ))}
          </div>
        )}
        <button autoFocus onClick={closeCelebrate} className="mt-6 w-full h-12 rounded-2xl bg-lime-400 text-zinc-950 font-bold active:scale-[0.98] transition">Готово</button>
      </div>
    </div>
  );
}
