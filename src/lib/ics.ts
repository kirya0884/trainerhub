import type { Occurrence } from "./bookings";
import { toDateStr, today } from "./format";

// Экспорт .ics — нативная сборка текста календаря (без библиотек), как и бэкап через Blob/createObjectURL.
const pad = (n: number) => String(n).padStart(2, "0");
const toIcsDate = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  return `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
};
const addMinutes = (date: string, time: string, minutes: number) => {
  const dt = new Date(`${date}T${time || "00:00"}:00`);
  dt.setMinutes(dt.getMinutes() + minutes);
  return { date: toDateStr(dt), time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` };
};
// RFC 5545, TEXT: экранируем обратный слэш, «;», «,» и переносы строк
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export function bookingsToIcs(occurrences: Occurrence[], clientName: (id: string) => string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reps//RU"];
  // DTSTAMP обязателен по RFC 5545 — момент выгрузки в UTC
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  for (const o of occurrences) {
    if (o.status === "cancelled") continue;
    // Время — фактическое (o.date — с учётом переноса); occDate — только ключ вхождения серии в UID
    const end = addMinutes(o.date, o.time, Number(o.duration) || 60);
    const names = o.clientIds.map(clientName).join(", ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${o.id}-${o.occDate}@reps`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsDate(o.date, o.time)}`,
      `DTEND:${toIcsDate(end.date, end.time)}`,
      `SUMMARY:${icsText(`Тренировка${names ? " — " + names : ""}`)}`,
      ...(o.note ? [`DESCRIPTION:${icsText(o.note)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// На iOS в PWA скачивание через <a download> не работает — там отдаём файл через «Поделиться».
// Только на телефоне или в установленном приложении: на десктопе share с файлом открыл бы
// системное окно вместо привычного скачивания. Иначе — скачиваем, как раньше.
// Отмена в окне «Поделиться» — не ошибка.
const preferShare = () => matchMedia("(display-mode: standalone)").matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
export async function downloadIcs(ics: string) {
  const name = `reps-bookings-${today()}.ics`;
  const blob = new Blob([ics], { type: "text/calendar" });
  const file = new File([blob], name, { type: "text/calendar" });
  if (preferShare() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if ((e as Error).name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
