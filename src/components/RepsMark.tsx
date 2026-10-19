// Знак Reps (бренд «Сет»): буква R из одной линии и три отметки подходов.
// Цвета фирменные и не зависят от акцента тренера. На размерах меньше 40 px отметки убираются.
export default function RepsMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const ticks = size >= 40;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} role="img" aria-label="Reps">
      <rect width="120" height="120" rx="30" fill="#C6FF3D" />
      <path d="M33 90V30h27a18 18 0 0 1 0 36H33" fill="none" stroke="#0B0D0C" strokeWidth={ticks ? 12 : 15} strokeLinejoin="round" />
      <path d="M58 66l22 24" stroke="#0B0D0C" strokeWidth={ticks ? 12 : 15} strokeLinecap="round" />
      {ticks && (
        <>
          <rect x="88" y="28" width="10" height="10" rx="3" fill="#0B0D0C" />
          <rect x="88" y="44" width="10" height="10" rx="3" fill="#0B0D0C" />
          <rect x="88" y="60" width="10" height="10" rx="3" fill="#0B0D0C" opacity="0.35" />
        </>
      )}
    </svg>
  );
}
