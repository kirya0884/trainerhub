import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { flushOutbox, isFlushing, pending, startOutbox, subscribeOutbox } from "../lib/outbox";
import { supabase } from "../lib/supabase";
import { notify } from "../lib/dialog";

// Значок слева внизу над панелью: нет сети и/или есть неотправленное. Нажатие — отправить
// сейчас. Пока всё отправлено и сеть есть — значка нет.
export default function OutboxBadge() {
  const [owner, setOwner] = useState("");
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [, setTick] = useState(0);

  useEffect(() => {
    startOutbox();
    supabase.auth.getSession().then(({ data }) => setOwner(data.session?.user.id ?? "")).catch(() => {});
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setOwner(s?.user.id ?? ""));
    const un = subscribeOutbox(() => setTick((n) => n + 1));
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { data.subscription.unsubscribe(); un(); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const mine = owner ? pending(owner) : [];
  const failed = mine.filter((i) => i.error);
  if (online && mine.length === 0) return null;
  const busy = isFlushing();

  const onTap = async () => {
    if (!navigator.onLine) { notify("Нет интернета. Всё сохранено на телефоне и отправится само, когда появится сеть.", "info"); return; }
    await flushOutbox();
    const left = pending(owner);
    if (!left.length) notify("Всё отправлено.", "info");
    else if (left.some((i) => i.error)) notify(`Не удалось отправить (${left.length}): ${left.find((i) => i.error)?.error}. Данные сохранены на телефоне — попробуем ещё раз позже.`);
  };

  return (
    <button onClick={onTap} aria-live="polite"
      className={`fixed left-4 z-40 h-10 pl-3 pr-3.5 rounded-full flex items-center gap-2 text-[13px] font-semibold shadow-lg shadow-black/40 border transition ${failed.length ? "bg-orange-500/15 border-orange-400/40 text-orange-300" : "bg-zinc-900 border-zinc-700 text-zinc-200"}`}
      style={{ bottom: "calc(var(--tabbar-h, 0px) + var(--minibar-h, 0px) + 16px)" }}>
      {!online ? <CloudOff size={16} className="text-zinc-400" /> : failed.length ? <TriangleAlert size={16} /> : <RefreshCw size={16} className={busy ? "animate-spin text-lime-400" : "text-lime-400"} />}
      {!online && mine.length === 0 ? "Нет сети" : `${!online ? "Нет сети · " : busy ? "Отправляем · " : ""}не отправлено: ${mine.length}`}
    </button>
  );
}
