import { useEffect, useState } from "react";
import { ArrowLeft, Camera, ChevronDown, ChevronRight, ChevronUp, Database, Image, KeyRound, LayoutGrid, Lock, LogOut, Moon, Package, Palette, Pencil, Plus, RefreshCw, ScrollText, Sparkles, Sun, Trash, Trash2, User } from "lucide-react";
import * as trainerApi from "../lib/trainer";
import type { TrainerProfileData, TrainerStats } from "../lib/trainer";
import { fileToThumb } from "../lib/thumb";
import { supabase } from "../lib/supabase";
import SubscriptionModal from "./SubscriptionModal";
import { fetchPackageTemplates, savePackageTemplate, updatePackageTemplate, deletePackageTemplate, type PackageTemplate } from "../lib/payments";
import { checkForUpdate } from "../lib/swUpdate";
import { ScreenSkeleton } from "./Skeleton";

const SECTIONS = {
  personal: "Личные данные", packages: "Шаблоны пакетов", rules: "Правила для клиентов",
  brand: "Бренд для PDF и кабинета", accent: "Цвет и тема", tabs: "Нижняя панель", security: "PIN-код и пароль",
} as const;
type Section = keyof typeof SECTIONS;

export default function TrainerProfile({ trainerId, email, onSaved, themeMode, onThemeChange, tabs, onToggleTab, onMoveTab, onOpenPin, onOpenTrash, onOpenBackup, onSignOut }: { trainerId: string; email: string; onSaved?: (name: string, avatarUrl: string, accentColor?: string) => void; themeMode?: "dark" | "light"; onThemeChange?: (mode: "dark" | "light") => void; tabs?: { kind: string; label: string; icon: typeof User; visible: boolean }[]; onToggleTab?: (kind: string) => void; onMoveTab?: (kind: string, dir: -1 | 1) => void; onOpenPin?: () => void; onOpenTrash?: () => void; onOpenBackup?: () => void; onSignOut?: () => void }) {
  // Открытый раздел настроек; null — общий список
  const [section, setSection] = useState<Section | null>(null);
  // Раздел открывается с начала, а не с того места, где была строка в списке
  useEffect(() => { window.scrollTo(0, 0); }, [section]);
  const [updState, setUpdState] = useState<"idle" | "checking" | "latest" | "error">("idle");
  const [profile, setProfile] = useState<TrainerProfileData | null>(null);
  const [brand, setBrand] = useState({ brand: "", logoUrl: "" });
  const [stats, setStats] = useState<TrainerStats | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [showSubscription, setShowSubscription] = useState(false);
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [editingTpl, setEditingTpl] = useState<Record<string, PackageTemplate>>({});
  const [rawTpl, setRawTpl] = useState<Record<string, Record<string, string>>>({}); // raw strings while typing numeric fields
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    trainerApi.fetchTrainerSelf(trainerId).then((s) => { if (alive) { setProfile(s.profile); setBrand({ brand: s.brand, logoUrl: s.logoUrl }); } }).catch((e) => console.error("[TrainerProfile] fetchSelf:", e));
    trainerApi.fetchTrainerStats(trainerId).then((s) => { if (alive) setStats(s); }).catch((e) => console.error("[TrainerProfile] fetchStats:", e));
    fetchPackageTemplates(trainerId).then((t) => { if (alive) setTemplates(t); }).catch((e) => console.error("[TrainerProfile] fetchTemplates:", e));
    return () => { alive = false; };
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

  if (!profile || !stats) return <div className="p-4"><ScreenSkeleton avatar /></div>;

  return (
    <div className="space-y-4 max-w-2xl">
      {section ? (
        <>
          <div className="flex items-center gap-1 -ml-2.5">
            <button onClick={() => setSection(null)} aria-label="Назад к профилю" title="Назад" className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-zinc-300 hover:bg-zinc-800 transition"><ArrowLeft size={22} /></button>
            <h2 className="text-xl font-extrabold tracking-tight truncate">{SECTIONS[section]}</h2>
          </div>
          {section === "personal" && (
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
          )}
          {section === "brand" && (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
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
          <input value={brand.brand} onChange={(e) => setBrand({ ...brand, brand: e.target.value })} placeholder="Reps" className="w-full mt-0.5 bg-zinc-800 rounded-md px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-cyan-400/40" />
        </label>
        <button onClick={saveBrand} disabled={savingBrand} className="w-full bg-cyan-400 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:bg-cyan-300 transition disabled:opacity-50">{savingBrand ? "Сохранение..." : "Сохранить бренд"}</button>
      </div>
          )}
          {section === "accent" && (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
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
          )}
          {section === "tabs" && tabs && onToggleTab && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
          <p className="text-xs text-zinc-500">Галочка — показывать раздел, стрелки — порядок. «Главная» всегда первая.</p>
          <div className="space-y-0.5">
            {tabs.map((t, i) => (
              <div key={t.kind} className="flex items-center gap-1 rounded-lg hover:bg-zinc-800 transition">
                <label className="flex-1 flex items-center gap-2.5 px-2 py-2.5 cursor-pointer text-sm text-zinc-300">
                  <input type="checkbox" checked={t.visible} onChange={() => onToggleTab(t.kind)} className="accent-lime-400 w-4 h-4" />
                  <t.icon size={15} className="text-zinc-500 shrink-0" /> {t.label}
                </label>
                {onMoveTab && (
                  <>
                    <button onClick={() => onMoveTab(t.kind, -1)} disabled={i === 0} aria-label={`Переместить «${t.label}» выше`} className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 disabled:opacity-25 disabled:pointer-events-none transition"><ChevronUp size={18} /></button>
                    <button onClick={() => onMoveTab(t.kind, 1)} disabled={i === tabs.length - 1} aria-label={`Переместить «${t.label}» ниже`} className="w-10 h-10 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 disabled:opacity-25 disabled:pointer-events-none transition"><ChevronDown size={18} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
          )}
          {section === "rules" && (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
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
          )}
          {section === "security" && (
            <>
              {onOpenPin && (
                <button onClick={onOpenPin} className="w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 min-h-[56px] text-left hover:border-zinc-700 transition">
                  <Lock size={18} className="text-zinc-400 shrink-0" /><span className="flex-1 font-medium">PIN-код на вход</span><ChevronRight size={18} className="text-zinc-500 shrink-0" />
                </button>
              )}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
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
            </>
          )}
          {section === "packages" && (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
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
                <button onClick={() => deletePackageTemplate(t.id).then(() => setTemplates((p) => p.filter((x) => x.id !== t.id))).catch((e) => console.error("[TrainerProfile] deleteTemplate:", e))} className="p-1.5 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0" title="Удалить"><Trash2 size={14} /></button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-zinc-500">Тренировок
                  <input type="text" inputMode="numeric" value={rawTpl[t.id]?.sessions ?? String(draft.sessions || "")} onChange={(e) => setRawTpl(p => ({...p, [t.id]: {...p[t.id], sessions: e.target.value}}))} onBlur={() => { const v = Math.max(1, parseInt(rawTpl[t.id]?.sessions ?? "") || draft.sessions); setDraft({ sessions: v }); setRawTpl(p => ({...p, [t.id]: {...p[t.id], sessions: undefined as any}})); setTimeout(save, 0); }} className="w-full mt-0.5 bg-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
                </label>
                <label className="text-xs text-zinc-500">Цена пакета ₽
                  <input type="text" inputMode="numeric" value={rawTpl[t.id]?.price ?? String(draft.price || "")} onChange={(e) => setRawTpl(p => ({...p, [t.id]: {...p[t.id], price: e.target.value}}))} onBlur={() => { const v = parseInt(rawTpl[t.id]?.price ?? "") || 0; setDraft({ price: v }); setRawTpl(p => ({...p, [t.id]: {...p[t.id], price: undefined as any}})); setTimeout(save, 0); }} className="w-full mt-0.5 bg-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
                </label>
                <label className="text-xs text-zinc-500">Скидка %
                  <input type="text" inputMode="numeric" value={rawTpl[t.id]?.discount ?? String(draft.discount || "")} onChange={(e) => setRawTpl(p => ({...p, [t.id]: {...p[t.id], discount: e.target.value}}))} onBlur={() => { const v = Math.min(100, Math.max(0, parseInt(rawTpl[t.id]?.discount ?? "") || 0)); setDraft({ discount: v }); setRawTpl(p => ({...p, [t.id]: {...p[t.id], discount: undefined as any}})); setTimeout(save, 0); }} className="w-full mt-0.5 bg-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-lime-400/40" />
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
            fetchPackageTemplates(trainerId).then(setTemplates).catch((e) => console.error("[TrainerProfile] fetchTemplates:", e));
          }}
          className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg py-2 text-sm transition"
        >
          <Plus size={14} /> Добавить шаблон
        </button>
      </div>
          )}
        </>
      ) : (
        <>
          {/* Кто я: фото, имя, специализация; правка — по карандашу */}
          <div className="flex items-center gap-3.5 pt-1">
            {profile.avatarUrl
              ? <img src={profile.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
              : <div className="w-16 h-16 rounded-full bg-zinc-800 shrink-0 flex items-center justify-center text-2xl font-bold text-lime-400">{(profile.name || email)[0]?.toUpperCase()}</div>}
            <div className="min-w-0 flex-1">
              <p className="text-[22px] font-extrabold tracking-tight truncate">{profile.name || "Ваше имя"}</p>
              <p className="text-sm text-zinc-400 truncate">{profile.specialization || email}</p>
            </div>
            <button onClick={() => setSection("personal")} aria-label="Изменить личные данные" title="Изменить" className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition"><Pencil size={19} /></button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {([[stats.activeClients, "активных"], [stats.plansCount, "планов"], [stats.sessionsDone, "тренировок"]] as const).map(([v, l]) => (
              <div key={l} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
                <p className="text-[22px] font-extrabold tracking-tight">{v}</p>
                <p className="text-[13px] text-zinc-400">{l}</p>
              </div>
            ))}
          </div>

          <button onClick={() => setShowSubscription(true)} className="w-full flex items-center gap-3 bg-zinc-900 border border-lime-400/40 hover:border-lime-400/70 rounded-2xl p-3.5 text-left transition">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-lime-400/15 text-lime-400 flex items-center justify-center"><Sparkles size={20} /></span>
            <span className="flex-1 min-w-0"><span className="block font-bold">Подписка Reps</span><span className="block text-[13px] text-zinc-400">Тариф и оплата</span></span>
            <ChevronRight size={18} className="text-zinc-500 shrink-0" />
          </button>

          <SettingsGroup title="Работа">
            <SettingsRow icon={Package} label="Шаблоны пакетов" value={templates.length ? String(templates.length) : undefined} onClick={() => setSection("packages")} />
            <SettingsRow icon={ScrollText} label="Правила для клиентов" onClick={() => setSection("rules")} />
            <SettingsRow icon={Image} label="Бренд для PDF и кабинета" onClick={() => setSection("brand")} />
          </SettingsGroup>

          <SettingsGroup title="Оформление">
            <SettingsRow icon={Palette} label="Цвет акцента" value={<span className="w-[18px] h-[18px] rounded-full ring-2 ring-zinc-700" style={{ background: profile.accentColor || "#a3e635" }} />} onClick={() => setSection("accent")} />
            {onThemeChange && <SettingsRow icon={themeMode === "light" ? Sun : Moon} label="Тема" value={themeMode === "light" ? "Светлая" : "Тёмная"} onClick={() => onThemeChange(themeMode === "light" ? "dark" : "light")} />}
            {tabs && onToggleTab && <SettingsRow icon={LayoutGrid} label="Нижняя панель" value={`${tabs.filter((t) => t.visible).length} разд.`} onClick={() => setSection("tabs")} />}
          </SettingsGroup>

          <SettingsGroup title="Аккаунт">
            <SettingsRow icon={KeyRound} label="PIN-код и пароль" onClick={() => setSection("security")} />
            {onOpenBackup && <SettingsRow icon={Database} label="Бэкап" onClick={onOpenBackup} />}
            {onOpenTrash && <SettingsRow icon={Trash} label="Корзина" onClick={onOpenTrash} />}
            {/* B33: ручное обновление — на iOS браузер может долго не замечать новую версию */}
            <SettingsRow icon={RefreshCw} label="Обновления" spin={updState === "checking"}
              value={updState === "checking" ? "Проверяем…" : updState === "latest" ? "Последняя версия" : updState === "error" ? "Не удалось" : "Проверить"}
              onClick={async () => {
                if (updState === "checking") return;
                setUpdState("checking");
                const r = await checkForUpdate();
                // При "updating" страница перезагрузится сама, состояние менять незачем
                if (r === "latest" || r === "unsupported") setUpdState("latest");
                else if (r === "error") setUpdState("error");
              }} />
            {onSignOut && <SettingsRow icon={LogOut} label="Выйти" danger onClick={onSignOut} />}
          </SettingsGroup>
        </>
      )}
      {showSubscription && <SubscriptionModal onClose={() => setShowSubscription(false)} />}
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-zinc-500 mb-2 px-1">{title}</p>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800 overflow-hidden">{children}</div>
    </div>
  );
}

function SettingsRow({ icon: Icon, label, value, onClick, danger, spin }: { icon: typeof User; label: string; value?: React.ReactNode; onClick: () => void; danger?: boolean; spin?: boolean }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 min-h-[54px] text-left hover:bg-zinc-800/40 transition">
      <span className={`w-8 h-8 shrink-0 rounded-lg bg-zinc-800 flex items-center justify-center ${danger ? "text-red-400" : "text-zinc-100"}`}><Icon size={17} className={spin ? "animate-spin" : ""} /></span>
      <span className={`flex-1 min-w-0 font-medium truncate ${danger ? "text-red-400" : ""}`}>{label}</span>
      {value != null && (typeof value === "string" ? <span className="text-sm text-zinc-500 shrink-0">{value}</span> : value)}
      {!danger && <ChevronRight size={18} className="text-zinc-500 shrink-0" />}
    </button>
  );
}
