// type="text", не "number" — намеренно: на мобильных type="number" приводил к потере фокуса при вводе. Не менять без проверки на телефоне.
// inputMode: по умолчанию decimal (вес 62,5); подходы/отдых — numeric, повторы в плане («8-12», «max») — text.
export default function NumField({ label, value, onChange, onFocus, onBlur, placeholder, inputMode = "decimal" }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; onFocus?: () => void; onBlur?: () => void; placeholder?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] }) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-zinc-400 mb-1 text-center">{label}</div>
      <input value={value} onChange={onChange} onFocus={onFocus} onBlur={onBlur} placeholder={placeholder} inputMode={inputMode} className="w-full h-11 bg-zinc-800 rounded-lg px-1 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40" />
    </div>
  );
}
