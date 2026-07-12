import { usePrintBrand, PrintTopBar, PrintBrandHeader } from "./PrintTopBar";
import type { Payment } from "../lib/clients";

// Печать чека через native window.print() + .print-area, по образцу PlanPrintView.
export default function ReceiptPrintView({ payment, trainerId, clientName, onClose }: { payment: Payment; trainerId: string; clientName: string; onClose: () => void }) {
  const brand = usePrintBrand(trainerId);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 overflow-y-auto">
      <PrintTopBar title="Чек об оплате" onClose={onClose} />

      <div className="print-area max-w-sm mx-auto bg-white text-zinc-900 p-6 my-4 rounded-xl">
        <PrintBrandHeader brand={brand} />
        <h1 className="text-lg font-bold mb-3">Квитанция об оплате</h1>
        <div className="space-y-1.5 text-sm">
          <p><span className="text-zinc-500">Подопечный:</span> {clientName}</p>
          <p><span className="text-zinc-500">Дата:</span> {new Date(payment.date).toLocaleDateString("ru-RU")}</p>
          <p><span className="text-zinc-500">Тип:</span> {payment.type === "subscription" ? "Подписка" : "Пакет тренировок"}</p>
          {payment.note && <p><span className="text-zinc-500">Примечание:</span> {payment.note}</p>}
          <p className="text-xl font-bold mt-3 pt-3 border-t border-zinc-200">{payment.amount.toLocaleString("ru-RU")} ₽</p>
        </div>
      </div>
    </div>
  );
}
