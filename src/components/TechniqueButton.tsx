import { useState } from "react";
import { Film } from "lucide-react";
import ModalShell from "./ModalShell";
import { toEmbedUrl } from "../lib/videoEmbed";

// Разбор путей 3.18: видео техники, которое тренер прикрепил к упражнению, клиент раньше не видел
// нигде. Кнопка у упражнения в программе и в тренировке; YouTube/Vimeo — встроенным плеером,
// фото — картинкой, другая https-ссылка — открыть в браузере.
export default function TechniqueButton({ url, name }: { url: string; name: string }) {
  const [open, setOpen] = useState(false);
  const link = typeof url === "string" ? url.trim() : "";
  if (!link) return null;
  const embed = toEmbedUrl(link);
  const image = /^data:image\//.test(link) || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(link);
  const safeHttp = /^https:\/\//i.test(link);
  if (!embed && !image && !safeHttp) return null;
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} className="shrink-0 h-8 px-2 inline-flex items-center gap-1 rounded-lg bg-zinc-800 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 transition" aria-label={`Техника: ${name}`}>
        <Film size={13} /> Техника
      </button>
      {open && (
        <ModalShell title={name || "Техника"} icon={<Film size={16} className="text-cyan-400" />} onClose={() => setOpen(false)}>
          <div className="p-4 space-y-3">
            {embed ? <iframe src={embed} className="w-full aspect-video rounded-xl bg-zinc-800" allowFullScreen title={`Видео: ${name}`} />
              : image ? <img src={link} alt={name} className="w-full rounded-xl" />
              : <a href={link} target="_blank" rel="noopener noreferrer" className="block text-center h-11 leading-[2.75rem] rounded-xl bg-zinc-800 text-sm font-semibold text-zinc-100">Открыть видео</a>}
          </div>
        </ModalShell>
      )}
    </>
  );
}
