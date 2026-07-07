// toISOString() переводит в UTC и может "съехать" на соседний день при положительном смещении локального
// часового пояса от UTC (UTC+3 и т.п.) — поэтому везде собираем строку из локальных year/month/date.
export const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => toDateStr(new Date());
export const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return toDateStr(d); };
export const addMonths = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setMonth(d.getMonth() + n); return toDateStr(d); };

export const fmtDate = (s: string | null | undefined, short = false) => {
  if (!s) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00" : s);
  if (isNaN(d.getTime())) return "—";
  if (short) return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  return d.toLocaleDateString("ru-RU");
};

export const parseNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(",", ".").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
};
