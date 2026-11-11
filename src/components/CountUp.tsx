import { useCountUp } from "../hooks/useCountUp";

/** Этап 12: число «докручивается» до значения (деньги — с пробелами разрядов) */
export default function CountUp({ value, ms }: { value: number; ms?: number }) {
  return <>{useCountUp(Math.round(value), ms).toLocaleString("ru-RU")}</>;
}
