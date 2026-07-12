// Бейдж остатка тренировок из абонемента — слева от имени подопечного везде в приложении.
export default function RemainingBadge({ remaining }: { remaining: string | null | undefined }) {
  if (remaining == null || remaining === "") return null;
  const n = Number(remaining);
  const low = !Number.isNaN(n) && n <= 2;
  return (
    <span
      className={`shrink-0 min-w-[20px] h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center ${low ? "bg-orange-400/20 text-orange-400" : "bg-lime-400/15 text-lime-400"}`}
      title="Осталось тренировок по абонементу"
    >
      {remaining}
    </span>
  );
}
