import { useEffect, useState } from "react";
import { Camera, ClipboardList, Image, Sparkles, User, Users } from "lucide-react";
import * as trainerApi from "../lib/trainer";
import type { TrainerProfileData, TrainerStats } from "../lib/trainer";
import { fileToThumb } from "../lib/thumb";
import SubscriptionModal from "./SubscriptionModal";

export default function TrainerProfile({ trainerId, email, onSaved }: { trainerId: string; email: string; onSaved?: (name: string, avatarUrl: string) => void }) {
  const [profile, setProfile] = useState<TrainerProfileData | null>(null);
  const [brand, setBrand] = useState({ brand: "", logoUrl: "" });
  const [stats, setStats] = useState<TrainerStats | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [showSubscription, setShowSubscription] = useState(false);

  useEffect(() => {
    trainerApi.fetchTrainerSelf(trainerId).then((s) => { setProfile(s.profile); setBrand({ brand: s.brand, logoUrl: s.logoUrl }); });
    trainerApi.fetchTrainerStats(trainerId).then(setStats);
  }, [trainerId]);

  const onPhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !profile) return;
    if (!file.type.startsWith("image/")) { alert("Нужен файл изображения."); return; }
    if (file.size > 8 * 1024 * 1024) { alert("Файл слишком большой (макс. 8 МБ)."); return; }
    setProfile({ ...profile, avatarUrl: await fileToThumb(file) });
  };
  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Нужен файл изображения."); return; }
    if (file.size > 8 * 1024 * 1024) { alert("Файл слишком большой (макс. 8 МБ)."); return; }
    const thumb = await fileToThumb(file);
    setBrand((b) => ({ ...b, logoUrl: thumb }));
  };

  const saveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    try { await trainerApi.saveTrainerProfile(trainerId, profile); onSaved?.(profile.name, profile.avatarUrl); } finally { setSavingProfile(false); }
  };
  const saveBrand = async () => {
    setSavingBrand(true);
    try { await trainerApi.saveTrainerBrand(trainerId, brand); } finally { setSavingBrand(false); }
  };

  if (!profile || !stats) return <div className="text-zinc-500 text-sm p-4">Загрузка...</div>;

  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-lg font-bold flex items-center gap-1.5"><User size={18} className="text-lime-400" /> Профиль тренера</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-lg font-bold text-lime-400 flex items-center gap-1"><Users size={14} /> {stats.activeClients}</p><p className="text-[11px] text-zinc-500 mt-0.5">активных</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-lg font-bold text-zinc-100">{stats.totalClients}</p><p className="text-[11px] text-zinc-500 mt-0.5">всего клиентов</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-lg font-bold text-cyan-400 flex items-center gap-1"><ClipboardList size={14} /> {stats.plansCount}</p><p className="text-[11px] text-zinc-500 mt-0.5">планов</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3"><p className="text-lg font-bold text-orange-400">{stats.sessionsDone}</p><p className="text-[11px] text-zinc-500 mt-0.5">тренировок</p></div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border border-zinc-700" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 text-xl font-bold">{(profile.name || email)[0]?.toUpperCase()}</div>
          )}
          <label className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm transition cursor-pointer">
            <Camera size={15} /> Сменить фото
            <input type="file" accept="image/*" onChange={onPhotoFile} className="hidden" />
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-zinc-500">Имя
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Введите имя" className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
          <label className="text-xs text-zinc-500">Специализация
            <input value={profile.specialization} onChange={(e) => setProfile({ ...profile, specialization: e.target.value })} placeholder="Например, силовой тренинг" className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
        </div>
        <label className="text-xs text-zinc-500 block">О себе
          <textarea value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} rows={3} placeholder="Короткий рассказ о себе и подходе к тренировкам" className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40 resize-none" />
        </label>
        <div className="grid sm:grid-cols-3 gap-2">
          <label className="text-xs text-zinc-500">Телефон
            <input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="+7..." className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
          <label className="text-xs text-zinc-500">Telegram
            <input value={profile.telegram} onChange={(e) => setProfile({ ...profile, telegram: e.target.value })} placeholder="@username" className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
          <label className="text-xs text-zinc-500">WhatsApp
            <input value={profile.whatsapp} onChange={(e) => setProfile({ ...profile, whatsapp: e.target.value })} placeholder="+7..." className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
        </div>
        <button onClick={saveProfile} disabled={savingProfile} className="w-full bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:bg-lime-300 transition disabled:opacity-50">{savingProfile ? "Сохранение..." : "Сохранить профиль"}</button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <p className="text-sm text-zinc-400 flex items-center gap-1.5"><Image size={15} className="text-cyan-400" /> Бренд для PDF и портала клиента</p>
        <div className="flex items-center gap-3">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-zinc-700" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-600 text-xs">лого</div>
          )}
          <label className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm transition cursor-pointer">
            <Camera size={15} /> Загрузить логотип
            <input type="file" accept="image/*" onChange={onLogoFile} className="hidden" />
          </label>
        </div>
        <label className="text-xs text-zinc-500 block">Название бренда
          <input value={brand.brand} onChange={(e) => setBrand({ ...brand, brand: e.target.value })} placeholder="TrainerHub" className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-cyan-400/40" />
        </label>
        <button onClick={saveBrand} disabled={savingBrand} className="w-full bg-cyan-400 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:bg-cyan-300 transition disabled:opacity-50">{savingBrand ? "Сохранение..." : "Сохранить бренд"}</button>
      </div>

      <button onClick={() => setShowSubscription(true)} className="w-full flex items-center justify-center gap-2 bg-zinc-900 border border-lime-400/30 hover:border-lime-400/60 text-lime-400 font-semibold rounded-xl py-3 text-sm transition">
        <Sparkles size={16} /> Подписка на TrainerHub
      </button>

      {showSubscription && <SubscriptionModal onClose={() => setShowSubscription(false)} />}
    </div>
  );
}
