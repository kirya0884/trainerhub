import type { Occurrence } from "./bookings";
import { toDateStr } from "./format";

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

export function bookingsToIcs(occurrences: Occurrence[], clientName: (id: string) => string): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reps//RU"];
  for (const o of occurrences) {
    if (o.status === "cancelled") continue;
    const end = addMinutes(o.occDate, o.time, Number(o.duration) || 60);
    const names = o.clientIds.map(clientName).join(", ");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${o.id}-${o.occDate}@reps`,
      `DTSTART:${toIcsDate(o.occDate, o.time)}`,
      `DTEND:${toIcsDate(end.date, end.time)}`,
      `SUMMARY:Тренировка${names ? " — " + names : ""}`,
      ...(o.note ? [`DESCRIPTION:${o.note.replace(/\n/g, "\\n")}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(ics: string) {
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `reps-bookings-${new Date().toISOString().slice(0, 10)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
