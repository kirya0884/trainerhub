import { useEffect, useState } from "react";
import { Camera, ClipboardList, Image, KeyRound, LogOut, Moon, Package, Palette, Plus, ScrollText, Sparkles, Sun, Trash2, User, Users } from "lucide-react";
import * as trainerApi from "../lib/trainer";
import type { TrainerProfileData, TrainerStats } from "../lib/trainer";
import { fileToThumb } from "../lib/thumb";
import { supabase } from "../lib/supabase";
import SubscriptionModal from "./SubscriptionModal";
import { fetchPackageTemplates, savePackageTemplate, updatePackageTemplate, deletePackageTemplate, type PackageTemplate } from "../lib/payments";

export default function TrainerProfile({ trainerId, email, onSaved, themeMode, onThemeChange }: { trainerId: string; email: string; onSaved?: (name: string, avatarUrl: string, accentColor?: string) => void; themeMode?: "dark" | "light"; onThemeChange?: (mode: "dark" | "light") => void }) {
  const [profile, setProfile] = useState<TrainerProfileData | null>(null);
  const [brand, setBrand] = useState({ brand: "", logoUrl: "" });
  const [stats, setStats] = useState<TrainerStats | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [showSubscription, setShowSubscription] = useState(false);
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [editingTpl, setEditingTpl] = useState<Record<string, PackageTemplate>>({});
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    trainerApi.fetchTrainerSelf(trainerId).then((s) => { setProfile(s.profile); setBrand({ brand: s.brand, logoUrl: s.logoUrl }); });
    trainerApi.fetchTrainerStats(trainerId).then(setStats);
    fetchPackageTemplates(trainerId).then(setTemplates);
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

      <button onClick={() => setShowSubscription(true)} className="w-full flex items-center justify-center gap-2 bg-zinc-900 border border-lime-400/30 hover:border-lime-400/60 text-lime-400 font-semibold rounded-xl py-3 text-sm transition">
        <Sparkles size={16} /> Подписка на TrainerHub
      </button>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><p className="text-2xl font-bold text-lime-400 flex items-center gap-1.5"><Users size={16} /> {stats.activeClients}</p><p className="text-xs text-zinc-500 mt-1">активных</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><p className="text-2xl font-bold text-zinc-100">{stats.totalClients}</p><p className="text-xs text-zinc-500 mt-1">всего клиентов</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><p className="text-2xl font-bold text-cyan-400 flex items-center gap-1.5"><ClipboardList size={16} /> {stats.plansCount}</p><p className="text-xs text-zinc-500 mt-1">планов</p></div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"><p className="text-2xl font-bold text-orange-400">{stats.sessionsDone}</p><p className="text-xs text-zinc-500 mt-1">тренировок</p></div>
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
        <button onClick={saveProfile} disabled={savingProfile} className="w-full text-zinc-950 font-semibold rounded-lg py-2.5 text-sm transition disabled:opacity-50" style={{ background: "var(--accent)" }}>{savingProfile ? "Сохранение..." : "Сохранить профиль"}</button>
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

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <p className="text-sm text-zinc-400 flex items-center gap-1.5"><Palette size={15} className="text-lime-400" /> Цвет и тема интерфейса</p>
        <div className="flex flex-wrap gap-2">
          {["#a3e635","#22d3ee","#fb923c","#f472b6","#a78bfa","#facc15","#34d399","#f87171","#60a5fa","#e879f9"].map((c) => (
            <button key={c} onClick={() => setProfile({ ...profile, accentColor: c })} className="w-8 h-8 rounded-full border-2 transition" style={{ background: c, borderColor: profile.accentColor === c ? "#fff" : "transparent" }} title={c} />
          ))}
        </div>
        {onThemeChange && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Тема интерфейса</span>
            <button onClick={() => onThemeChange(themeMode === "light" ? "dark" : "light")} className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 transition">
              {themeMode === "light" ? <Moon size={14} /> : <Sun size={14} />}
              {themeMode === "light" ? "Тёмная" : "Светлая"}
            </button>
          </div>
        )}
        <button onClick={async () => { setSavingRules(true); try { await trainerApi.saveTrainerProfile(trainerId, profile); onSaved?.(profile.name, profile.avatarUrl, profile.accentColor); } finally { setSavingRules(false); } }} disabled={savingRules} className="w-full text-zinc-950 font-semibold rounded-lg py-2 text-sm transition disabled:opacity-50" style={{ background: "var(--accent)" }}>{savingRules ? "Сохранение..." : "Сохранить цвет"}</button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <p className="text-sm text-zinc-400 flex items-center gap-1.5"><ScrollText size={15} className="text-lime-400" /> Правила проведения и списания тренировок</p>
        <p className="text-xs text-zinc-500">Эти правила видят все ваши подопечные в личном кабинете</p>
        <textarea
          value={profile.trainingRules}
          onChange={(e) => setProfile({ ...profile, trainingRules: e.target.value })}
          rows={6}
          placeholder={"Например:\n• Тренировка списывается при отмене менее чем за 24 часа\n• Пакет действителен 3 месяца с даты оплаты\n• Перенос возможен не более 2 раз в месяц"}
          className="w-full bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40 resize-none"
        />
        <button onClick={async () => { setSavingRules(true); try { await trainerApi.saveTrainerProfile(trainerId, profile); } finally { setSavingRules(false); } }} disabled={savingRules} className="w-full text-zinc-950 font-semibold rounded-lg py-2 text-sm transition disabled:opacity-50" style={{ background: "var(--accent)" }}>{savingRules ? "Сохранение..." : "Сохранить правила"}</button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <p className="text-sm text-zinc-400 flex items-center gap-1.5"><KeyRound size={15} className="text-orange-400" /> Аккаунт</p>
        <p className="text-xs text-zinc-500">Email: <span className="text-zinc-300">{email}</span></p>
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">Сменить пароль</p>
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Новый пароль" className="w-full bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="Повтори пароль" className="w-full bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
          {pwMsg && <p className="text-xs text-cyan-400">{pwMsg}</p>}
          <button
            disabled={pwBusy || !newPw}
            onClick={async () => {
              if (newPw.length < 6) { setPwMsg("Минимум 6 символов"); return; }
              if (newPw !== newPw2) { setPwMsg("Пароли не совпадают"); return; }
              setPwBusy(true); setPwMsg("");
              const { error } = await supabase.auth.updateUser({ password: newPw });
              if (error) setPwMsg(error.message);
              else { setPwMsg("Пароль изменён"); setNewPw(""); setNewPw2(""); }
              setPwBusy(false);
            }}
            className="w-full bg-zinc-700 hover:bg-zinc-600 text-zinc-100 font-medium rounded-lg py-2 text-sm transition disabled:opacity-50"
          >
            {pwBusy ? "Сохранение..." : "Сменить пароль"}
          </button>
        </div>
        <button
          onClick={async () => {
            if (!window.confirm("Выйти из аккаунта на всех устройствах?")) return;
            await supabase.auth.signOut({ scope: "global" });
          }}
          className="w-full flex items-center justify-center gap-1.5 text-sm text-zinc-500 hover:text-red-400 transition py-1"
        >
          <LogOut size={14} /> Выйти на всех устройствах
        </button>
      </div>


      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <p className="text-sm text-zinc-400 flex items-center gap-1.5"><Package size={15} className="text-lime-400" /> Шаблоны пакетов тренировок</p>
        <p className="text-xs text-zinc-500">Создайте шаблоны один раз — применяйте в карточке подопечного одним кликом</p>
        {templates.map((t) => {
          const draft = editingTpl[t.id] ?? t;
          const setDraft = (p: Partial<PackageTemplate>) => setEditingTpl((prev) => ({ ...prev, [t.id]: { ...draft, ...p } }));
          const save = async () => {
            await updatePackageTemplate(t.id, draft);
            setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...draft } : x)));
            setEditingTpl((prev) => { const n = { ...prev }; delete n[t.id]; return n; });
          };
          return (
            <div key={t.id} className="bg-zinc-800/60 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} onBlur={save} className="flex-1 bg-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" placeholder="Название" />
                <button onClick={() => deletePackageTemplate(t.id).then(() => setTemplates((p) => p.filter((x) => x.id !== t.id)))} className="p-1.5 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0" title="Удалить"><Trash2 size={14} /></button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-zinc-500">Тренировок
                  <input type="number" value={draft.sessions} onChange={(e) => setDraft({ sessions: Number(e.target.value) })} onBlur={save} min={1} className="w-full mt-0.5 bg-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
                </label>
                <label className="text-xs text-zinc-500">Цена пакета ₽
                  <input type="number" value={draft.price} onChange={(e) => setDraft({ price: Number(e.target.value) })} onBlur={save} min={0} className="w-full mt-0.5 bg-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
                </label>
                <label className="text-xs text-zinc-500">Скидка %
                  <input type="number" value={draft.discount} onChange={(e) => setDraft({ discount: Number(e.target.value) })} onBlur={save} min={0} max={100} className="w-full mt-0.5 bg-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
                </label>
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input type="checkbox" checked={draft.split} onChange={(e) => { setDraft({ split: e.target.checked }); setTimeout(save, 0); }} className="accent-cyan-400" />
                  Сплит на двоих
                </label>
                {draft.discount > 0 && draft.price > 0 && (
                  <span className="text-xs text-lime-400">{Math.round(draft.price * (1 - draft.discount / 100)).toLocaleString("ru-RU")}₽ после скидки</span>
                )}
              </div>
            </div>
          );
        })}
        <button
          onClick={async () => {
            await savePackageTemplate(trainerId, { name: "Новый пакет", sessions: 8, price: 0, discount: 0, split: false });
            fetchPackageTemplates(trainerId).then(setTemplates);
          }}
          className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg py-2 text-sm transition"
        >
          <Plus size={14} /> Добавить шаблон
        </button>
      </div>

      {showSubscription && <SubscriptionModal onClose={() => setShowSubscription(false)} />}
    </div>
  );
}
