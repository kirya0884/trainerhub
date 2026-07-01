export default function DateField({ label, value, onChange }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-0.5 text-center">{label}</div>
      <input type="date" value={value} onChange={onChange} className="w-full h-[38px] bg-zinc-800 rounded-md px-1.5 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-lime-400/40" />
    </div>
  );
}
