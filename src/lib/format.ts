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

// Отдых в плане — свободный текст: «90», «90 с», «1:30», «2 мин», «1,5 мин», «2 мин 30 с».
// Возвращает секунды; null — не задан или не разобрали. parseNum тут не годится:
// он выбрасывает «:» и «мин», и «1:30» превращался в 130, «2 мин» — в 2.
export const parseRest = (s: string): number | null => {
  const t = (s || "").trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  let sec: number;
  const mmss = t.match(/^(\d+):(\d{1,2})$/);
  const min = t.match(/(\d+(?:\.\d+)?)\s*[мm]/);
  if (mmss) sec = Number(mmss[1]) * 60 + Number(mmss[2]);
  else if (min) {
    const after = t.slice((min.index ?? 0) + min[0].length).match(/(\d+)\s*[сs]/);
    sec = parseFloat(min[1]) * 60 + (after ? Number(after[1]) : 0);
  } else sec = parseFloat(t);
  return sec >= 5 && sec <= 1800 ? Math.round(sec) : null;
};
