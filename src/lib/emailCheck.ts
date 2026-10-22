// Проверка адреса почты клиента до выдачи доступа: формат, пробелы, русские буквы
// и частые опечатки в доменах. suggestion — исправленный адрес для кнопки «Исправить».

const DOMAIN_FIX: Record<string, string> = {
  "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmail.con": "gmail.com", "gmail.om": "gmail.com",
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
  "mail.ry": "mail.ru", "mail.r": "mail.ru", "mail.ri": "mail.ru", "mal.ru": "mail.ru", "mial.ru": "mail.ru", "maill.ru": "mail.ru",
  "yandex.ry": "yandex.ru", "yandex.r": "yandex.ru", "yandex.ri": "yandex.ru", "yadex.ru": "yandex.ru", "yandx.ru": "yandex.ru", "yanex.ru": "yandex.ru", "yandeks.ru": "yandex.ru",
  "icloud.co": "icloud.com", "icloud.cm": "icloud.com", "iclod.com": "icloud.com", "icoud.com": "icloud.com",
  "bk.ry": "bk.ru", "list.ry": "list.ru", "inbox.ry": "inbox.ru", "rambler.ry": "rambler.ru",
};

// Русские буквы, похожие на латинские (yandeх с русской «х» и т.п.)
const LOOKALIKE: Record<string, string> = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "к": "k", "м": "m", "т": "t", "в": "b", "н": "h" };

export function checkEmail(raw: string): { error?: string; suggestion?: string } {
  let s = raw.trim();
  if (!s) return {};
  let error = "";
  if (/\s/.test(s)) { error = "В адресе есть пробел."; s = s.replace(/\s/g, ""); }
  if (/[а-яё]/i.test(s)) {
    const fixed = s.toLowerCase().replace(/[а-яё]/g, (c) => LOOKALIKE[c] ?? c);
    if (/[а-яё]/.test(fixed)) return { error: "В адресе русские буквы — почта пишется латиницей." };
    error = "В адресе русские буквы, похожие на латинские."; s = fixed;
  }
  const at = s.lastIndexOf("@");
  const domain = s.slice(at + 1).toLowerCase();
  if (at > 0 && DOMAIN_FIX[domain]) { error = error || `Похоже на опечатку в «${domain}».`; s = `${s.slice(0, at)}@${DOMAIN_FIX[domain]}`; }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return { error: error || "Неверный формат адреса — нужно вида name@mail.ru." };
  return error ? { error, suggestion: s !== raw.trim() ? s : undefined } : {};
}
