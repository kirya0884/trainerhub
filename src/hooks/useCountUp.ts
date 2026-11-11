import { useEffect, useRef, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Число «докручивается» от прошлого значения к новому (при первом показе — от нуля).
 *  «Уменьшить движение» в системе — сразу итог. */
export function useCountUp(to: number, ms = 900): number {
  const [v, setV] = useState(() => (reduced() ? to : 0));
  const from = useRef(reduced() ? to : 0);
  useEffect(() => {
    if (reduced() || !Number.isFinite(to)) { setV(to); from.current = to; return; }
    const start = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(start + (to - start) * e));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = to; };
  }, [to, ms]);
  return v;
}

/** Короткая вибрация (Android; на iPhone браузер её не даёт — просто ничего) */
export const haptic = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* нет вибро */ } };
