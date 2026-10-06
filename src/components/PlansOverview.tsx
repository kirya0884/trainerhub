import { useEffect, useState } from "react";
import { loadViewState, saveViewState } from "../lib/viewState";
import { logEvent } from "../lib/events";
import { useScrollRestore } from "../hooks/useScrollRestore";
import { ChevronRight, ClipboardList, Copy, MoreHorizontal, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import PlanCreateModal from "./PlanCreateModal";
import ModalShell from "./ModalShell";
import * as api from "../lib/clients";
import { duplicatePlan } from "../lib/plans";
import type { PlanOverviewItem, ClientListItem } from "../lib/clients";
import { SkeletonRows } from "./Skeleton";
import { addDays, today } from "../lib/format";

const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const fmtDay = (d: string) => {
  const t = today();
  if (d === t) return "сегодня";
  if (d === addDays(t, -1)) return "вчера";
  return new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
};
const daysWord = (n: number) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? "день" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "дня" : "дней"; };

// Глобальная вкладка «Планы» — все программы тренера со всех клиентов в одном месте.
export default function PlansOverview({ trainerId, clients, plans, reloadPlans, onOpenPlan, autoFocusNew }: {
  trainerId: string; clients: ClientListItem[]; plans: PlanOverviewItem[] | null; reloadPlans: () => void; onOpenPlan: (planId: string, clientId: string) => void; autoFocusNew?: boolean;
}) {
  // B12: поисковый запрос переживает переключение вкладки
  const [query, setQuery] = useState(() => loadViewState("plans-query", ""));
  const [showArchive, setShowArchive] = useState(false);
  // Новый план: шаг 1 — подопечный, шаг 2 — название или «из готового». «+» в панели открывает сразу.
  const [creating, setCreating] = useState(!!autoFocusNew);
  const [newClientId, setNewClientId] = useState("");
  const [newName, setNewName] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => { saveViewState("plans-query", query); }, [query]);
  useEffect(() => { if (autoFocusNew) setCreating(true); }, [autoFocusNew]);
  // B16: поиск логируем с задержкой — иначе событие на каждую букву
  useEffect(() => { if (!query.trim()) return; const t = setTimeout(() => logEvent(trainerId, "search", "plans", { len: query.trim().length }), 1200); return () => clearTimeout(t); }, [query, trainerId]);
  useScrollRestore("plans", !!plans);
  // B04: планы подняты в App вместе с клиентами и записями — раздел больше не грузит их сам.
  const load = reloadPlans;

  const closeCreate = () => { setCreating(false); setNewClientId(""); setNewName(""); setClientQuery(""); };
  const createPlan = async () => {
    if (!newClientId || !newName.trim()) return;
    try {
      const row = await api.addPlan(trainerId, newClientId, newName.trim());
      const cid = newClientId;
      closeCreate();
      onOpenPlan(row.id, cid);
    } catch (e) { console.error("[PlansOverview] createPlan:", e); alert("Не удалось создать план."); }
  };
  // B06: дубликат создаётся вместе с блоками, днями, упражнениями и подходами.
  const [dupId, setDupId] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const duplicate = async (p: PlanOverviewItem) => {
    setMenuId(null);
    if (dupId) return;
    setDupId(p.id);
    try {
      await duplicatePlan(trainerId, p.clientId, p.id, `${p.name} (копия)`);
      reloadPlans();
    } catch (err) { console.error("[PlansOverview] duplicate:", err); alert("Не удалось дублировать план."); }
    finally { setDupId(null); }
  };
  const deletePlan = async (id: string, name: string) => {
    setMenuId(null);
    if (!window.confirm(`Удалить план «${name}»? Его можно восстановить из корзины.`)) return;
    try { await api.deletePlan(id); load(); }
    catch (err) { console.error("[PlansOverview] deletePlan:", err); alert("Не удалось удалить план."); }
  };

  const wizardClient = clients.find((c) => c.id === newClientId);
  const q = query.trim().toLowerCase();
  const all = plans ?? [];
  const activeCount = all.filter((p) => !p.archived).length;
  const archiveCount = all.length - activeCount;
  const filtered = all
    .filter((p) => p.archived === showArchive)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q))
    // Сначала те, по которым недавно тренировались
    .sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? ""));
  // «Недавние» — тренировка за последние две недели; при поиске список один
  const recentFrom = addDays(today(), -14);
  const recent = q ? [] : filtered.filter((p) => p.lastDate && p.lastDate >= recentFrom);
  const rest = q ? filtered : filtered.filter((p) => !recent.includes(p));
  const cq = clientQuery.trim().toLowerCase();
  const clientOptions = clients.filter((c) => !cq || c.name.toLowerCase().includes(cq));

  const Row = ({ p }: { p: PlanOverviewItem }) => {
    const meta = [p.clientName, p.daysCount ? `${p.daysCount} ${daysWord(p.daysCount)}` : null, p.lastDate ? fmtDay(p.lastDate) : null].filter(Boolean).join(" · ");
    return (
      <div className="relative flex items-center">
        <button onClick={() => onOpenPlan(p.id, p.clientId)} className={`flex-1 min-w-0 flex items-center gap-3 pl-4 pr-1 py-3 min-h-[72px] text-left hover:bg-zinc-800/40 transition ${dupId === p.id ? "opacity-50" : ""}`}>
          <span className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-zinc-950" style={{ background: p.clientColor }}>{initials(p.clientName)}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold truncate">{p.name}</span>
            <span className={`block text-sm truncate ${p.visibleToClient === false ? "text-orange-400" : "text-zinc-400"}`}>
              {p.visibleToClient === false ? `${p.clientName} · скрыт от клиента` : meta}
            </span>
          </span>
        </button>
        <button onClick={() => setMenuId(menuId === p.id ? null : p.id)} aria-label={`Действия с планом «${p.name}»`} aria-expanded={menuId === p.id}
          className="w-11 h-11 mr-1.5 shrink-0 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition">
          <MoreHorizontal size={19} />
        </button>
        {menuId === p.id && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} />
            <div className="absolute right-2 top-full -mt-2 z-20 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 w-48 shadow-xl">
              <button onClick={() => duplicate(p)} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition"><Copy size={15} className="text-zinc-500" /> Дублировать</button>
              <button onClick={() => deletePlan(p.id, p.name)} className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg text-sm text-red-400 hover:bg-zinc-800 transition"><Trash2 size={15} /> Удалить</button>
            </div>
          </>
        )}
      </div>
    );
  };
  const List = ({ items }: { items: PlanOverviewItem[] }) => (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800">
      {items.map((p) => <Row key={p.id} p={p} />)}
    </div>
  );

  return (
    <div className="space-y-4">
      {wizard && wizardClient && (
        <PlanCreateModal
          trainerId={trainerId}
          clientId={wizardClient.id}
          clientName={wizardClient.name}
          allPlans={all}
          onCreated={(planId) => { setWizard(false); const cid = wizardClient.id; closeCreate(); reloadPlans(); onOpenPlan(planId, cid); }}
          onClose={() => setWizard(false)}
        />
      )}

      {creating && !wizard && (
        <ModalShell title="Новый план" icon={<ClipboardList size={17} className="text-lime-400" />} onClose={closeCreate}>
          <div className="p-4 space-y-3">
            {!wizardClient ? (
              <>
                <p className="text-sm text-zinc-400">Для кого план?</p>
                <div className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 h-11">
                  <Search size={16} className="text-zinc-500 shrink-0" />
                  <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Подопечный..." className="flex-1 min-w-0 bg-transparent outline-none" />
                </div>
                <div className="space-y-1.5">
                  {clientOptions.length === 0 && <p className="text-sm text-zinc-500 text-center py-6">Никого не найдено</p>}
                  {clientOptions.map((c) => (
                    <button key={c.id} onClick={() => setNewClientId(c.id)} className="w-full flex items-center gap-3 px-3 h-14 rounded-xl hover:bg-zinc-800 transition text-left">
                      <span className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-zinc-950" style={{ background: c.color }}>{initials(c.name)}</span>
                      <span className="flex-1 min-w-0 font-semibold truncate">{c.name}</span>
                      <ChevronRight size={18} className="text-zinc-500 shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <button onClick={() => setNewClientId("")} className="inline-flex items-center gap-2 h-9 pl-1 pr-3 rounded-full bg-zinc-800 text-sm font-semibold hover:bg-zinc-700 transition" title="Сменить подопечного">
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-zinc-950" style={{ background: wizardClient.color }}>{initials(wizardClient.name)}</span>
                  {wizardClient.name}
                </button>
                <label className="block text-sm font-semibold">Название плана
                  <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createPlan()} placeholder="Например, Сила · блок 1"
                    className="mt-2 w-full h-12 bg-zinc-800 border border-zinc-700 rounded-xl px-3.5 font-normal outline-none focus:border-lime-400/60" />
                </label>
                <button onClick={createPlan} disabled={!newName.trim()} className="w-full h-12 flex items-center justify-center gap-2 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40"><Plus size={18} /> Создать пустой план</button>
                <button onClick={() => setWizard(true)} className="w-full h-12 flex items-center justify-center gap-2 bg-zinc-800 text-zinc-100 font-semibold rounded-xl hover:bg-zinc-700 transition"><Sparkles size={17} className="text-lime-400" /> Из готовой программы или копией</button>
              </>
            )}
          </div>
        </ModalShell>
      )}

      <div className="flex items-center gap-2 pt-1">
        <h2 className="flex-1 min-w-0 text-2xl font-extrabold tracking-tight">Планы</h2>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 h-10 shrink-0 bg-lime-400 text-zinc-950 font-bold rounded-xl px-3.5 text-sm hover:bg-lime-300 transition active:scale-[0.98]"><Plus size={17} /> Новый план</button>
      </div>

      <div className="flex items-center gap-2.5 bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 h-11">
        <Search size={17} className="text-zinc-500 shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по плану или подопечному" className="flex-1 min-w-0 bg-transparent outline-none" />
      </div>

      <div className="flex gap-2">
        {([[false, `Активные · ${activeCount}`], [true, `Архив · ${archiveCount}`]] as const).map(([arch, label]) => (
          <button key={label} onClick={() => setShowArchive(arch)} aria-pressed={showArchive === arch}
            className={`shrink-0 h-9 px-3.5 rounded-full text-sm font-semibold transition ${showArchive === arch ? "bg-lime-400 text-zinc-950" : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>{label}</button>
        ))}
      </div>

      {plans === null ? (
        <SkeletonRows rows={4} />
      ) : filtered.length === 0 ? (
        <p className="text-zinc-500 text-sm text-center py-10">{q ? "Ничего не найдено" : showArchive ? "В архиве пусто" : "Планов пока нет. Создайте первый кнопкой «Новый план»."}</p>
      ) : (
        <>
          {recent.length > 0 && (
            <div>
              <h3 className="text-[17px] font-bold mb-2.5 px-0.5">Недавние</h3>
              <List items={recent} />
            </div>
          )}
          {rest.length > 0 && (
            <div>
              {recent.length > 0 && <h3 className="text-[17px] font-bold mb-2.5 px-0.5">Остальные</h3>}
              <List items={rest} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
