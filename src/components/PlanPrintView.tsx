import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import * as portalApi from "../lib/clientPortal";
import type { Plan } from "../types";

// Печать плана через native window.print() + @media print в index.css (.print-area) — без PDF-библиотек.
export default function PlanPrintView({ plan, trainerId, clientName, onClose }: { plan: Plan; trainerId: string; clientName: string; onClose: () => void }) {
  const [brand, setBrand] = useState({ brand: "TrainerHub", logoUrl: "" });
  useEffect(() => { portalApi.fetchTrainerBrand(trainerId).then(setBrand); }, [trainerId]);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 overflow-y-auto">
      <div className="no-print sticky top-0 bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <p className="font-semibold text-sm">Предпросмотр печати</p>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 py-1.5 text-sm hover:bg-lime-300 transition"><Printer size={15} /> Печать / PDF</button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400"><X size={18} /></button>
        </div>
      </div>

      <div className="print-area max-w-2xl mx-auto bg-white text-zinc-900 p-6 my-4 rounded-xl">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-300">
          <div className="flex items-center gap-2">
            {brand.logoUrl && <img src={brand.logoUrl} alt="" className="w-8 h-8 rounded object-cover" />}
            <span className="font-bold">{brand.brand}</span>
          </div>
          <span className="text-sm text-zinc-500">{new Date().toLocaleDateString("ru-RU")}</span>
        </div>
        <h1 className="text-xl font-bold mb-1">{plan.name}</h1>
        <p className="text-sm text-zinc-600 mb-4">Подопечный: {clientName}</p>
        {plan.note && <p className="text-sm text-zinc-700 bg-zinc-100 rounded-lg p-2 mb-4">{plan.note}</p>}

        {plan.days.map((day) => (
          <div key={day.id} className="mb-4 break-inside-avoid">
            <h2 className="font-semibold text-base mb-1.5 pb-1 border-b border-zinc-200">{day.name}</h2>
            {day.exercises.length === 0 ? (
              <p className="text-sm text-zinc-400">Нет упражнений</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {day.exercises.map((ex, i) => (
                    <tr key={ex.id} className="border-b border-zinc-100">
                      <td className="py-1 pr-2 text-zinc-400 w-5">{i + 1}</td>
                      <td className="py-1 pr-2 font-medium">{ex.name || "—"}</td>
                      <td className="py-1 pr-2 text-zinc-600 whitespace-nowrap">{ex.sets}×{ex.reps}{ex.weight && ` · ${ex.weight}`}</td>
                      <td className="py-1 text-zinc-500">{ex.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
