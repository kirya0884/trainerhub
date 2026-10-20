import { minibarRef } from "../lib/minibar";

export type PillPerson = { name: string; avatarUrl?: string; color?: string };

/**
 * Свёрнутая тренировка — овал слева над нижней панелью: аватар (у совместной — несколько
 * внахлёст), имя и таймер. Справа остаётся место под круглую «+». Высоту отдаёт в
 * --minibar-h, чтобы значок очереди отправки поднимался над овалом.
 */
export default function WorkoutPill({ people, title, sub, rest, onOpen }: {
  people: PillPerson[]; title: string; sub: string; rest?: string; onOpen: () => void;
}) {
  const shown = people.slice(0, 3);
  return (
    <button onClick={onOpen} ref={minibarRef} aria-label={`Вернуться к тренировке: ${title}`}
      style={{ bottom: "calc(var(--tabbar-h, 0px) + 12px)" }}
      className="fixed left-3 z-50 max-w-[calc(100%-5.5rem)] h-14 pl-1.5 pr-4 rounded-full flex items-center gap-2.5 bg-zinc-900 text-zinc-100 border border-zinc-700 shadow-lg shadow-black/40 text-left active:scale-[0.98] transition">
      <span className="relative flex shrink-0">
        {shown.map((p, i) => (
          <span key={i} className={`w-11 h-11 rounded-full ring-2 ring-zinc-900 overflow-hidden flex items-center justify-center text-base font-bold text-zinc-950 ${i ? "-ml-4" : ""}`}
            style={{ background: p.avatarUrl ? undefined : p.color || "#a3e635", zIndex: shown.length - i }}>
            {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" /> : (p.name || "?").charAt(0).toUpperCase()}
          </span>
        ))}
        {/* Идёт тренировка — пульсирующая точка */}
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-lime-400 ring-2 ring-zinc-900 animate-pulse" style={{ zIndex: 5 }} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold truncate leading-tight">{title}</span>
        <span className="block text-xs font-mono truncate leading-tight mt-0.5">
          {rest ? <span className="text-cyan-400">отдых {rest}</span> : <span className="text-lime-400">{sub}</span>}
        </span>
      </span>
    </button>
  );
}
