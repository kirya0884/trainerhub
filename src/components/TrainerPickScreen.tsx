import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import * as portalApi from "../lib/clientPortal";
import type { SelfClient } from "../lib/clientPortal";
import { signOutAndForget } from "../lib/offlineCache";
import RepsMark from "./RepsMark";

// П. 60: у входа несколько карточек у разных тренеров — клиент выбирает, чей кабинет открыть.
// Имя тренера — из его профиля, иначе бренд; не прочитали (нет сети, RLS) — «Тренер N» и имя в карточке.
export default function TrainerPickScreen({ cards, onPick }: { cards: SelfClient[]; onPick: (clientId: string) => void }) {
  // undefined — ещё грузим; {} — не удалось, показываем запасные подписи
  const [names, setNames] = useState<Awaited<ReturnType<typeof portalApi.fetchTrainerNames>> | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    portalApi.fetchTrainerNames([...new Set(cards.map((c) => c.trainerId))])
      .then((n) => { if (alive) setNames(n); })
      .catch((e) => { console.warn("[TrainerPickScreen] имена тренеров:", e); if (alive) setNames({}); });
    return () => { alive = false; };
  }, [cards]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center"><RepsMark size={48} /></div>
        <div className="text-center space-y-1">
          <h1 className="text-xl font-extrabold tracking-tight">Выбери тренера</h1>
          <p className="text-sm text-zinc-500">Ты занимаешься у нескольких тренеров. Сменить можно в меню профиля.</p>
        </div>
        <ul className="space-y-2" aria-busy={names === undefined}>
          {cards.map((c, i) => {
            const t = names?.[c.trainerId];
            const title = t?.name || t?.brand || `Тренер ${i + 1}`;
            const sub = t?.name && t.brand && t.brand !== t.name ? t.brand : t ? "" : `Карточка: ${c.name}`;
            return (
              <li key={c.id}>
                <button onClick={() => onPick(c.id)} className="w-full flex items-center gap-3 p-3 min-h-[64px] rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition text-left">
                  {t?.logoUrl
                    ? <img src={t.logoUrl} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                    : <span className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center font-bold shrink-0">{title[0]}</span>}
                  <span className="min-w-0 flex-1">
                    {names === undefined
                      ? <span className="block h-4 w-32 rounded bg-zinc-800 animate-pulse" aria-label="Загружаем имя тренера" />
                      : <span className="block font-semibold truncate">{title}</span>}
                    {sub && <span className="block text-xs text-zinc-500 truncate">{sub}</span>}
                  </span>
                  <ChevronRight size={18} className="text-zinc-600 shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-center">
          <button onClick={() => signOutAndForget()} className="text-sm text-zinc-500 hover:text-zinc-300 px-3 py-2">Выйти</button>
        </div>
      </div>
    </div>
  );
}
