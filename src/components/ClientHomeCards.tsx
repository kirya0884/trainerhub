import { useEffect, useState } from "react";
import { Bell, Download, MessageCircle, MessageSquare, Phone, Send, X } from "lucide-react";
import type { TrainerCard } from "../lib/clientPortal";
import type { ProgressNote, Session } from "../types";
import { addDays, fmtDate, today, waPhone } from "../lib/format";
import { canPromptInstall, isIOS, isInAppBrowser, isStandalone, onInstallChange, promptInstall } from "../lib/install";
import { notify } from "../lib/dialog";

// Карточки главной кабинета клиента (разбор путей, группа 4): связь с тренером, установка
// на экран «Домой», включение напоминаний и отклики тренера. Отдельно от ClientPortal,
// чтобы тот не рос дальше.

// Только ник Telegram: ссылкой на произвольный сайт кнопку «Написать тренеру» не подменить
const tgHref = (t: string) => {
  const nick = t.trim().replace(/^https?:\/\//i, "").replace(/^(www\.)?(t\.me|telegram\.me)\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]{5,32}$/.test(nick) ? `https://t.me/${nick}` : "";
};
const readFlag = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeFlag = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } };

/** Ссылка в мессенджер тренера; text — подставится в WhatsApp (Telegram по нику текст не принимает) */
export function trainerLinks(t: TrainerCard, text = "") {
  const enc = text ? `?text=${encodeURIComponent(text)}` : "";
  return {
    tg: t.telegram ? tgHref(t.telegram) : "",
    wa: waPhone(t.whatsapp || t.phone) ? `https://wa.me/${waPhone(t.whatsapp || t.phone)}${enc}` : "",
    tel: t.phone ? `tel:${t.phone.replace(/[^\d+]/g, "")}` : "",
  };
}

// 5.22: «Написать тренеру» — контактов тренера в кабинете не было вовсе
export function TrainerContactCard({ trainer }: { trainer: TrainerCard }) {
  const l = trainerLinks(trainer);
  if (!l.tg && !l.wa && !l.tel) return null;
  const btn = "flex-1 h-11 flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition";
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 space-y-2.5">
      <div className="flex items-center gap-2.5">
        {trainer.avatarUrl ? <img src={trainer.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" /> : null}
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">Твой тренер</p>
          <p className="font-semibold truncate">{trainer.name || trainer.brand}</p>
        </div>
      </div>
      <div className="flex gap-2">
        {l.tg && <a href={l.tg} target="_blank" rel="noopener noreferrer" className={`${btn} bg-sky-500/15 text-sky-300 hover:bg-sky-500/25`}><Send size={15} /> Telegram</a>}
        {l.wa && <a href={l.wa} target="_blank" rel="noopener noreferrer" className={`${btn} bg-green-500/15 text-green-300 hover:bg-green-500/25`}><MessageCircle size={15} /> WhatsApp</a>}
        {l.tel && <a href={l.tel} className={`${btn} bg-zinc-800 text-zinc-100 hover:bg-zinc-700 !flex-none w-11`} aria-label="Позвонить тренеру"><Phone size={16} /></a>}
      </div>
    </div>
  );
}

// 1.9: клиент приходит по ссылке из мессенджера и остаётся в его встроенном браузере —
// без установки нет офлайна и уведомлений, а закрыв окно, он не найдёт Reps.
const INSTALL_KEY = "reps-install-card-hidden";
/** Подсказка установки ещё показывается — тогда другие подсказки ждут (по одной за раз) */
export const installCardShown = () => !isStandalone() && readFlag(INSTALL_KEY) !== "1";
export function InstallCard({ email }: { email: string }) {
  const KEY = INSTALL_KEY;
  const [hidden, setHidden] = useState(() => !installCardShown());
  const [, force] = useState(0);
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);
  if (hidden) return null;
  const close = () => { writeFlag(KEY, "1"); setHidden(true); };
  return (
    <div className="relative bg-zinc-900 border border-lime-400/30 rounded-2xl p-4 space-y-2 text-sm">
      <button onClick={close} aria-label="Скрыть" className="absolute right-2 top-2 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200"><X size={16} /></button>
      <p className="font-semibold pr-8">Добавь Reps на экран «Домой»</p>
      {isInAppBrowser() ? (
        <p className="text-zinc-400">Ты в браузере мессенджера — отсюда приложение не установить. Нажми «⋯» вверху и выбери «Открыть в браузере» ({isIOS() ? "Safari" : "Chrome"}), там войди снова.</p>
      ) : isIOS() ? (
        <p className="text-zinc-400">В Safari нажми «Поделиться» внизу экрана, затем «На экран „Домой“». Так программа откроется и без интернета.</p>
      ) : canPromptInstall() ? (
        <button onClick={async () => { if (await promptInstall()) close(); }} className="w-full h-11 flex items-center justify-center gap-1.5 rounded-xl bg-lime-400 text-zinc-950 font-bold hover:bg-lime-300 transition"><Download size={16} /> Установить</button>
      ) : (
        <p className="text-zinc-400">В меню браузера «⋮» выбери «Установить приложение» или «Добавить на главный экран».</p>
      )}
      {email && <p className="text-xs text-zinc-500">Твой логин для входа: <span className="text-zinc-300">{email}</span></p>}
    </div>
  );
}

