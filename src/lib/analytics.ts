import type { DashboardClient, DashboardPayment } from "./dashboard";

// Чистые функции аналитики дашборда — без сетевых вызовов, работают над уже загруженными clients/payments.

export function monthlyRevenue(payments: DashboardPayment[], months = 6) {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("ru-RU", { month: "short" }), total: 0 };
  });
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const p of payments) { const b = byKey[p.date?.slice(0, 7)]; if (b) b.total += p.amount; }
  return buckets;
}

export function topClientsByRevenue(clients: DashboardClient[], payments: DashboardPayment[], n = 5) {
  const totals: Record<string, number> = {};
  for (const p of payments) totals[p.clientId] = (totals[p.clientId] || 0) + p.amount;
  return clients.map((c) => ({ c, total: totals[c.id] || 0 })).filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, n);
}

// Доля клиентов без флага «пробный» среди всей базы — proxy конверсии из пробного в постоянного.
export function trialConversionRate(clients: DashboardClient[]): number | null {
  if (!clients.length) return null;
  return Math.round((clients.filter((c) => !c.trial).length / clients.length) * 100);
}

// Когорты по месяцу присоединения: сколько клиентов до сих пор не «ушли».
export function cohortRetention(clients: DashboardClient[], months = 6) {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("ru-RU", { month: "short" }), total: 0, active: 0 };
  });
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const c of clients) {
    const b = byKey[(c.joinedAt || "").slice(0, 7)];
    if (!b) continue;
    b.total++;
    if (c.status !== "left") b.active++;
  }
  return buckets.filter((b) => b.total > 0);
}

export function revenueBySource(clients: DashboardClient[], payments: DashboardPayment[]) {
  const sourceByClient: Record<string, string> = {};
  for (const c of clients) sourceByClient[c.id] = c.source || "Не указан";
  const totals: Record<string, number> = {};
  for (const p of payments) { const s = sourceByClient[p.clientId] || "Не указан"; totals[s] = (totals[s] || 0) + p.amount; }
  return Object.entries(totals).map(([source, total]) => ({ source, total })).sort((a, b) => b.total - a.total);
}
