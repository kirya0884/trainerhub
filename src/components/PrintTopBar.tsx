import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import * as portalApi from "../lib/clientPortal";

// Шапка окна предпросмотра печати — кнопки «Печать/PDF» и «Закрыть» + загрузка бренда тренера.
// Используется в PlanPrintView, ReceiptPrintView, ClientProgressPrintView.
export function usePrintBrand(trainerId: string) {
  const [brand, setBrand] = useState({ brand: "Reps", logoUrl: "" });
  useEffect(() => { portalApi.fetchTrainerBrand(trainerId).then(setBrand).catch((e) => console.error("[PrintTopBar]:", e)); }, [trainerId]);
  return brand;
}

export function PrintTopBar({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="no-print sticky top-0 bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
      <p className="font-semibold text-sm">{title}</p>
      <div className="flex gap-2">
        <button onClick={() => window.print()} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm hover:bg-lime-300 transition">
          <Printer size={15} /> Печать / PDF
        </button>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400"><X size={18} /></button>
      </div>
    </div>
  );
}

export function PrintBrandHeader({ brand, date }: { brand: { brand: string; logoUrl: string }; date?: string }) {
  return (
    <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-300">
      <div className="flex items-center gap-2">
        {brand.logoUrl && <img src={brand.logoUrl} alt="" className="w-8 h-8 rounded object-cover" />}
        <span className="font-bold">{brand.brand}</span>
      </div>
      {date && <span className="text-sm text-zinc-500">{date}</span>}
    </div>
  );
}
