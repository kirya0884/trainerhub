import { Share2 } from "lucide-react";
import { usePrintBrand, PrintTopBar, PrintBrandHeader } from "./PrintTopBar";
import type { Payment } from "../lib/clients";
import { plural } from "../lib/format";
import { notify } from "../lib/dialog";

const STATUS = { paid: "Оплачено", deferred: "Ожидается оплата", installment: "Частями" } as const;

// Печать чека через native window.print() + .print-area, по образцу PlanPrintView.
// 5.9: для неоплаченного — «Счёт на оплату», статус, тренировки (sessions_delta), имя тренера и «Поделиться».
export default function ReceiptPrintView({ payment, trainerId, clientName, onClose }: { payment: Payment; trainerId: string; clientName: string; onClose: () => void }) {
  const brand = usePrintBrand(trainerId);
  const paid = payment.payStatus === "paid";
  const title = paid ? "Квитанция об оплате" : "Счёт на оплату";
  const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU");
  const n = payment.sessionsDelta ?? 0;
  const rows: [string, string][] = [
    ["Клиент", clientName],
    ...(brand.name ? [["Тренер", brand.name] as [string, string]] : []),
    [paid ? "Дата оплаты" : "Дата", fmt(payment.date)],
    ...(!paid && payment.dueDate ? [["Оплатить до", fmt(payment.dueDate)] as [string, string]] : []),
    ["Тип", payment.type === "subscription" ? "Подписка" : "Пакет тренировок"],
    ...(n > 0 ? [["Тренировок", `${n} ${plural(n, ["тренировка", "тренировки", "тренировок"])}`] as [string, string]] : []),
    ["Статус", STATUS[payment.payStatus]],
    ...(payment.note ? [["Примечание", payment.note] as [string, string]] : []),
  ];
  const amount = `${payment.amount.toLocaleString("ru-RU")} ₽`;

  // Текстом в мессенджер: системное «Поделиться», где его нет — копируем
  const share = async () => {
    const text = [brand.brand, title, ...rows.map(([k, v]) => `${k}: ${v}`), `Сумма: ${amount}`].join("\n");
    if (navigator.share) {
      try { await navigator.share({ title, text }); }
      catch (e) { if ((e as Error).name !== "AbortError") console.error("[ReceiptPrintView] share:", e); }
      return;
    }
    try { await navigator.clipboard.writeText(text); notify("Текст скопирован — вставь его в мессенджер"); }
    catch (e) { console.error("[ReceiptPrintView] copy:", e); notify("Не удалось скопировать текст", "error"); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 text-zinc-100 overflow-y-auto">
      <PrintTopBar title={paid ? "Чек об оплате" : "Счёт"} onClose={onClose} />

      <div className="print-area max-w-sm mx-auto bg-white text-zinc-900 p-6 my-4 rounded-xl">
        <PrintBrandHeader brand={brand} />
        <h1 className="text-lg font-bold mb-3">{title}</h1>
        <div className="space-y-1.5 text-sm">
          {rows.map(([k, v]) => <p key={k}><span className="text-zinc-500">{k}:</span> {v}</p>)}
          <p className="text-xl font-bold mt-3 pt-3 border-t border-zinc-200">{amount}</p>
        </div>
      </div>
      <div className="no-print max-w-sm mx-auto px-4 sm:px-0 pb-6">
        <button onClick={share} className="w-full h-12 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold transition"><Share2 size={17} /> Поделиться</button>
      </div>
    </div>
  );
}
