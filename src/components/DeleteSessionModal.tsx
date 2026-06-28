import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { DeleteReason } from "../lib/progress";
import ModalShell from "./ModalShell";

const REASONS: DeleteReason[] = ["Уважительная", "Проспал", "Забыл", "Ошибка"];

// Подтверждение удаления тренировки с обязательным выбором причины — от причины зависит возврат тренировки в абонемент.
export default function DeleteSessionModal({ onConfirm, onClose }: { onConfirm: (reason: DeleteReason) => void; onClose: () => void }) {
  const [reason, setReason] = useState<DeleteReason | null>(null);

  return (
    <ModalShell title="Удалить тренировку" icon={<Trash2 size={16} className="text-red-400" />} onClose={onClose}>
      <div className="p-4 space-y-3">
        <p className="text-sm text-zinc-400">Тренировка переместится в корзину. Укажи причину — при «Уважительной» она вернётся в остаток абонемента.</p>
        <div className="grid grid-cols-2 gap-2">
          {REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)} className={`rounded-lg py-2.5 text-sm font-medium transition ${reason === r ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>{r}</button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 p-4 border-t border-zinc-800">
        <button onClick={onClose} className="flex-1 bg-zinc-800 rounded-lg py-2 text-sm text-zinc-400 hover:text-zinc-100 transition">Отмена</button>
        <button onClick={() => reason && onConfirm(reason)} disabled={!reason} className="flex-1 bg-red-500 text-white font-semibold rounded-lg py-2 text-sm hover:bg-red-400 transition disabled:opacity-40">Удалить</button>
      </div>
    </ModalShell>
  );
}
