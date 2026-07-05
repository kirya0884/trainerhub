import { useState } from "react";
import { Camera, Settings } from "lucide-react";
import ModalShell from "./ModalShell";
import * as portalApi from "../lib/clientPortal";
import { fileToThumb } from "../lib/thumb";
import { GOALS } from "../constants";

export const ACCENT_COLORS = ["#22d3ee", "#a3e635", "#fb923c", "#f472b6", "#a78bfa", "#facc15", "#34d399", "#f87171", "#60a5fa", "#e879f9"];

export interface ClientProfileFields {
  phone: string; telegram: string; whatsapp: string; avatarUrl: string; accentColor: string;
  name: string; goal: string;
  health: { injuries: string; restrictions: string; notes: string };
}

export default function ClientSettingsModal({ clientId, initial, onClose, onSaved }: {
  clientId: string; initial: ClientProfileFields; onClose: () => void; onSaved: (p: ClientProfileFields) => void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  const patchHealth = (patch: Partial<typeof form.health>) => setForm((p) => ({ ...p, health: { ...p.health, ...patch } }));

  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Нужен файл изображения."); return; }
    if (file.size > 8 * 1024 * 1024) { alert("Файл слишком большой (макс. 8 МБ)."); return; }
    setForm((p) => ({ ...p, avatarUrl: "" }));
    const thumb = await fileToThumb(file);
    setForm((p) => ({ ...p, avatarUrl: thumb }));
  };

  const save = async () => {
    setBusy(true);
    try {
      await portalApi.updateSelfProfile(clientId, {
        phone: form.phone, telegram: form.telegram, whatsapp: form.whatsapp,
        avatarUrl: form.avatarUrl, accentColor: form.accentColor,
        name: form.name, goal: form.goal, health: form.health,
      });
      onSaved(form);
      onClose();
    } finally { setBusy(false); }
  };

  const accent = form.accentColor;

  return (
    <ModalShell title="Настройки профиля" icon={<Settings size={17} style={{ color: accent }} />} onClose={onClose}>
      <div className="p-4 space-y-4 text-sm">
        {/* Фото */}
        <div className="flex items-center gap-3">
          {form.avatarUrl ? (
            <img src={form.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border border-zinc-700" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 text-xl font-bold">{form.name?.[0] || "?"}</div>
          )}
          <label className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm transition cursor-pointer">
            <Camera size={15} /> Сменить фото
            <input type="file" accept="image/*" onChange={onAvatarFile} className="hidden" />
          </label>
        </div>

        {/* Основные */}
        <div className="grid grid-cols-1 gap-2">
          <label className="block text-xs text-zinc-500">Имя
            <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Ваше имя" className="w-full mt-0.5 bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accent } as React.CSSProperties} />
          </label>
          <label className="block text-xs text-zinc-500">Цель
            <select value={form.goal} onChange={(e) => setForm((p) => ({ ...p, goal: e.target.value }))} className="w-full mt-0.5 bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accent } as React.CSSProperties}>
              <option value="">— не указана —</option>
              {GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        </div>

        {/* Контакты */}
        <div className="space-y-2">
          <p className="text-xs text-zinc-500 font-medium">Контакты</p>
          <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Телефон +7..." className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accent } as React.CSSProperties} />
          <input value={form.telegram} onChange={(e) => setForm((p) => ({ ...p, telegram: e.target.value }))} placeholder="Telegram @username" className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accent } as React.CSSProperties} />
          <input value={form.whatsapp} onChange={(e) => setForm((p) => ({ ...p, whatsapp: e.target.value }))} placeholder="WhatsApp +7..." className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accent } as React.CSSProperties} />
        </div>

        {/* Здоровье */}
        <div className="space-y-2">
          <p className="text-xs text-zinc-500 font-medium">Здоровье</p>
          <input value={form.health.injuries} onChange={(e) => patchHealth({ injuries: e.target.value })} placeholder="Травмы / ограничения" className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accent } as React.CSSProperties} />
          <input value={form.health.restrictions} onChange={(e) => patchHealth({ restrictions: e.target.value })} placeholder="Противопоказания" className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accent } as React.CSSProperties} />
          <input value={form.health.notes} onChange={(e) => patchHealth({ notes: e.target.value })} placeholder="Заметки о здоровье" className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": accent } as React.CSSProperties} />
        </div>

        {/* Цвет */}
        <div className="space-y-2">
          <p className="text-xs text-zinc-500 font-medium">Цвет акцента</p>
          <div className="flex items-center gap-2 flex-wrap">
            {ACCENT_COLORS.map((c) => (
              <button key={c} onClick={() => setForm((p) => ({ ...p, accentColor: c }))} className="w-7 h-7 rounded-full border-2 transition shrink-0" style={{ background: c, borderColor: form.accentColor === c ? "#fff" : "transparent" }} />
            ))}
            <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
              <input type="color" value={form.accentColor} onChange={(e) => setForm((p) => ({ ...p, accentColor: e.target.value }))} className="w-7 h-7 rounded-full cursor-pointer border-0 bg-transparent p-0" />
              <span>Свой</span>
            </label>
          </div>
        </div>

        <button onClick={save} disabled={busy} className="w-full text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 transition disabled:opacity-50" style={{ background: accent }}>
          {busy ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </ModalShell>
  );
}
