import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { flushOutbox, isFlushing, localUid, orphans, pending, removeOrphans, startOutbox, subscribeOutbox } from "../lib/outbox";
import { supabase } from "../lib/supabase";
import { ask, notify } from "../lib/dialog";
import { fmtSavedAt, getStaleAt, revalidate, subscribeStale } from "../lib/offlineCache";

// Значок слева внизу над панелью: нет сети и/или есть неотправленное. Нажатие — отправить
// сейчас. Пока всё отправлено и сеть есть — значка нет. Если на экране сохранённые данные
// (lib/offlineCache) — пишем, на какое время они.
export default function OutboxBadge() {
  // Истёкший вход без сети supabase не отдаёт — тогда владелец по сохранённому на телефоне входу
  const [owner, setOwner] = useState(localUid);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [, setTick] = useState(0);

  useEffect(() => {
    startOutbox();
    supabase.auth.getSession().then(({ data }) => setOwner(data.session?.user.id ?? localUid())).catch(() => {});
    const { data } = supabase.auth.onAuthStateChange((e, s) => setOwner(s?.user.id ?? (e === "SIGNED_OUT" ? "" : localUid())));
    const un = subscribeOutbox(() => setTick((n) => n + 1));
    const unStale = subscribeStale(() => setTick((n) => n + 1));
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { data.subscription.unsubscribe(); un(); unStale(); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const mine = owner ? pending(owner) : [];
  // Записи прежней версии без владельца, которые не относятся к этому входу (lib/outbox adoptOrphans)
  const foreign = owner ? orphans().length : 0;
  const failed = mine.filter((i) => i.error);
  const staleAt = getStaleAt();
  // Сеть вроде есть, но запросы падают и на экране сохранённое — для тренера это тоже «нет сети»
  const offline = !online || staleAt !== null;
  if (!offline && mine.length === 0 && foreign === 0) return null;
  const busy = isFlushing();

  const onTap = async () => {
    if (!navigator.onLine) { notify("Нет интернета. Всё сохранено на телефоне и отправится само, когда появится сеть.", "info"); return; }
    // Сеть «есть», а на экране сохранённое — пробуем обновить экраны сейчас, не дожидаясь таймера
    if (staleAt !== null) revalidate();
    if (!mine.length && !foreign) return;
    await flushOutbox(); // заодно отнесёт к этому входу «ничьи» записи, если они его
    const left = pending(owner);
    const rest = orphans().length;
    if (rest) {
      if (await ask(`Не отправлено с другого входа: ${rest} (тренировки или питание). Они отправятся, когда на этом телефоне войдёт тот, кто их сделал. Удалить их с телефона? Тогда в базу они не попадут.`,
        { danger: true, ok: "Удалить", cancel: "Оставить" })) removeOrphans();
      return;
    }
    if (!left.length) notify("Всё отправлено.", "info");
    else if (left.some((i) => i.error)) notify(`Не удалось отправить (${left.length}): ${left.find((i) => i.error)?.error}. Данные сохранены на телефоне — попробуем ещё раз позже.`);
  };
  const label = `не отправлено: ${mine.length}${foreign ? ` · с другого входа: ${foreign}` : ""}`;

  return (
    <button onClick={onTap} aria-live="polite"
      className={`fixed left-4 z-40 min-h-10 max-w-[calc(100vw-6.5rem)] py-1 pl-3 pr-3.5 rounded-full flex items-center gap-2 text-left text-[13px] font-semibold leading-tight shadow-lg shadow-black/40 border transition ${failed.length ? "bg-orange-500/15 border-orange-400/40 text-orange-300" : "bg-zinc-900 border-zinc-700 text-zinc-200"}`}
      style={{ bottom: "calc(var(--tabbar-h, 0px) + var(--minibar-h, 0px) + 16px)" }}>
      {offline ? <CloudOff size={16} className="text-zinc-400 shrink-0" /> : failed.length ? <TriangleAlert size={16} /> : <RefreshCw size={16} className={busy ? "animate-spin text-lime-400" : "text-lime-400"} />}
      {offline ? (
        <span className="flex flex-col">
          <span>Нет сети{staleAt !== null && ` · данные на ${fmtSavedAt(staleAt)}`}</span>
          {(mine.length > 0 || foreign > 0) && <span className="text-[11px] font-medium text-zinc-400">{label}</span>}
        </span>
      ) : `${busy ? "Отправляем · " : ""}${label}`}
    </button>
  );
}
