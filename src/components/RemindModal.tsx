import { Bell, Copy, MessageCircle, MessageSquare, Send, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import ModalShell from "./ModalShell";
import { fetchClient } from "../lib/clients";
import { addDays, today } from "../lib/format";

const whenText = (date: string) => {
  const t = today();
  const d = new Date(date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  if (date === t) return `сегодня, ${d}`;
  if (date === addDays(t, 1)) return `завтра, ${d}`;
  return `${new Date(date + "T00:00:00").toLocaleDateString("ru-RU", { weekday: "long" })}, ${d}`;
};

// Напоминание клиенту о записи: готовый текст и кнопки мессенджеров из контактов в профиле.
// Отправляет сам тренер — так сообщение приходит от него, а не от приложения.
export default function RemindModal({ clientId, name, date, time, onClose }: { clientId: string; name: string; date: string; time: string; onClose: () => void }) {
  const [text, setText] = useState(`${name.split(" ")[0]}, привет! Напоминаю: тренировка ${whenText(date)}${time ? `, в ${time}` : ""}. До встречи!`);
  const [contacts, setContacts] = useState<{ phone: string; telegram: string; whatsapp: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchClient(clientId).then((c) => { if (alive) setContacts({ phone: c.phone, telegram: c.telegram, whatsapp: c.whatsapp }); })
      .catch((e) => { console.error("[RemindModal] контакты:", e); if (alive) setContacts({ phone: "", telegram: "", whatsapp: "" }); });
    return () => { alive = false; };
  }, [clientId]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* нет доступа к буферу — текст можно выделить вручную */ }
  };
  const enc = encodeURIComponent(text);
  const wa = contacts?.whatsapp ? `https://wa.me/${contacts.whatsapp.replace(/\D/g, "")}?text=${enc}` : "";
  // Telegram не умеет подставлять текст в чат по нику — копируем текст и открываем чат
  const tg = contacts?.telegram ? (contacts.telegram.startsWith("http") ? contacts.telegram : `https://t.me/${contacts.telegram.replace(/^@/, "")}`) : "";
  const sms = contacts?.phone ? `sms:${contacts.phone.replace(/[^\d+]/g, "")}?&body=${enc}` : "";
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const btn = "h-11 flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition";

  return (
    <ModalShell title={`Напомнить: ${name}`} icon={<Bell size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Текст напоминания"
          className="w-full bg-zinc-800 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-lime-400/50 resize-none" />
        <div className="grid grid-cols-2 gap-2">
          {wa && <a href={wa} target="_blank" rel="noreferrer" onClick={onClose} className={`${btn} bg-green-500/15 text-green-300 hover:bg-green-500/25`}><MessageCircle size={16} /> WhatsApp</a>}
          {tg && <a href={tg} target="_blank" rel="noreferrer" onClick={copy} className={`${btn} bg-sky-500/15 text-sky-300 hover:bg-sky-500/25`}><Send size={16} /> Telegram</a>}
          {sms && <a href={sms} onClick={onClose} className={`${btn} bg-zinc-800 text-zinc-100 hover:bg-zinc-700`}><MessageSquare size={16} /> SMS</a>}
          {canShare && <button onClick={() => navigator.share({ text }).catch(() => {})} className={`${btn} bg-zinc-800 text-zinc-100 hover:bg-zinc-700`}><Share2 size={16} /> Другое</button>}
          <button onClick={copy} className={`${btn} bg-zinc-800 text-zinc-100 hover:bg-zinc-700`}><Copy size={16} /> {copied ? "Скопировано" : "Копировать"}</button>
        </div>
        {tg && <p className="text-[13px] text-zinc-500">Telegram: текст скопируется — вставьте его в чат.</p>}
        {contacts && !wa && !tg && !sms && <p className="text-[13px] text-zinc-500">В профиле нет телефона и мессенджеров — добавьте их, чтобы отправлять в один тап.</p>}
      </div>
    </ModalShell>
  );
}
