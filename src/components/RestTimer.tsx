import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";

// Таймер отдыха между подходами — общий для проведения тренером (SessionModal)
// и самостоятельной тренировки клиента (ClientSessionView).
// Когда запускать (отдых задан в плане, это не последний подход) — решает экран.

export const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Два коротких сигнала. AudioContext создаётся по тапу (иначе браузер его заглушит).
const beep = (ctx: AudioContext) => {
  [0, 0.28].forEach((t) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    const at = ctx.currentTime + t;
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.35, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    o.connect(g).connect(ctx.destination);
    o.start(at); o.stop(at + 0.22);
  });
};

export type RestTimer = ReturnType<typeof useRestTimer>;

/** Считаем от момента окончания, а не тиками — после блокировки экрана остаток верный. */
export function useRestTimer() {
  const [rest, setRest] = useState<{ endsAt: number; signaled: boolean; startAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => () => { audioRef.current?.close().catch(() => {}); }, []);
  // Тикаем только пока идёт отдых
  const active = !!rest;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const left = rest ? Math.max(0, Math.ceil((rest.endsAt - now) / 1000)) : 0;
  useEffect(() => {
    if (!rest) return;
    if (!rest.signaled && now >= rest.endsAt) {
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* iOS не поддерживает */ }
      if (audioRef.current) { try { beep(audioRef.current); } catch (e) { console.warn("[RestTimer] beep:", e); } }
      setRest({ ...rest, signaled: true });
    } else if (rest.signaled && now >= rest.endsAt + 6000) setRest(null);
  }, [now, rest]);

  const start = (sec: number) => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!audioRef.current && AC) audioRef.current = new AC();
      audioRef.current?.resume().catch(() => {});
    } catch (e) { console.warn("[RestTimer] audio:", e); }
    const t = Date.now();
    setNow(t);
    setRest({ endsAt: t + sec * 1000, signaled: false, startAt: t });
  };
  const addSeconds = (sec: number) => setRest((r) => r && { ...r, endsAt: Math.max(r.endsAt, Date.now()) + sec * 1000, signaled: false });
  const skip = () => setRest(null);
  // Этап 12: всего секунд отдыха — для кольца (с учётом «+30 с»)
  const total = rest ? Math.max(1, Math.round((rest.endsAt - rest.startAt) / 1000)) : 1;
  return { active, left, total, start, addSeconds, skip };
}

/** Плашка над нижней панелью экрана тренировки: отсчёт, «+30 с», «Пропустить»; по окончании — «Отдых окончен». */
export function RestBar({ timer }: { timer: RestTimer }) {
  if (!timer.active) return null;
  const { left, total } = timer;
  // Этап 12: кольцо убывает, последние 3 с цифры «бьются» оранжевым, в конце плашка вздрагивает
  const last = left > 0 && left <= 3;
  const C = 69.1; // длина окружности r=11
  return (
    <div className="shrink-0 px-3 pb-2">
      <div role="status" aria-live="polite" className={`anim-rise max-w-2xl mx-auto flex items-center gap-3 rounded-2xl pl-3 pr-1.5 h-12 text-zinc-950 shadow-lg transition-colors duration-300 ${left > 0 ? "bg-zinc-100" : "bg-lime-400 anim-shake"}`}>
        <span className="relative w-8 h-8 shrink-0">
          <svg viewBox="0 0 28 28" className="w-8 h-8 -rotate-90" aria-hidden="true">
            <circle cx="14" cy="14" r="11" fill="none" strokeWidth="3" className="stroke-current opacity-15" />
            <circle cx="14" cy="14" r="11" fill="none" strokeWidth="3" strokeLinecap="round" className={`stroke-current transition-[stroke-dashoffset] duration-1000 ease-linear ${last ? "text-orange-500" : ""}`}
              strokeDasharray={C} strokeDashoffset={C * (1 - left / total)} />
          </svg>
          <Timer size={14} className="absolute inset-0 m-auto" />
        </span>
        {left > 0
          ? <div className="leading-tight"><p className="text-xs opacity-70">Отдых</p><p key={last ? left : "n"} className={`font-mono text-lg font-bold origin-left ${last ? "text-orange-600 anim-beat" : ""}`}>{fmtClock(left)}</p></div>
          : <p className="font-bold">Отдых окончен</p>}
        <div className="ml-auto flex gap-1.5">
          {left > 0 && <button onClick={() => timer.addSeconds(30)} className="h-11 px-3 rounded-xl bg-black/10 font-semibold text-sm">+30 с</button>}
          <button onClick={timer.skip} className="h-11 px-3 rounded-xl bg-black/10 font-semibold text-sm">{left > 0 ? "Пропустить" : "Закрыть"}</button>
        </div>
      </div>
    </div>
  );
}
