import { AlertTriangle, Download } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardClient, DashboardPayment } from "../lib/dashboard";
import { cohortRetention, debtClients, monthlyRevenue, pendingPaymentClients, revenueBySource, topClientsByRevenue, trialConversionRate } from "../lib/analytics";
import { exportAnalyticsCsv } from "../lib/exportAnalytics";
import RemainingBadge from "./RemainingBadge";

const remainingOf = (m: DashboardClient["membership"]) => (m?.type === "sessions" && m.remaining !== "" && m.remaining != null ? String(m.remaining) : null);

export default function AnalyticsPanel({ clients, payments, attendanceRate }: {
  clients: DashboardClient[]; payments: DashboardPayment[]; attendanceRate: number | null;
}) {
  const revenue = monthlyRevenue(payments);
  const top = topClientsByRevenue(clients, payments);
  const conversion = trialConversionRate(clients);
  const cohorts = cohortRetention(clients);
  const bySource = revenueBySource(clients, payments);
  const debt = debtClients(clients);
  const pendingClients = pendingPaymentClients(clients, payments);
  const hasRevenue = revenue.some((b) => b.total > 0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 shrink-0">Период:</span>
          <div className="grid grid-cols-2 gap-1.5 flex-1 min-w-0 overflow-hidden">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full min-w-0 bg-zinc-800 rounded-lg px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full min-w-0 bg-zinc-800 rounded-lg px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          </div>
        </div>
        <button onClick={() => exportAnalyticsCsv(clients, payments, from, to)} className="w-full flex items-center justify-center gap-1.5 bg-lime-400 text-zinc-950 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-lime-300 transition">
          <Download size={14} /> Скачать Excel
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
        <p className="text-xs text-zinc-500 mb-2">Доход по месяцам</p>
        {hasRevenue ? (
          <div style={{ height: 140 }}>
            <ResponsiveContainer>
              <BarChart data={revenue} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
                <XAxis dataKey="label" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} width={40} />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#a1a1aa" }} formatter={(v: any) => [`${v.toLocaleString("ru-RU")} ₽`, "Доход"]} />
                <Bar dataKey="total" fill="#a3e635" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-zinc-600 text-center py-8">Нет данных об оплатах за этот период</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs text-zinc-500">Конверсия из пробных</p>
          <p className="text-2xl font-bold text-lime-400 mt-0.5">{conversion != null ? `${conversion}%` : "—"}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs text-zinc-500">Посещаемость (30 дн.)</p>
          <p className="text-2xl font-bold text-cyan-400 mt-0.5">{attendanceRate != null ? `${attendanceRate}%` : "—"}</p>
        </div>
      </div>

      {debt.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle size={13} className="text-orange-400 shrink-0" />
            <p className="text-xs text-zinc-500">Исчерпан пакет ({debt.length})</p>
          </div>
          <div className="space-y-1.5">
            {debt.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="flex-1 truncate text-orange-300">{c.name}</span>
                <span className="text-zinc-500 text-xs">0 тр.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingClients.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs text-zinc-500 mb-2">Ожидают оплаты</p>
          <div className="space-y-1.5">
            {pendingClients.map(({ c, amount }) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-cyan-400 shrink-0">{amount.toLocaleString("ru-RU")} ₽</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {top.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs text-zinc-500 mb-2">Топ клиентов по выручке</p>
          <div className="space-y-1.5">
            {top.map(({ c, total }) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                <RemainingBadge remaining={remainingOf(c.membership)} />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-zinc-400 shrink-0">{total.toLocaleString("ru-RU")} ₽</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {bySource.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs text-zinc-500 mb-2">Доход по источникам</p>
          <div className="space-y-1.5">
            {bySource.map(({ source, total }) => (
              <div key={source} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate text-zinc-300">{source}</span>
                <span className="text-zinc-400 shrink-0">{total.toLocaleString("ru-RU")} ₽</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {cohorts.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs text-zinc-500 mb-2">Удержание по когортам (месяц прихода)</p>
          <div className="space-y-1.5">
            {cohorts.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-sm">
                <span className="text-zinc-300 w-12 shrink-0 capitalize">{c.label}</span>
                <span className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden"><span className="block h-full bg-lime-400" style={{ width: `${Math.round((c.active / c.total) * 100)}%` }} /></span>
                <span className="text-zinc-500 text-xs shrink-0">{c.active}/{c.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
