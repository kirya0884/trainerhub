import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { DeleteReason } from "../lib/progress";
import ModalShell from "./ModalShell";

const REASONS: DeleteReason[] = ["Записана по ошибке", "Дубль", "Не тот клиент", "Клиент не пришёл", "Другое"];

// Подтверждение удаления тренировки с обязательным выбором причины. Удаляют уже записанную
// тренировку — чаще всего по ошибке, поэтому возврат в абонемент по умолчанию включён,
// а решение тренер видит и может поменять переключателем. По умолчанию НЕ возвращаем:
// «Клиент не пришёл», «Дубль» (списана, скорее всего, одна из двух), другая тренировка
// за тот же день (списание за дату может быть её) и когда списание проверить не вышло.
// refundable — у клиента пакет (не подписка); charged — была ли тренировка списана:
// undefined — ещё проверяем, null — проверить не вышло.
export default function DeleteSessionModal({ refundable, charged, otherSameDay, onConfirm, onClose }: {
  refundable: boolean; charged: boolean | null | undefined; otherSameDay: boolean;
  onConfirm: (reason: DeleteReason, refund: boolean) => Promise<void>; onClose: () => void;
}) {
  const [reason, setReason] = useState<DeleteReason | null>(null);
  // null — тренер не трогал переключатель, берём значение по умолчанию
  const [refundPick, setRefundPick] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const noCharge = charged === false;
  const refundByDefault = charged === true && !otherSameDay && reason !== "Клиент не пришёл" && reason !== "Дубль";
  const refund = refundable && !noCharge && (refundPick ?? refundByDefault);
  const submit = async () => { if (!reason || busy) return; setBusy(true); try { await onConfirm(reason, refund); } finally { setBusy(false); } };

  return (
    <ModalShell title="Удалить тренировку" icon={<Trash2 size={16} className="text-red-400" />} onClose={onClose}>
      <div className="p-4 space-y-3">
        <p className="text-sm text-zinc-400">Тренировка переместится в корзину. Укажи причину.</p>
        <div className="grid grid-cols-2 gap-2">
          {REASONS.map((r) => (
            <button key={r} onClick={() => { setReason(r); setRefundPick(null); }} aria-pressed={reason === r} className={`rounded-xl py-2.5 px-2 text-sm font-medium transition ${reason === r ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>{r}</button>
          ))}
        </div>
        {refundable && (
          <>
            <button role="switch" aria-checked={refund} disabled={noCharge || charged === undefined || busy} onClick={() => setRefundPick(!refund)} className="w-full min-h-[44px] flex items-center gap-2.5 text-left text-sm text-zinc-200 disabled:opacity-50">
              Вернуть тренировку в абонемент
              <span className={`ml-auto w-11 h-[26px] shrink-0 rounded-full p-[3px] flex transition ${refund ? "bg-lime-400 justify-end" : "bg-zinc-800 border border-zinc-700"}`}>
                <span className={`w-5 h-5 rounded-full ${refund ? "bg-[#0B0D0C]" : "bg-zinc-500"}`} />
              </span>
            </button>
            {charged === undefined && <p className="text-[13px] text-zinc-500">Проверяю, списывалась ли тренировка…</p>}
            {noCharge && <p className="text-[13px] text-zinc-500">Эта тренировка не списывалась с абонемента — возвращать нечего.</p>}
            {charged === null && <p className="text-[13px] text-zinc-500">Не удалось проверить списание — реши сам.</p>}
            {charged === true && otherSameDay && <p className="text-[13px] text-zinc-500">За этот день есть другая тренировка — списание, скорее всего, её.</p>}
          </>
        )}
      </div>
      <div className="flex gap-2 p-4 border-t border-zinc-800">
        <button onClick={onClose} className="flex-1 bg-zinc-800 rounded-xl py-2 text-sm text-zinc-400 hover:text-zinc-100 transition">Отмена</button>
        <button onClick={submit} disabled={!reason || busy || (refundable && charged === undefined)} className="flex-1 bg-red-500 text-white font-semibold rounded-xl py-2 text-sm hover:bg-red-400 transition disabled:opacity-40">{busy ? "Удаляю…" : "Удалить"}</button>
      </div>
    </ModalShell>
  );
}
