import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as messagesApi from "../lib/messages";
import type { ChatMessage } from "../lib/messages";

// ponytail: поллинг раз в 10с вместо realtime-подписки — для диалога тренер-клиент этого достаточно.
export default function ChatThread({ trainerId, clientId, self, accent = "#a3e635" }: { trainerId: string; clientId: string; self: "trainer" | "client"; accent?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    const load = () => messagesApi.fetchMessages(clientId)
      .then((m) => { if (alive) setMessages(m); })
      .catch((e) => console.error("[ChatThread] load:", e));
    loadRef.current = load;
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [clientId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await messagesApi.sendMessage(trainerId, clientId, self, t);
    loadRef.current();
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col h-[60vh]">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && <p className="text-sm text-zinc-600 text-center py-6">Сообщений пока нет</p>}
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.sender === self ? "ml-auto text-zinc-950" : "bg-zinc-800 text-zinc-100"}`} style={m.sender === self ? { background: accent } : undefined}>
            {m.text}
            <p className={`text-[10px] mt-0.5 ${m.sender === self ? "text-zinc-950/60" : "text-zinc-500"}`}>{new Date(m.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-zinc-800 p-2 flex gap-2 shrink-0">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Сообщение..." className="flex-1 min-w-0 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
        <button onClick={send} className="rounded-lg px-3 text-zinc-950 font-semibold transition shrink-0" style={{ background: accent }}><Send size={16} /></button>
      </div>
    </div>
  );
}
