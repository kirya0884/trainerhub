// Заглушки загрузки по форме будущего содержимого вместо голого «Загрузка...».
// Классы zinc-* — чтобы работала светлая тема (см. tailwind.config.js).

/** Несколько строк-карточек: списки в окнах и разделах. */
export function SkeletonRows({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`animate-pulse space-y-2 ${className}`} role="status" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-14 bg-zinc-900 border border-zinc-800 rounded-2xl" />)}
    </div>
  );
}

/** Экран целиком: заголовок, пара плиток и список. avatar — для карточек людей. */
export function ScreenSkeleton({ avatar = false }: { avatar?: boolean }) {
  return (
    <div className="animate-pulse space-y-4" role="status" aria-label="Загрузка">
      {avatar
        ? <div className="flex flex-col items-center gap-3 pt-6"><div className="w-20 h-20 rounded-full bg-zinc-800" /><div className="h-6 w-44 rounded-lg bg-zinc-800" /></div>
        : <div className="h-8 w-48 rounded-lg bg-zinc-800" />}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="h-24 bg-zinc-900 border border-zinc-800 rounded-2xl" />
        <div className="h-24 bg-zinc-900 border border-zinc-800 rounded-2xl" />
      </div>
      <SkeletonRows rows={3} />
    </div>
  );
}
