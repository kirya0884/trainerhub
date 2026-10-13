import { Suspense } from "react";
import { lazyRetry } from "../lib/lazy";
import type { TrendChartProps } from "./TrendChartImpl";

// Библиотека графиков — самая тяжёлая часть приложения; грузится, только когда
// график впервые появляется на экране. Пока грузится — заглушка той же высоты.
const Impl = lazyRetry(() => import("./TrendChartImpl"));

export default function TrendChart(props: TrendChartProps) {
  return (
    <Suspense fallback={<div style={{ height: props.height ?? 220 }} className="animate-pulse bg-zinc-900 rounded-2xl" />}>
      <Impl {...props} />
    </Suspense>
  );
}
