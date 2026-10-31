import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle, Info, X } from "lucide-react";
import { answer, dismiss, subscribe, type Ask, type Toast } from "../lib/dialog";
import { useModalA11y } from "../hooks/useModalA11y";
import { useKeyboardViewport } from "../hooks/useKeyboardViewport";

// Сообщения (сверху, исчезают сами, закрываются нажатием) и окно подтверждения.
export default function DialogHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => subscribe((s) => { setToasts(s.toasts); setAsk(s.ask); }), []);

  return (
    <>
      <div className="fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-3 pointer-events-none" style={{ top: "calc(env(safe-area-inset-top) + 12px)" }} aria-live="polite">
        {toasts.map((t) => t.action ? (
          // С кнопкой действия: кнопка в кнопке недопустима, поэтому плашка — div с двумя кнопками
          <div key={t.id} className="pointer-events-auto w-full max-w-md flex items-center gap-2.5 rounded-2xl bg-zinc-800 border border-zinc-700 shadow-xl shadow-black/40 pl-3.5 pr-1 py-1 text-sm text-zinc-100">
            {t.kind === "error" ? <AlertCircle size={18} className="text-red-400 shrink-0" /> : <Info size={18} className="text-lime-400 shrink-0" />}
            <span className="flex-1 whitespace-pre-line leading-snug py-2">{t.text}</span>
            <button onClick={() => { dismiss(t.id); t.action!.run(); }} className="h-11 px-3 rounded-xl font-bold text-lime-400 hover:bg-zinc-700 transition shrink-0">{t.action.label}</button>
            <button onClick={() => dismiss(t.id)} aria-label="Закрыть" className="w-11 h-11 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-700 transition shrink-0"><X size={16} /></button>
          </div>
        ) : (
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
  const { panelProps } = useModalA11y(() => answer(false), ask.fields ? ask.text : "Подтверждение");
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((ask.fields ?? []).map((f) => [f.key, f.value ?? ""])));
  // Окно выезжает снизу, и «Да» оказывается под пальцем: второй тап по кнопке, которая
  // открыла вопрос, сам его подтверждал (или молча закрывал). Первые 400 мс кнопки не нажимаются.
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 400); return () => clearTimeout(t); }, []);
  const submit = (e?: FormEvent) => { e?.preventDefault(); if (armed) answer(true, values); };
  // Окно с полями открывается с клавиатурой — ставим его над ней (полоса «домой» тогда под клавиатурой)
  const kb = useKeyboardViewport();
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => answer(false)}
      style={kb ? { top: kb.top, bottom: kb.bottom } : undefined}>
      <div {...panelProps} onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-4 space-y-4 outline-none" style={{ paddingBottom: kb ? 16 : "calc(env(safe-area-inset-bottom) + 16px)" }}>
        <p className={`leading-snug text-zinc-100 whitespace-pre-line pt-1 ${ask.fields ? "text-[17px] font-bold" : "text-[15px]"}`}>{ask.text}</p>
        {ask.fields && (
          <form onSubmit={submit} className="space-y-2.5">
            {ask.fields.map((f, i) => (
              <label key={f.key} className="block">
                <span className="block text-[13px] font-semibold text-zinc-400 mb-1 px-0.5">{f.label}</span>
                <input autoFocus={i === 0} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  onFocus={(e) => e.target.select()} placeholder={f.placeholder} inputMode={f.numeric ? "decimal" : undefined}
                  type={f.password ? "password" : undefined} autoComplete={f.password ? "current-password" : undefined}
                  className="w-full h-12 px-3.5 rounded-xl bg-zinc-800 text-base outline-none focus:ring-2 focus:ring-lime-400/50" />
              </label>
            ))}
            <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
          </form>
        )}
        {ask.alt ? (
          // Два варианта и отмена: столбиком, чтобы длинные подписи не обрезались
          <div className="flex flex-col gap-2">
            <button onClick={() => armed && answer(true)} className="h-12 rounded-xl text-sm font-bold bg-lime-400 hover:bg-lime-300 text-zinc-950 transition">{ask.ok}</button>
            {/* Фокус на втором варианте («как есть»): случайный Enter ничего не меняет */}
            <button onClick={() => armed && answer("alt")} autoFocus className="h-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-zinc-200 transition">{ask.alt}</button>
            <button onClick={() => armed && answer(false)} className="h-11 rounded-xl text-sm font-semibold text-zinc-400 hover:bg-zinc-800 transition">{ask.cancel}</button>
          </div>
        ) : (
        <div className="flex gap-2">
          {/* В опасном вопросе фокус на «Отмена» — случайный Enter ничего не удалит */}
          <button onClick={() => armed && answer(false)} autoFocus={ask.danger} className="flex-1 h-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-zinc-200 transition">{ask.cancel}</button>
          <button onClick={() => (ask.fields ? submit() : armed && answer(true))} autoFocus={!ask.danger && !ask.fields}
            className={`flex-1 h-12 rounded-xl text-sm font-bold transition ${ask.danger ? "bg-red-500 hover:bg-red-400 text-white" : "bg-lime-400 hover:bg-lime-300 text-zinc-950"}`}>{ask.ok}</button>
        </div>
        )}
      </div>
    </div>
  );
}
