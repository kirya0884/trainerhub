import { Archive, ChevronRight, HeartPulse, Play, Plus, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { GOALS } from "../constants";
import * as api from "../lib/clients";
import type { Membership } from "../lib/clients";
import { fetchPackageTemplates, markPaid } from "../lib/payments";
import type { PackageTemplate } from "../lib/payments";
import ModalShell from "./ModalShell";
import LiveWorkoutModal from "./LiveWorkoutModal";
import type { ClientListItem } from "../lib/clients";
import RemainingBadge from "./RemainingBadge";

export default function ClientsList({ trainerId, onOpenClient }: { trainerId: string; onOpenClient: (id: string) => void }) {
  const [clients, setClients] = useState<ClientListItem[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(GOALS[0]);

  const [search, setSearch] = useState("");
  const [renewing, setRenewing] = useState<{ clientId: string; name: string; membership: Membership } | null>(null);
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [selectedTplId, setSelectedTplId] = useState("");
  const [renewBusy, setRenewBusy] = useState(false);
  const [liveClient, setLiveClient] = useState<ClientListItem | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [fmtFilter, setFmtFilter] = useState("");

  const openRenew = async (e: React.MouseEvent, c: { id: string; name: string }) => {
    e.stopPropagation();
    const [cf, tpls] = await Promise.all([api.fetchClient(c.id), fetchPackageTemplates(trainerId)]);
    setTemplates(tpls);
    setSelectedTplId(tpls[0]?.id ?? "");
    setRenewing({ clientId: c.id, name: c.name, membership: cf.membership });
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
      load();
    } finally {
      setRenewBusy(false);
    }
  };

  const load = () => api.fetchClients(trainerId).then(setClients);
  useEffect(() => { load(); }, [trainerId]);

  const submit = async () => {
    if (!name.trim()) return;
    await api.addClient(trainerId, name.trim(), goal, clients?.length ?? 0);
    setName(""); setGoal(GOALS[0]); setShowForm(false);
    load();
  };

  if (!clients) return <div className="text-zinc-500 text-sm p-4">Загрузка...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Подопечные <span className="text-zinc-600 font-normal">({clients.filter((c) => c.status !== "archived").length})</span></h2>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowArchive((v) => !v); setShowForm(false); }} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${showArchive ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"}`} title="Архив клиентов"><Archive size={15} /></button>
          {!showArchive && <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg px-3 py-2 hover:bg-lime-300 transition text-sm"><Plus size={16} /> Добавить</button>}
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени..." className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-8 pr-3 py-2 text-sm outline-none focus:border-zinc-700 placeholder:text-zinc-600" />
        </div>
        {!showArchive && (
          <select value={fmtFilter} onChange={(e) => setFmtFilter(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-2 text-sm outline-none focus:border-zinc-700 text-zinc-300 shrink-0">
            <option value="">Все</option>
            <option value="online">Онлайн</option>
            <option value="offline">Офлайн</option>
          </select>
        )}
      </div>
      {showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4 space-y-3">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Имя подопечного" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50" />
          <select value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-lime-400/50">
            {GOALS.map((g) => <option key={g}>{g}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={submit} className="flex-1 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2 text-sm hover:bg-lime-300 transition">Сохранить</button>
            <button onClick={() => setShowForm(false)} className="px-4 bg-zinc-800 rounded-lg py-2 text-sm text-zinc-400 hover:text-zinc-100 transition">Отмена</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {showArchive && (
          <p className="text-xs text-zinc-500 font-semibold tracking-wide mb-2 flex items-center gap-1.5"><Archive size={12} /> АРХИВ — клиенты скрыты из основного списка</p>
        )}
        {clients.filter((c) => c.status !== "archived").length === 0 && !showArchive && <p className="text-zinc-600 text-sm text-center py-8">Добавь первого подопечного, чтобы привязывать к нему планы</p>}
        {clients
          .filter((c) => showArchive ? c.status === "archived" : c.status !== "archived")
          .filter((c) => !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()))
          .filter((c) => !fmtFilter || c.format === fmtFilter)
          .map((c) => (
          <button key={c.id} onClick={() => onOpenClient(c.id)} className={`w-full text-left flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700 transition ${c.status === "left" ? "opacity-50" : ""}`}>
            {c.avatarUrl
              ? <img src={c.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 border border-zinc-700" />
              : <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-zinc-950 shrink-0" style={{ background: c.color }}>{c.name.charAt(0).toUpperCase()}</div>
            }
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate flex items-center gap-1.5">
                <RemainingBadge remaining={c.remaining} />
                {c.name}
                {c.hasHealthFlags && <HeartPulse size={13} className="text-amber-400 shrink-0" />}
                {c.status === "paused" && <span className="text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-400 rounded px-1.5 py-0.5 shrink-0">пауза</span>}
                {c.status === "left" && <span className="text-[10px] uppercase tracking-wide bg-zinc-700 text-zinc-400 rounded px-1.5 py-0.5 shrink-0">ушёл</span>}
                {c.status === "archived" && <span className="text-[10px] uppercase tracking-wide bg-zinc-700 text-zinc-500 rounded px-1.5 py-0.5 shrink-0">архив</span>}
                {c.format === "online" && <span className="text-[10px] uppercase tracking-wide bg-cyan-400/10 text-cyan-400 rounded px-1.5 py-0.5 shrink-0">онлайн</span>}
                {c.format === "offline" && <span className="text-[10px] uppercase tracking-wide bg-zinc-700/50 text-zinc-400 rounded px-1.5 py-0.5 shrink-0">офлайн</span>}
                {!!c.activeSession && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setLiveClient(c); }}
                    className="text-[10px] uppercase tracking-wide bg-cyan-400/15 text-cyan-400 hover:bg-cyan-400/30 rounded px-1.5 py-0.5 shrink-0 flex items-center gap-1 transition"
                    title="Смотреть тренировку онлайн"
                  ><Play size={10} /> тренируется</button>
                )}
              </p>
              <p className="text-xs text-zinc-500">{c.goal}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {c.remaining !== null && c.remaining !== "" && Number(c.remaining) <= 2 && (
                <button
                  onClick={(e) => openRenew(e, c)}
                  className="flex items-center gap-1 text-[11px] font-semibold bg-orange-400/15 text-orange-400 hover:bg-orange-400/25 rounded-full px-2 py-0.5 transition"
                  title="Быстрое продление пакета"
                >
                  <RefreshCw size={10} /> Продлить
                </button>
              )}
              <ChevronRight size={18} className="text-zinc-600" />
            </div>
          </button>
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
