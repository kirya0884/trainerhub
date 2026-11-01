import { exKey } from "./sessionUtils";

// Нормализация для поиска: регистр, ё→е, лишние пробелы — то же, что ключ упражнения.
// ?? "" — в кэше старого формата поля может не быть.
export const normSearch = (s: string | null | undefined) => exKey(s ?? "");

// Совпадение по телефону: только если в запросе ≥3 цифр. Сравниваем цифры, ведущие 8 и 7
// считаем одинаковыми (8 900… и +7 900…).
const phoneDigits = (s: string) => s.replace(/\D/g, "").replace(/^8/, "7");
export function phoneMatches(query: string, phone: string | null | undefined): boolean {
  const q = query.replace(/\D/g, "");
  if (q.length < 3) return false;
  const p = phoneDigits(phone ?? "");
  return p.includes(q) || p.includes(phoneDigits(q));
}
