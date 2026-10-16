export const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => toDateStr(new Date());
export const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return toDateStr(d); };
export const daysBetween = (a: string, b: string) => Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000) + 1;
export const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";

const nf = new Intl.NumberFormat("ru-RU");
export const n0 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : nf.format(Math.round(v)));
export const n1 = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 1 }));
export const rub = (v: number | null | undefined) => (v == null ? "—" : `${nf.format(Math.round(v))} ₽`);
/** Короткая запись больших чисел для осей: 12 тыс., 1,2 млн */
export const short = (v: number) => (Math.abs(v) >= 1e6 ? `${n1(v / 1e6)} млн` : Math.abs(v) >= 1e3 ? `${n1(v / 1e3)} тыс.` : n0(v));
export const pct = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toLocaleString("ru-RU", { maximumFractionDigits: digits })}%`);

export const fmtDay = (s: string, grain: "day" | "week" | "month" = "day") => {
  const d = new Date(s + "T00:00:00");
  if (grain === "month") return d.toLocaleDateString("ru-RU", { month: "short", year: "2-digit" }).replace(".", "");
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
};
export const fmtDateTime = (s: string) => new Date(s).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const ago = (s: string | null) => {
  if (!s) return "никогда";
  const d = (Date.now() - new Date(s).getTime()) / 86400000;
  return d < 1 ? "сегодня" : d < 2 ? "вчера" : `${Math.floor(d)} дн. назад`;
};
