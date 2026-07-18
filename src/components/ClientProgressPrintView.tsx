import { useEffect, useState } from "react";
import { usePrintBrand, PrintTopBar, PrintBrandHeader } from "./PrintTopBar";
import * as clientsApi from "../lib/clients";
import { fetchClientSessionsSummary } from "../lib/progress";
import { BODY_METRICS } from "../constants";
import type { Measurement } from "../lib/clients";
import type { Session } from "../types";

// Печать прогресса клиента: те же native window.print() + .print-area, что и в PlanPrintView.
export default function ClientProgressPrintView({ clientId, planIds, clientName, trainerId, onClose }: {
  clientId: string; planIds: string[]; clientName: string; trainerId: string; onClose: () => void;
}) {
  const brand = usePrintBrand(trainerId);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    clientsApi.fetchMeasurements(clientId).then(setMeasurements).catch((e) => console.error("[PrintView] fetchMeasurements:", e));
    fetchClientSessionsSummary(planIds).then((r) => setSessions(r.sessions)).catch((e) => console.error("[PrintView] fetchSessions:", e));
  }, [clientId, trainerId, planIds]);

  const usedMetrics = BODY_METRICS.filter((m) => measurements.some((x) => (x as any)[m.key] !== "" && (x as any)[m.key] != null));
  const attended = sessions.filter((s) => s.total > 0);
  const attendanceRate = attended.length ? Math.round((attended.reduce((a, s) => a + s.done / s.total, 0) / attended.length) * 100) : null;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 overflow-y-auto">
      <PrintTopBar title="Предпросмотр печати" onClose={onClose} />

      <div className="print-area max-w-2xl mx-auto bg-white text-zinc-900 p-6 my-4 rounded-xl">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-300">
          <div className="flex items-center gap-2">
            {brand.logoUrl && <img src={brand.logoUrl} alt="" className="w-8 h-8 rounded object-cover" />}
            <span className="font-bold">{brand.brand}</span>
          </div>
          <span className="text-sm text-zinc-500">{new Date().toLocaleDateString("ru-RU")}</span>
        </div>
        <h1 className="text-xl font-bold mb-1">Отчёт по прогрессу</h1>
        <p className="text-sm text-zinc-600 mb-4">Подопечный: {clientName}</p>

        <div className="flex gap-4 mb-4 text-sm">
          <div className="bg-zinc-100 rounded-lg px-3 py-2"><span className="text-zinc-500">Тренировок проведено: </span><span className="font-semibold">{sessions.length}</span></div>
          {attendanceRate != null && <div className="bg-zinc-100 rounded-lg px-3 py-2"><span className="text-zinc-500">Посещаемость: </span><span className="font-semibold">{attendanceRate}%</span></div>}
        </div>

        {usedMetrics.length > 0 && (
          <div className="mb-4 break-inside-avoid">
            <h2 className="font-semibold text-base mb-1.5 pb-1 border-b border-zinc-200">Замеры</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-zinc-500 text-left">
                <th className="py-1 pr-2">Дата</th>
                {usedMetrics.map((m) => <th key={m.key} className="py-1 pr-2">{m.label}</th>)}
              </tr></thead>
              <tbody>
                {measurements.map((e) => (
                  <tr key={e.id} className="border-b border-zinc-100">
                    <td className="py-1 pr-2 text-zinc-500 whitespace-nowrap">{e.date}</td>
                    {usedMetrics.map((m) => <td key={m.key} className="py-1 pr-2">{(e as any)[m.key] || "—"}{(e as any)[m.key] ? m.unit : ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="mb-4 break-inside-avoid">
            <h2 className="font-semibold text-base mb-1.5 pb-1 border-b border-zinc-200">История тренировок</h2>
            <table className="w-full text-sm">
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-100">
                    <td className="py-1 pr-2 text-zinc-500 whitespace-nowrap">{s.date}</td>
                    <td className="py-1 pr-2 font-medium">{s.dayName || "—"}</td>
                    <td className="py-1 pr-2 text-zinc-600 whitespace-nowrap">{s.done}/{s.total} выполнено</td>
                    <td className="py-1 text-zinc-500">{s.review}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {usedMetrics.length === 0 && sessions.length === 0 && <p className="text-sm text-zinc-500">Пока нет данных для отчёта.</p>}
      </div>
    </div>
  );
}