// 0.5: разрешение на уведомления — по нажатию и с объяснением, а не сразу при открытии
// (на iOS без нажатия запрос и не сработает, а после отказа включить негде)
export function NotifyCard() {
  const KEY = "reps-notify-card-hidden";
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [state, setState] = useState(() => (supported ? Notification.permission : "denied"));
  const [hidden, setHidden] = useState(() => readFlag(KEY) === "1");
  if (!supported || state !== "default" || hidden) return null;
  const enable = async () => {
    const r = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
    setState(r);
    if (r === "denied") notify("Уведомления выключены. Включить их можно в настройках браузера или телефона.", "info");
  };
  return (
    <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
      <Bell size={18} className="text-zinc-400 shrink-0" />
      <p className="flex-1 text-sm text-zinc-300">Напоминать о тренировках и когда заканчивается абонемент?</p>
      <button onClick={enable} className="shrink-0 h-10 px-3 rounded-xl bg-zinc-800 text-zinc-100 text-sm font-semibold hover:bg-zinc-700 transition">Включить</button>
      <button onClick={() => { writeFlag(KEY, "1"); setHidden(true); }} aria-label="Не сейчас" className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200"><X size={16} /></button>
    </div>
  );
}

// 5.24: отклики тренера были разбросаны (заметки внизу «Прогресса», отзыв в строке истории) и
// без «новое». Здесь — последние за 30 дней; «новое» — то, что появилось с прошлого показа.
export function FromTrainer({ clientId, notes, sessions }: { clientId: string; notes: ProgressNote[]; sessions: Session[] }) {
  // Что уже показывали — по ключам записей, а не по дате: отзыв на вчерашнюю тренировку,
  // написанный сегодня, тоже «новое»
  const KEY = `reps-from-trainer-seen-v2-${clientId}`;
  const [seen] = useState<string[] | null>(() => { try { return JSON.parse(readFlag(KEY) || "null"); } catch { return null; } });
  const since = addDays(today(), -30);
  const items = [
    ...notes.filter((n) => n.date >= since).map((n) => ({ key: `n${n.id}`, date: n.date, text: n.text, what: "Заметка" })),
    ...sessions.filter((s) => !s.fromClient && s.review && s.date >= since).map((s) => ({ key: `s${s.id}`, date: s.date, text: s.review, what: `Отзыв о тренировке «${s.dayName}»` })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  // Запоминаем показ чуть позже: «новое» должно успеть попасться на глаза
  useEffect(() => {
    if (!items.length) return;
    const keys = items.map((i) => i.key);
    const t = setTimeout(() => writeFlag(KEY, JSON.stringify([...new Set([...keys, ...(seen ?? [])])].slice(0, 60))), 3000);
    return () => clearTimeout(t);
  }, [items.map((i) => i.key).join(), KEY]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-[17px] font-bold mt-2 mb-2 px-0.5">От тренера</h3>
      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.key} className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm">
            <p className="text-xs text-zinc-500 flex items-center gap-1.5">
              <MessageSquare size={12} /> {it.what} · {fmtDate(it.date)}
              {seen && !seen.includes(it.key) && <span className="ml-auto text-[11px] font-semibold text-lime-400 bg-lime-400/15 rounded-full px-1.5 py-0.5 leading-none">новое</span>}
            </p>
            <p className="mt-1 text-zinc-200 whitespace-pre-line">{it.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
