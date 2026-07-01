// type="text", не "number" — намеренно: на мобильных type="number" приводил к потере фокуса при вводе. Не менять без проверки на телефоне.
export default function NumField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-0.5 text-center">{label}</div>
      <input value={value} onChange={onChange} placeholder={placeholder} className="w-full h-[38px] bg-zinc-800 rounded-md px-1 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40" />
    </div>
  );
}
