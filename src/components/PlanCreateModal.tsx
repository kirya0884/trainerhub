import { useEffect, useState } from "react";
import { ClipboardList, Copy, FileStack, Search, Sparkles } from "lucide-react";
import ModalShell from "./ModalShell";
import ProgramCatalogModal from "./ProgramCatalogModal";
import { duplicatePlan } from "../lib/plans";
import type { PlanOverviewItem } from "../lib/clients";
import { createPlanFromTemplate, fetchPlanTemplates } from "../lib/templates";
import type { PlanTemplate } from "../lib/templates";
import { notify } from "../lib/dialog";
import { humanError } from "../lib/errors";
import { plural } from "../lib/format";

// B07: мастер создания плана. Бэклог предлагал вывести шаблоны первым шагом, но
// в базе их ноль на 39 созданных планов — тренер увидел бы пустой список. Поэтому
// источников несколько, а карточка шаблонов показывается только когда они есть.
//
// Копия существующего плана — главное здесь: duplicatePlan из B06 принимает целевого
// клиента отдельным параметром, поэтому переносить структуру между разными подопечными
// она умеет без доработок.
//
// Шаблоны планов грузим здесь, при открытии окна: запрос один и лёгкий, а окно
// открывают и из «Планов», и из карточки клиента — так не дублируем логику в двух местах.
type Source = "menu" | "copy" | "template";

export default function PlanCreateModal({ trainerId, clientId, clientName, allPlans, onCreated, onClose }: {
  trainerId: string;
  clientId: string;
  clientName: string;
  allPlans: PlanOverviewItem[];
  onCreated: (planId: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>("menu");
  const [showCatalog, setShowCatalog] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // null — ещё грузятся или не загрузились: карточку тогда просто не показываем
  const [templates, setTemplates] = useState<PlanTemplate[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPlanTemplates(trainerId)
      .then((t) => { if (alive) setTemplates(t); })
      .catch((e) => console.error("[PlanCreateModal] fetchPlanTemplates:", e));
    return () => { alive = false; };
  }, [trainerId]);

  const fromTemplate = async (t: PlanTemplate) => {
    if (busy) return;
    setBusy(t.id);
    try {
      const { planId, hidden } = await createPlanFromTemplate(trainerId, clientId, t.name, t.days);
      if (hidden) notify("План создан скрытым — клиент пока видит прежний. Показать можно в меню плана", "info");
      onCreated(planId);
    } catch (e) {
      console.error("[PlanCreateModal] fromTemplate:", e);
      notify(humanError(e, "Не удалось создать план из шаблона"), "error");
    } finally { setBusy(null); }
  };

  const term = q.trim().toLowerCase();
  const candidates = allPlans
    .filter((p) => !p.archived)
    .filter((p) => !term || p.name.toLowerCase().includes(term) || p.clientName.toLowerCase().includes(term));

  const copyFrom = async (p: PlanOverviewItem) => {
    if (busy) return;
    setBusy(p.id);
    try {
      const newId = await duplicatePlan(trainerId, clientId, p.id, p.name);
      onCreated(newId);
    } catch (e) {
      console.error("[PlanCreateModal] copy:", e);
      notify("Не удалось скопировать план.");
    } finally { setBusy(null); }
  };

  if (showCatalog) {
    return (
      <ProgramCatalogModal
        trainerId={trainerId}
        clientId={clientId}
        onClose={() => setShowCatalog(false)}
        onCloned={(planId) => onCreated(planId)}
      />
    );
  }

  const Card = ({ icon, title, note, onClick }: { icon: React.ReactNode; title: string; note: string; onClick: () => void }) => (
    <button onClick={onClick} className="w-full flex items-start gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 text-left hover:border-zinc-700 transition">
      <span className="shrink-0 mt-0.5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-100">{title}</span>
        <span className="block text-xs text-zinc-500 mt-0.5">{note}</span>
      </span>
    </button>
  );

  return (
    <ModalShell title={source === "menu" ? "Новый план" : source === "copy" ? "Скопировать план" : "Из моего шаблона"} icon={<ClipboardList size={17} className="text-lime-400" />} onClose={onClose} wide>
      <div className="p-4 space-y-3 overflow-y-auto">
        {source === "menu" && (
          <>
            <p className="text-xs text-zinc-500">Для клиента: {clientName}</p>
            <Card
              icon={<Sparkles size={18} className="text-lime-400" />}
              title="Из готовой программы"
              note="Масса, сушка, СФП — с упражнениями и подходами"
              onClick={() => setShowCatalog(true)}
            />
            <Card
              icon={<Copy size={18} className="text-cyan-400" />}
              title="Копия существующего плана"
              note="Взять план любого клиента вместе с блоками и упражнениями"
              onClick={() => setSource("copy")}
            />
            {!!templates?.length && (
              <Card
                icon={<FileStack size={18} className="text-orange-400" />}
                title="Из моего шаблона"
                note="Сохранённые ранее программы"
                onClick={() => setSource("template")}
              />
            )}
          </>
        )}

        {source === "template" && (
          <>
            <p className="text-xs text-zinc-500">Создадим новый план для клиента: {clientName}</p>
            <div className="space-y-1.5">
              {(templates ?? []).map((t) => (
                <button
                  key={t.id}
                  onClick={() => fromTemplate(t)}
                  disabled={!!busy}
                  className={`w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-left hover:border-zinc-700 transition disabled:opacity-40 ${busy === t.id ? "opacity-60" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-zinc-100 truncate">{t.name}</span>
                    <span className="block text-xs text-zinc-500">{t.days.length} {plural(t.days.length, ["день", "дня", "дней"])}</span>
                  </span>
                  {busy === t.id && <span className="text-xs text-zinc-500 shrink-0">создаём...</span>}
                </button>
              ))}
            </div>
            <button onClick={() => setSource("menu")} className="w-full text-xs text-zinc-500 hover:text-zinc-300 transition pt-1">← Назад к выбору</button>
          </>
        )}

        {source === "copy" && (
          <>
            <div className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 py-2">
              <Search size={15} className="text-zinc-500 shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="План или клиент..."
                className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              />
            </div>
            {candidates.length === 0 && <p className="text-sm text-zinc-600 text-center py-8">{allPlans.length ? "Ничего не найдено" : "Планов пока нет"}</p>}
            <div className="space-y-1.5">
              {candidates.map((p) => (
                <button
                  key={p.id}
                  onClick={() => copyFrom(p)}
                  disabled={!!busy}
                  className={`w-full flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-left hover:border-zinc-700 transition disabled:opacity-40 ${busy === p.id ? "opacity-60" : ""}`}
                >
                  <span className="w-1.5 h-8 rounded-full shrink-0" style={{ background: p.clientColor }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-zinc-100 truncate">{p.name}</span>
                    <span className="block text-xs text-zinc-500 truncate">{p.clientName}</span>
                  </span>
                  {busy === p.id && <span className="text-xs text-zinc-500 shrink-0">копируем...</span>}
                </button>
              ))}
            </div>
            <button onClick={() => setSource("menu")} className="w-full text-xs text-zinc-500 hover:text-zinc-300 transition pt-1">← Назад к выбору</button>
          </>
        )}
      </div>
    </ModalShell>
  );
}
