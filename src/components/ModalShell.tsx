import { X } from "lucide-react";
import { type ReactNode } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useKeyboardViewport } from "../hooks/useKeyboardViewport";

export default function ModalShell({ title, icon, onClose, children, footer, wide }: {
  title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  // А1: роль, подпись, ловушка Tab, возврат фокуса и Escape только для верхнего модала
  const { titleId, panelProps } = useModalA11y(onClose);
  // С открытой клавиатурой лист стоит в видимой над ней области, а не под клавиатурой;
  // содержимое при нехватке высоты прокручивается внутри
  const kb = useKeyboardViewport();
  // Отступ под полосу «домой» iPhone — только у листа снизу и при закрытой клавиатуре
  // (с клавиатурой лист стоит над ней, полосы под ним нет); по центру (sm+) он не нужен
  const safeBottom = kb ? "" : "pb-[env(safe-area-inset-bottom)] sm:pb-0";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={onClose}
      style={kb ? { top: kb.top, bottom: kb.bottom } : undefined}>
      <div {...panelProps} onClick={(e) => e.stopPropagation()} className={`bg-zinc-900 text-zinc-100 border border-zinc-800 w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"} sm:rounded-2xl rounded-t-3xl max-h-[88vh] flex flex-col outline-none ${safeBottom}`}
        style={kb ? { maxHeight: kb.height - 12 } : undefined}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <h3 id={titleId} className="font-semibold flex items-center gap-1.5">{icon} {title}</h3>
          <button onClick={onClose} className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400" title="Закрыть" aria-label="Закрыть"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">{children}</div>{footer}
      </div>
    </div>
  );
}
