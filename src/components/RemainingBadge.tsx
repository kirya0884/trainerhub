// Бейдж остатка тренировок из абонемента — слева от имени подопечного везде в приложении.
export default function RemainingBadge({ remaining }: { remaining: string | null | undefined }) {
  if (remaining == null || remaining === "") return null;
  return (
    <span className="shrink-0 min-w-[20px] h-5 px-1 rounded-full bg-lime-400/15 text-lime-400 text-[11px] font-bold flex items-center justify-center" title="Осталось тренировок по абонементу">
      {remaining}
    </span>
  );
}
