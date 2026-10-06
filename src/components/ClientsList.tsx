import { CalendarCheck, Archive, ChevronRight, HeartPulse, Play, Plus, RefreshCw, Search, X } from "lucide-react";
import { useSwipeRow } from "../hooks/useSwipeRow";
import { useEffect, useState } from "react";
import { loadViewState, saveViewState } from "../lib/viewState";
import { logEvent } from "../lib/events";
import { useScrollRestore } from "../hooks/useScrollRestore";
import { GOALS } from "../constants";
import * as api from "../lib/clients";
import type { Membership } from "../lib/clients";
import { fetchPackageTemplates, markPaid } from "../lib/payments";
import type { PackageTemplate } from "../lib/payments";
import ModalShell from "./ModalShell";
import LiveWorkoutModal from "./LiveWorkoutModal";
import type { ClientListItem } from "../lib/clients";

export default function ClientsList({ trainerId, clients, reloadClients, onOpenClient, openForm, onBookClient }: { trainerId: string; clients: ClientListItem[] | null; reloadClients: () => void; onOpenClient: (id: string) => void; openForm?: boolean; onBookClient?: (clientId: string) => void }) {
  const [showForm, setShowForm] = useState(!!openForm);
  // B13: FAB просит открыть форму сразу. Флаг живёт во View, читаем один раз на смену флага.
  useEffect(() => { if (openForm) { setShowForm(true); setShowArchive(false); } }, [openForm]);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(GOALS[0]);

  // B12: поиск и фильтр формата переживают переключение вкладки. Архив намеренно
  // не запоминаем — вернуться в него незаметно и не понять, куда делись активные.
  const [search, setSearch] = useState(() => loadViewState("clients-search", ""));
  const [renewing, setRenewing] = useState<{ clientId: string; name: string; membership: Membership } | null>(null);
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [selectedTplId, setSelectedTplId] = useState("");
  const [renewBusy, setRenewBusy] = useState(false);
  const [liveClient, setLiveClient] = useState<ClientListItem | null>(null);
  // B11: свайп по строке влево открывает быстрые действия
  const swipe = useSwipeRow();
  const [showArchive, setShowArchive] = useState(false);
  const [fmtFilter, setFmtFilter] = useState(() => loadViewState("clients-fmt", ""));
  useEffect(() => { saveViewState("clients-search", search); }, [search]);
  // B16: поиск логируем с задержкой — иначе событие на каждую букву
  useEffect(() => { if (!search.trim()) return; const t = setTimeout(() => logEvent(trainerId, "search", "clients", { len: search.trim().length }), 1200); return () => clearTimeout(t); }, [search, trainerId]);
  useEffect(() => { saveViewState("clients-fmt", fmtFilter); }, [fmtFilter]);
  useScrollRestore("clients", !!clients);

  const openRenew = async (e: React.MouseEvent, c: { id: string; name: string }) => {
    e.stopPropagation();
    try {
      const [cf, tpls] = await Promise.all([api.fetchClient(c.id), fetchPackageTemplates(trainerId)]);
      setTemplates(tpls);
      setSelectedTplId(tpls[0]?.id ?? "");
      setRenewing({ clientId: c.id, name: c.name, membership: cf.membership });
    } catch (e) { console.error("[ClientsList] openRenew:", e); alert("Не удалось загрузить данные."); }
  };

  const doRenew = async () => {
    if (!renewing || renewBusy) return;
    const tpl = templates.find((t) => t.id === selectedTplId);
    if (!tpl) return;
    setRenewBusy(true);
    try {
      const finalPrice = tpl.discount ? Math.round(tpl.price * (1 - tpl.discount / 100)) : tpl.price;
      const m: Membership = { ...renewing.membership, type: "sessions", total: String(tpl.sessions), packagePrice: String(finalPrice), split: tpl.split };
      await markPaid(renewing.clientId, m, []);
      setRenewing(null);
      reloadClients();
    } catch (e) { console.error("[ClientsList] doRenew:", e); alert("Не удалось продлить абонемент."); }
    finally { setRenewBusy(false); }
  };


  const submit = async () => {
    if (!name.trim()) return;
    try {
      await api.addClient(trainerId, name.trim(), goal, clients?.length ?? 0);
      setName(""); setGoal(GOALS[0]); setShowForm(false);
      reloadClients();
    } catch (e) { console.error("[ClientsList] submit:", e); alert("Не удалось добавить подопечного."); }
  };

  // Ш4в: скелетон по форме будущего списка вместо голого «Загрузка...»
  if (!clients) return (
    <div className="space-y-3 animate-pulse" role="status" aria-label="Загрузка подопечных">
      <div className="h-8 w-44 bg-zinc-800 rounded-lg" />
      <div className="h-11 bg-zinc-900 border border-zinc-800 rounded-xl" />
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[68px]" />)}
      </div>
    </div>
  );

  const visible = clients
    .filter((c) => showArchive ? c.status === "archived" : c.status !== "archived")
    .filter((c) => !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()))
    .filter((c) => showArchive || !fmtFilter || c.format === fmtFilter);
  // Ш4в: группы — кто тренируется сейчас, кому продлить (≤2 тренировок или долг), остальные.
  // Каждый подопечный попадает ровно в одну группу; в архиве группировки нет.
  const needsRenew = (c: ClientListItem) => c.remaining !== null && c.remaining !== "" && Number(c.remaining) <= 2 && c.status !== "left";
  const groups: { title: string; items: ClientListItem[] }[] = showArchive
    ? [{ title: "", items: visible }]
    : [
        { title: "Сейчас тренируется", items: visible.filter((c) => !!c.activeSession) },
        { title: "Нужно продлить", items: visible.filter((c) => !c.activeSession && needsRenew(c)) },
        { title: "Все", items: visible.filter((c) => !c.activeSession && !needsRenew(c)) },
      ];
  const shownGroups = groups.filter((g) => g.items.length > 0);
  const FORMAT: Record<string, string> = { online: "онлайн", offline: "офлайн" };
  const STATUS: Record<string, string> = { paused: "на паузе", left: "ушёл", archived: "архив" };
  const segs: { key: string; label: string; on: boolean; pick: () => void }[] = [
    { key: "all", label: "Все", on: !showArchive && !fmtFilter, pick: () => { setShowArchive(false); setFmtFilter(""); } },
    { key: "online", label: "Онлайн", on: !showArchive && fmtFilter === "online", pick: () => { setShowArchive(false); setFmtFilter("online"); } },
    { key: "offline", label: "Офлайн", on: !showArchive && fmtFilter === "offline", pick: () => { setShowArchive(false); setFmtFilter("offline"); } },
    { key: "archive", label: "Архив", on: showArchive, pick: () => { setShowArchive(true); setShowForm(false); } },
  ];

  const row = (c: ClientListItem) => {
    const rem = c.remaining !== null && c.remaining !== "" ? Number(c.remaining) : null;
    const meta = [c.goal, FORMAT[c.format], STATUS[c.status]].filter(Boolean).join(" · ");
    return (
      // B11: строка едет влево, под ней панель действий
      <div key={c.id} {...swipe.rowProps(c.id)} className="relative overflow-hidden">
        <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: swipe.PANEL_W }}>
          <button onClick={() => { swipe.setOpenId(null); onBookClient?.(c.id); }}
            className="flex-1 flex flex-col items-center justify-center gap-1 bg-cyan-500/20 text-cyan-300 active:bg-cyan-500/30 transition">
            <CalendarCheck size={18} />
            <span className="text-[11px] font-medium">Записать</span>
          </button>
        </div>
        <div className="relative bg-zinc-900" style={{ transform: `translateX(${swipe.offsetFor(c.id)}px)`, transition: swipe.openId === c.id || swipe.offsetFor(c.id) === 0 ? "transform .18s ease-out" : "none" }}>
          <button onClick={() => { if (swipe.openId === c.id) { swipe.setOpenId(null); return; } onOpenClient(c.id); }}
            className={`w-full text-left flex items-center gap-3 px-3.5 min-h-[68px] py-2.5 hover:bg-zinc-800/40 transition ${c.status === "left" || c.status === "paused" ? "opacity-60" : ""}`}>
            <span className="relative shrink-0">
              {c.avatarUrl
                ? <img src={c.avatarUrl} alt="" className="w-11 h-11 rounded-full object-cover" />
                : <span className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-zinc-950" style={{ background: c.color }}>{c.name.charAt(0).toUpperCase()}</span>}
              {!!c.activeSession && <span className="absolute -right-0.5 -bottom-0.5 w-3.5 h-3.5 rounded-full bg-cyan-400 border-[3px] border-zinc-900" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5 font-semibold truncate">
                <span className="truncate">{c.name}</span>
                {c.hasHealthFlags && <HeartPulse size={14} className="text-amber-400 shrink-0" aria-label="Есть ограничения по здоровью" />}
              </span>
              {c.activeSession
                ? <span className="block text-sm text-cyan-400 truncate">Тренируется сейчас</span>
                : <span className="block text-sm text-zinc-500 truncate">{meta || "—"}</span>}
            </span>
            {rem !== null && (
              <span className="shrink-0 text-right leading-tight">
                <span className={`block text-lg font-bold ${rem <= 0 ? "text-red-400" : rem <= 2 ? "text-orange-400" : "text-zinc-200"}`}>{rem}</span>
                <span className="block text-[11px] text-zinc-500">{rem < 0 ? "долг" : "осталось"}</span>
              </span>
            )}
            <ChevronRight size={18} className="text-zinc-600 shrink-0" />
          </button>
          {/* Действия под строкой — отдельными кнопками, не внутри кнопки строки */}
          {(!!c.activeSession || (!showArchive && needsRenew(c))) && (
            <div className="flex gap-2 px-3.5 pb-3 -mt-1 pl-[4.25rem]">
              {!!c.activeSession && (
                <button onClick={() => setLiveClient(c)} className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-cyan-400/15 text-cyan-300 text-sm font-medium hover:bg-cyan-400/25 transition">
                  <Play size={14} /> Смотреть онлайн
                </button>
              )}
              {!c.activeSession && needsRenew(c) && (
                <button onClick={(e) => openRenew(e, c)} className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-orange-400/15 text-orange-300 text-sm font-medium hover:bg-orange-400/25 transition">
                  <RefreshCw size={14} /> Продлить пакет
                </button>
              )}
              {/* B11: на десктопе свайпа нет — запись отдельной кнопкой */}
              {onBookClient && (
                <button onClick={() => onBookClient(c.id)} className="hidden sm:flex items-center gap-1.5 h-9 px-3 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium hover:bg-zinc-700 transition">
                  <CalendarCheck size={14} /> Записать
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-2xl font-extrabold tracking-tight">Подопечные <span className="text-zinc-500 font-bold">{clients.filter((c) => c.status !== "archived").length}</span></h2>
        {!showArchive && <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-xl px-3.5 h-10 hover:bg-lime-300 transition text-sm"><Plus size={16} /> Добавить</button>}
      </div>
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени" aria-label="Поиск по имени" className="w-full h-11 bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-3 outline-none focus:border-zinc-700 placeholder:text-zinc-600" />
      </div>
      {/* Ш4в: формат и архив — одним рядом сегментов вместо select и отдельной кнопки */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto -mx-1 px-1">
        {segs.map((s) => (
          <button key={s.key} onClick={s.pick} aria-pressed={s.on}
            className={`shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-medium transition ${s.on ? "bg-lime-400 text-zinc-950" : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>
            {s.key === "archive" && <Archive size={14} />} {s.label}
          </button>
        ))}
      </div>
      {showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-4 space-y-3">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Имя подопечного" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 h-11 outline-none focus:border-lime-400/50" />
          <select value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 h-11 outline-none focus:border-lime-400/50">
            {GOALS.map((g) => <option key={g}>{g}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={submit} className="flex-1 bg-lime-400 text-zinc-950 font-semibold rounded-xl h-11 hover:bg-lime-300 transition">Сохранить</button>
            <button onClick={() => setShowForm(false)} className="px-4 bg-zinc-800 rounded-xl h-11 text-zinc-400 hover:text-zinc-100 transition">Отмена</button>
          </div>
        </div>
      )}
      {showArchive && (
        <p className="text-sm text-zinc-500 mb-3 flex items-center gap-1.5"><Archive size={14} /> Архив: эти подопечные скрыты из основного списка</p>
      )}
      {clients.filter((c) => c.status !== "archived").length === 0 && !showArchive && (
        <p className="text-zinc-500 text-sm text-center py-8">Добавь первого подопечного, чтобы привязывать к нему планы</p>
      )}
      {shownGroups.length === 0 && (search.trim() || fmtFilter || showArchive) && (
        <p className="text-zinc-500 text-sm text-center py-8">{showArchive ? "В архиве пусто" : "Никого не нашлось"}</p>
      )}
      <div className="space-y-5">
        {shownGroups.map((g) => (
          <div key={g.title || "archive"}>
            {g.title && <h3 className="text-[17px] font-bold mb-2">{g.title} <span className="text-zinc-500 font-semibold">{g.items.length}</span></h3>}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800">
              {g.items.map(row)}
            </div>
          </div>
        ))}
      </div>
      {liveClient && liveClient.activeSession && (
        <LiveWorkoutModal
          clientId={liveClient.id}
          clientName={liveClient.name}
          clientColor={liveClient.color}
          activeSession={liveClient.activeSession as any}
          onClose={() => setLiveClient(null)}
        />
      )}
      {renewing && (
        <ModalShell title={`Продлить пакет — ${renewing.name}`} onClose={() => setRenewing(null)}>
          <div className="p-4 space-y-3">
            <p className="text-xs text-zinc-500">Выберите шаблон пакета и нажмите «Оплачено» — тренировки добавятся в остаток автоматически.</p>
            {templates.length === 0 ? (
              <p className="text-xs text-zinc-500">Нет шаблонов. Создайте их в Профиле тренера → Шаблоны пакетов.</p>
            ) : (
              <select value={selectedTplId} onChange={(e) => setSelectedTplId(e.target.value)} className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none">
                {templates.map((t) => {
                  const fp = t.discount ? Math.round(t.price * (1 - t.discount / 100)) : t.price;
                  return <option key={t.id} value={t.id} className="bg-zinc-900">{t.name} · {t.sessions} тр.{fp ? ` — ${fp.toLocaleString("ru-RU")}₽` : ""}{t.split ? " · сплит" : ""}</option>;
                })}
              </select>
            )}
            <div className="flex gap-2">
              <button onClick={() => setRenewing(null)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg py-2.5 text-sm transition">Отмена</button>
              <button onClick={doRenew} disabled={renewBusy || !selectedTplId} className="flex-1 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 text-sm hover:bg-lime-300 transition disabled:opacity-50">
                {renewBusy ? "Оформление..." : "✓ Оплачено"}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
