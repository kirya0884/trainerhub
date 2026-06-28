import { useState } from "react";
import { Camera, Settings } from "lucide-react";
import ModalShell from "./ModalShell";
import * as portalApi from "../lib/clientPortal";
import { fileToThumb } from "../lib/thumb";

export const ACCENT_COLORS = ["#22d3ee", "#a3e635", "#fb923c", "#f472b6", "#a78bfa", "#facc15"];

export interface ClientProfileFields { phone: string; telegram: string; whatsapp: string; avatarUrl: string; accentColor: string }

export default function ClientSettingsModal({ clientId, initial, onClose, onSaved }: {
  clientId: string; initial: ClientProfileFields; onClose: () => void; onSaved: (p: ClientProfileFields) => void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  const onAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Нужен файл изображения."); return; }
    if (file.size > 8 * 1024 * 1024) { alert("Файл слишком большой (макс. 8 МБ)."); return; }
    const thumb = await fileToThumb(file);
    setForm((p) => ({ ...p, avatarUrl: thumb }));
  };

  const save = async () => {
    setBusy(true);
    try { await portalApi.updateSelfProfile(clientId, form); onSaved(form); onClose(); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title="Настройки профиля" icon={<Settings size={17} style={{ color: form.accentColor }} />} onClose={onClose}>
      <div className="p-4 space-y-3 text-sm">
        <div className="flex items-center gap-3">
          {form.avatarUrl ? (
            <img src={form.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border border-zinc-700" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 text-xl font-bold">?</div>
          )}
          <label className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm transition cursor-pointer">
            <Camera size={15} /> Сменить фото
            <input type="file" accept="image/*" onChange={onAvatarFile} className="hidden" />
          </label>
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">Телефон</label>
          <input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+7..." className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": form.accentColor } as React.CSSProperties} />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">Telegram</label>
          <input value={form.telegram} onChange={(e) => setForm((p) => ({ ...p, telegram: e.target.value }))} placeholder="@username" className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": form.accentColor } as React.CSSProperties} />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">WhatsApp</label>
          <input value={form.whatsapp} onChange={(e) => setForm((p) => ({ ...p, whatsapp: e.target.value }))} placeholder="+7..." className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]" style={{ "--accent": form.accentColor } as React.CSSProperties} />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">Цвет акцента в приложении</label>
          <div className="flex gap-2">
            {ACCENT_COLORS.map((c) => (
              <button key={c} onClick={() => setForm((p) => ({ ...p, accentColor: c }))} className="w-8 h-8 rounded-full border-2 transition" style={{ background: c, borderColor: form.accentColor === c ? "#fff" : "transparent" }} aria-label={c} />
            ))}
          </div>
        </div>
        <button onClick={save} disabled={busy} className="w-full text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:opacity-90 transition disabled:opacity-50" style={{ background: form.accentColor }}>
          {busy ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </ModalShell>
  );
}
