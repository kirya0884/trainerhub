import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import * as portalApi from "../lib/clientPortal";
import type { Payment } from "../lib/clients";

// Печать чека через native window.print() + .print-area, по образцу PlanPrintView.
export default function ReceiptPrintView({ payment, trainerId, clientName, onClose }: { payment: Payment; trainerId: string; clientName: string; onClose: () => void }) {
  const [brand, setBrand] = useState({ brand: "TrainerHub", logoUrl: "" });
  useEffect(() => { portalApi.fetchTrainerBrand(trainerId).then(setBrand); }, [trainerId]);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 overflow-y-auto">
      <div className="no-print sticky top-0 bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <p className="font-semibold text-sm">Чек об оплате</p>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm hover:bg-lime-300 transition"><Printer size={15} /> Печать / PDF</button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400"><X size={18} /></button>
        </div>
      </div>

      <div className="print-area max-w-sm mx-auto bg-white text-zinc-900 p-6 my-4 rounded-xl">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-zinc-300">
          {brand.logoUrl && <img src={brand.logoUrl} alt="" className="w-8 h-8 rounded object-cover" />}
          <span className="font-bold">{brand.brand}</span>
        </div>
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
