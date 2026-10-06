import type { Sub } from "../components/ClientProfile";

/**
 * B25: перевод экрана в адрес и обратно.
 *
 * Адреса через решётку (#/clients/abc), а не через путь. Путь-адреса потребовали бы
 * правила «любой путь → index.html» на хостинге: иначе обновление страницы или
 * присланная ссылка упёрлись бы в 404. Ни vercel.json, ни навигационного фолбэка
 * в service worker в проекте нет, а настройки Vercel живут в панели — проверять их
 * взаимодействие с файлом в репозитории пришлось бы деплоем. Решётка это обходит:
 * сервер её не видит вовсе.
 *
 * Временные флаги (newForm, newBooking, newPlan, openOccurrence) в адрес НЕ пишутся:
 * они значат «открой форму прямо сейчас», и в присланной ссылке это мусор. По ссылке
 * открывается экран, а не наполовину заполненная форма.
 */
export type ViewLike =
  | { kind: "dashboard" }
  | { kind: "clients" }
  | { kind: "calendar" }
  | { kind: "plans" }
  | { kind: "client"; clientId: string; sub?: Sub }
  | { kind: "plan"; planId: string; clientId: string }
  | { kind: "trainerProfile" };

const SUBS: Sub[] = ["overview", "bookings", "payments", "reporting", "plans"];

export function viewToUrl(v: ViewLike): string {
  switch (v.kind) {
    case "clients": return "#/clients";
    case "calendar": return "#/calendar";
    case "plans": return "#/plans";
    case "trainerProfile": return "#/profile";
    case "client": return `#/clients/${encodeURIComponent(v.clientId)}${v.sub && v.sub !== "overview" ? `/${v.sub}` : ""}`;
    case "plan": return `#/plans/${encodeURIComponent(v.planId)}?c=${encodeURIComponent(v.clientId)}`;
    default: return "#/";
  }
}

/** Разбор адреса. Битый или незнакомый — дашборд, без ошибки. */
export function urlToView(hash: string): ViewLike {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const seg = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(queryPart ?? "");

  if (seg[0] === "clients") {
    if (!seg[1]) return { kind: "clients" };
    const sub = seg[2] as Sub | undefined;
    return { kind: "client", clientId: seg[1], sub: sub && SUBS.includes(sub) ? sub : undefined };
  }
  if (seg[0] === "plans") {
    if (!seg[1]) return { kind: "plans" };
    const clientId = q.get("c");
    // План без клиента открыть нечем — уводим в список планов, а не в пустой экран
    return clientId ? { kind: "plan", planId: seg[1], clientId } : { kind: "plans" };
  }
  if (seg[0] === "calendar") return { kind: "calendar" };
  if (seg[0] === "profile") return { kind: "trainerProfile" };
  return { kind: "dashboard" };
}
