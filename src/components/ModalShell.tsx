import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export default function ModalShell({ title, icon, onClose, children, footer, wide }: {
  title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`bg-zinc-900 border border-zinc-800 w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"} sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <h3 className="font-semibold flex items-center gap-1.5">{icon} {title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" title="Закрыть"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">{children}</div>{footer}
      </div>
    </div>
  );
}
