// Ссылка на видео упражнения → адрес для iframe. Встраиваем только YouTube и Vimeo по https,
// и адрес собираем сами из id ролика: что бы ни лежало в базе или бэкапе (javascript:, чужой сайт),
// в iframe попадёт только youtube.com/embed/… или player.vimeo.com/video/…. Остальное — null.
export function toEmbedUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const path = u.pathname.split("/").filter(Boolean);
  let yt: string | undefined;
  if (host === "youtu.be") yt = path[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    yt = path[0] === "watch" ? u.searchParams.get("v") ?? undefined
      : ["embed", "shorts", "live"].includes(path[0]) ? path[1] : undefined;
  }
  if (yt) return /^[\w-]{11}$/.test(yt) ? `https://www.youtube.com/embed/${yt}` : null;
  // vimeo.com/123 и vimeo.com/123/hash (скрытое видео), player.vimeo.com/video/123?h=hash
  const vimeo = host === "vimeo.com" ? path : u.hostname === "player.vimeo.com" && path[0] === "video" ? path.slice(1) : null;
  if (!vimeo || !/^\d+$/.test(vimeo[0] ?? "")) return null;
  const h = vimeo[1] ?? u.searchParams.get("h");
  return `https://player.vimeo.com/video/${vimeo[0]}${h && /^\w+$/.test(h) ? `?h=${h}` : ""}`;
}
