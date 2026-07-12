import { usePrintBrand, PrintTopBar, PrintBrandHeader } from "./PrintTopBar";
import type { Plan } from "../types";

// Печать плана через native window.print() + @media print в index.css (.print-area) — без PDF-библиотек.
export default function PlanPrintView({ plan, trainerId, clientName, onClose }: { plan: Plan; trainerId: string; clientName: string; onClose: () => void }) {
  const brand = usePrintBrand(trainerId);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 overflow-y-auto">
      <PrintTopBar title="Предпросмотр печати" onClose={onClose} />

      <div className="print-area max-w-2xl mx-auto bg-white text-zinc-900 p-6 my-4 rounded-xl">
        <PrintBrandHeader brand={brand} date={new Date().toLocaleDateString("ru-RU")} />
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
