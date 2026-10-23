// type="text", не "number" — намеренно: на мобильных type="number" приводил к потере фокуса при вводе. Не менять без проверки на телефоне.
export default function NumField({ label, value, onChange, onFocus, onBlur, placeholder }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; onFocus?: () => void; onBlur?: () => void; placeholder?: string }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-zinc-400 mb-1 text-center">{label}</div>
      <input value={value} onChange={onChange} onFocus={onFocus} onBlur={onBlur} placeholder={placeholder} inputMode="decimal" className="w-full h-[38px] bg-zinc-800 rounded-lg px-1 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40" />
    </div>
  );
}
