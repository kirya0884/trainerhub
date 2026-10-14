import { useEffect, useState } from "react";
import { AlertCircle, Info, X } from "lucide-react";
import { answer, dismiss, subscribe, type Ask, type Toast } from "../lib/dialog";
import { useModalA11y } from "../hooks/useModalA11y";

// Сообщения (сверху, исчезают сами, закрываются нажатием) и окно подтверждения.
export default function DialogHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => subscribe((s) => { setToasts(s.toasts); setAsk(s.ask); }), []);

  return (
    <>
      <div className="fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-3 pointer-events-none" style={{ top: "calc(env(safe-area-inset-top) + 12px)" }} aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} onClick={() => dismiss(t.id)}
            className="pointer-events-auto w-full max-w-md flex items-start gap-2.5 text-left rounded-2xl bg-zinc-800 border border-zinc-700 shadow-xl shadow-black/40 px-3.5 py-3 text-sm text-zinc-100">
            {t.kind === "error" ? <AlertCircle size={18} className="text-red-400 shrink-0 mt-px" /> : <Info size={18} className="text-lime-400 shrink-0 mt-px" />}
            <span className="flex-1 whitespace-pre-line leading-snug">{t.text}</span>
            <X size={16} className="text-zinc-500 shrink-0 mt-0.5" aria-label="Закрыть" />
          </button>
        ))}
      </div>
      {ask && <AskDialog key={ask.id} ask={ask} />}
    </>
  );
}

function AskDialog({ ask }: { ask: Ask }) {
  const { panelProps } = useModalA11y(() => answer(false), "Подтверждение");
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => answer(false)}>
      <div {...panelProps} onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-4 space-y-4 outline-none" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
        <p className="text-[15px] leading-snug text-zinc-100 whitespace-pre-line pt-1">{ask.text}</p>
        <div className="flex gap-2">
          {/* В опасном вопросе фокус на «Отмена» — случайный Enter ничего не удалит */}
          <button onClick={() => answer(false)} autoFocus={ask.danger} className="flex-1 h-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-zinc-200 transition">{ask.cancel}</button>
          <button onClick={() => answer(true)} autoFocus={!ask.danger}
            className={`flex-1 h-12 rounded-xl text-sm font-bold transition ${ask.danger ? "bg-red-500 hover:bg-red-400 text-white" : "bg-lime-400 hover:bg-lime-300 text-zinc-950"}`}>{ask.ok}</button>
        </div>
      </div>
    </div>
  );
}
