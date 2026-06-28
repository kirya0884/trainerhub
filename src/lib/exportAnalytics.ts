import type { DashboardClient, DashboardPayment } from "./dashboard";

// ponytail: CSV с BOM вместо бинарного .xlsx — открывается в Excel без новых зависимостей.
export function exportAnalyticsCsv(clients: DashboardClient[], payments: DashboardPayment[], from: string, to: string) {
  const byClient = Object.fromEntries(clients.map((c) => [c.id, c.name]));
  const rows = payments
    .filter((p) => (!from || p.date >= from) && (!to || p.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date));

  const header = ["Дата", "Клиент", "Сумма"];
  const lines = [header, ...rows.map((p) => [p.date, byClient[p.clientId] || "—", String(p.amount)])];
  const total = rows.reduce((s, p) => s + p.amount, 0);
  lines.push(["", "Итого", String(total)]);

  const csv = lines.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `analytics_${from || "all"}_${to || "all"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
