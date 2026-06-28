import { BookOpen, ChevronLeft, Film, Info, Plus, Search, Camera } from "lucide-react";
import { useEffect, useState } from "react";
import { BUILTIN_EXERCISES, LIB_GROUP_ORDER, type BuiltinExercise } from "../data/exerciseLibrary";
import * as libraryApi from "../lib/library";
import { fileToThumb } from "../lib/thumb";
import ModalShell from "./ModalShell";

type Item = BuiltinExercise & { custom?: boolean };

// Видео-ссылку (YouTube и т.п.) показываем как iframe, остальное (data URL фото) — как картинку.
const isVideoUrl = (url: string) => /youtube\.com|youtu\.be|vimeo\.com/.test(url);
const toEmbedUrl = (url: string) => url.replace(/youtu\.be\/([\w-]+)/, "youtube.com/embed/$1").replace("watch?v=", "embed/");

export default function LibraryModal({ trainerId, customNames, addToLibrary, onPick, onClose }: {
  trainerId: string; customNames: string[]; addToLibrary: (name: string) => void; onPick: (name: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("Все");
  const [detail, setDetail] = useState<Item | null>(null);
  const [custom, setCustom] = useState("");
  const [media, setMedia] = useState<Record<string, string>>({});
  const [mediaUrlInput, setMediaUrlInput] = useState("");

  useEffect(() => { libraryApi.fetchExerciseMedia(trainerId).then(setMedia); }, [trainerId]);
  useEffect(() => { setMediaUrlInput(detail ? media[detail.name] || "" : ""); }, [detail, media]);

  const saveMedia = async (name: string, url: string) => {
    await libraryApi.setExerciseMedia(trainerId, name, url);
    setMedia((m) => ({ ...m, [name]: url }));
  };
  const onMediaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !detail) return;
    if (!file.type.startsWith("image/")) { alert("Нужен файл изображения."); return; }
    if (file.size > 8 * 1024 * 1024) { alert("Файл слишком большой (макс. 8 МБ)."); return; }
    const thumb = await fileToThumb(file);
    setMediaUrlInput(thumb);
    await saveMedia(detail.name, thumb);
  };

  const groups = ["Все", ...LIB_GROUP_ORDER, ...(customNames.length ? ["Мои"] : [])];
  const items: Item[] = [...BUILTIN_EXERCISES, ...customNames.map((name) => ({ name, group: "Мои", equipment: "", primary: "", secondary: "", type: "", cues: [], level: "", description: "", notes: "", custom: true }))];
  const filtered = items.filter((i) => (group === "Все" || i.group === group) && i.name.toLowerCase().includes(q.toLowerCase()));
  const saveCustom = () => { const n = custom.trim(); if (!n) return; addToLibrary(n); onPick(n); setCustom(""); };

  return (
    <ModalShell title={detail ? "Упражнение" : "Библиотека упражнений"} icon={<BookOpen size={17} className="text-lime-400" />} onClose={onClose} wide
      footer={!detail && (
        <div className="border-t border-zinc-800 shrink-0">
          <div className="p-3 flex gap-2">
            <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveCustom()} placeholder="Добавить своё упражнение..." className="flex-1 min-w-0 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
            <button onClick={saveCustom} className="bg-zinc-700 text-zinc-100 font-medium rounded-lg px-3 text-sm hover:bg-zinc-600 transition shrink-0">+ Своё</button>
          </div>
        </div>
      )}>
      {detail ? (
        <div className="p-4 overflow-y-auto flex-1 min-h-0 space-y-4">
          <button onClick={() => setDetail(null)} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100 transition"><ChevronLeft size={16} /> К списку</button>
          <h2 className="text-lg font-bold">{detail.name}</h2>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs bg-lime-400/15 text-lime-400 rounded-full px-2.5 py-1">{detail.group}</span>
            {detail.type && <span className="text-xs bg-zinc-800 text-zinc-300 rounded-full px-2.5 py-1">{detail.type}</span>}
            {detail.equipment && <span className="text-xs bg-zinc-800 text-zinc-300 rounded-full px-2.5 py-1">{detail.equipment}</span>}
            {detail.level && <span className="text-xs bg-cyan-400/15 text-cyan-400 rounded-full px-2.5 py-1">{detail.level}</span>}
          </div>
          {detail.description && <p className="text-sm text-zinc-300">{detail.description}</p>}
          {detail.primary && <div className="text-sm"><span className="text-zinc-500">Основные мышцы: </span><span className="text-zinc-200">{detail.primary}</span></div>}
          {detail.secondary && detail.secondary !== "—" && <div className="text-sm"><span className="text-zinc-500">Вспомогательные: </span><span className="text-zinc-200">{detail.secondary}</span></div>}
          <div className="space-y-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><Film size={15} className="text-cyan-400" /> Фото/видео техники</p>
            {media[detail.name] && (
              isVideoUrl(media[detail.name]) ? (
                <div className="aspect-video rounded-lg overflow-hidden bg-zinc-800"><iframe src={toEmbedUrl(media[detail.name])} className="w-full h-full" allowFullScreen /></div>
              ) : (
                <img src={media[detail.name]} alt="" className="max-h-56 rounded-lg border border-zinc-700" />
              )
            )}
            <div className="flex gap-2">
              <input value={mediaUrlInput} onChange={(e) => setMediaUrlInput(e.target.value)} onBlur={() => mediaUrlInput !== (media[detail.name] || "") && saveMedia(detail.name, mediaUrlInput)} placeholder="Ссылка на видео (YouTube) или фото" className="flex-1 min-w-0 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-400/40" />
              <label className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg px-3 text-sm transition cursor-pointer shrink-0">
                <Camera size={15} />
                <input type="file" accept="image/*" onChange={onMediaFile} className="hidden" />
              </label>
            </div>
          </div>
          {detail.cues?.length > 0 ? (
            <div>
              <p className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Info size={15} className="text-lime-400" /> Методические указания</p>
              <ul className="space-y-1.5">{detail.cues.map((c, i) => <li key={i} className="text-sm text-zinc-300 flex gap-2"><span className="text-lime-400 shrink-0">•</span> {c}</li>)}</ul>
            </div>
          ) : <p className="text-sm text-zinc-600">Для своего упражнения методичка не задана.</p>}
          {detail.notes && <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">⚠ {detail.notes}</p>}
          <button onClick={() => { onPick(detail.name); setDetail(null); }} className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:bg-lime-300 transition flex items-center justify-center gap-1.5"><Plus size={16} /> Добавить в день</button>
        </div>
      ) : (
        <>
          <div className="p-3 border-b border-zinc-800 space-y-2 shrink-0">
            <div className="relative"><Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск упражнения..." className="w-full bg-zinc-800 rounded-lg pl-8 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" /></div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">{groups.map((g) => (<button key={g} onClick={() => setGroup(g)} className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${group === g ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"}`}>{g}</button>))}</div>
          </div>
          <div className="p-3 overflow-y-auto flex-1 min-h-0 space-y-1.5">
            {filtered.map((i) => (
              <div key={i.name + i.group} className="flex items-center gap-2 bg-zinc-800/40 rounded-lg px-3 py-2 hover:bg-zinc-800/70 transition">
                <button onClick={() => setDetail(i)} className="flex-1 min-w-0 text-left"><p className="text-sm font-medium truncate flex items-center gap-1.5">{i.name}{media[i.name] && <Film size={12} className="text-cyan-400 shrink-0" />}</p><p className="text-[11px] text-zinc-500 truncate">{[i.group, i.equipment].filter(Boolean).join(" · ") || "своё"}</p></button>
                <button onClick={() => setDetail(i)} className="p-1.5 rounded-md hover:bg-zinc-700 text-zinc-400 transition shrink-0" title="Подробнее"><Info size={15} /></button>
                <button onClick={() => onPick(i.name)} className="p-1.5 rounded-md bg-lime-400/15 text-lime-400 hover:bg-lime-400/25 transition shrink-0" title="Добавить в день"><Plus size={15} /></button>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-sm text-zinc-600 text-center py-6">Ничего не найдено. Можно добавить своё упражнение внизу.</p>}
          </div>
        </>
      )}
    </ModalShell>
  );
}
