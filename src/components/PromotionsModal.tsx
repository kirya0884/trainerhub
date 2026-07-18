import { useEffect, useState } from "react";
import { Percent, Plus, X } from "lucide-react";
import ModalShell from "./ModalShell";
import * as api from "../lib/payments";
import type { Promotion } from "../lib/payments";

const APPLIES = [["sessions", "Пакет тренировок"], ["subscription", "Подписка"]] as const;

export default function PromotionsModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [promos, setPromos] = useState<Promotion[] | null>(null);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [appliesTo, setAppliesTo] = useState<string>("sessions");

  const load = () => api.fetchPromotions(clientId).then(setPromos).catch((e) => console.error("[PromotionsModal] load:", e));
  useEffect(() => { load(); }, [clientId]);

  const submit = async () => {
    const v = Number(value);
    if (!v || v <= 0) return;
    await api.addPromotion(clientId, { label, type, value: v, appliesTo, active: true });
    setLabel(""); setValue("");
    load();
  };

  return (
    <ModalShell title="Акции и скидки" icon={<Percent size={17} className="text-orange-400" />} onClose={onClose}>
      <div className="p-4 space-y-3 text-sm overflow-y-auto">
        <div className="bg-zinc-800/40 rounded-xl p-3 space-y-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Название акции (напр. «Друг привёл друга»)" className="w-full bg-zinc-800 rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
          <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-0.5">
            <button onClick={() => setType("percent")} className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition ${type === "percent" ? "bg-lime-400 text-zinc-950" : "text-zinc-400"}`}>%</button>
            <button onClick={() => setType("fixed")} className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition ${type === "fixed" ? "bg-lime-400 text-zinc-950" : "text-zinc-400"}`}>₽</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))} placeholder={type === "percent" ? "10" : "500"} className="bg-zinc-800 rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
            <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} className="bg-zinc-800 rounded-lg px-2 py-2 text-xs outline-none">
              {APPLIES.map(([k, l]) => <option key={k} value={k} className="bg-zinc-900">{l}</option>)}
            </select>
          </div>
          <button onClick={submit} className="w-full flex items-center justify-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2 text-sm hover:bg-lime-300 transition"><Plus size={15} /> Добавить акцию</button>
        </div>

        <div className="space-y-1.5">
          {promos === null && <p className="text-zinc-600 text-xs">Загрузка...</p>}
          {promos?.length === 0 && <p className="text-zinc-600 text-xs">Акций пока нет</p>}
          {promos?.map((p) => (
            <div key={p.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${p.active ? "bg-orange-500/10" : "bg-zinc-800/30 opacity-60"}`}>
              <button onClick={() => api.togglePromotion(p.id, !p.active).then(load).catch((e) => console.error("[PromotionsModal] toggle:", e))} className={`text-xs font-medium px-2 py-1 rounded shrink-0 ${p.active ? "bg-orange-400 text-zinc-950" : "bg-zinc-700 text-zinc-400"}`}>{p.active ? "Активна" : "Выкл"}</button>
              <span className="flex-1 truncate">{p.label || (p.type === "percent" ? `${p.value}%` : `${p.value}₽`)} <span className="text-zinc-500">· {APPLIES.find((a) => a[0] === p.appliesTo)?.[1]}</span></span>
              <button onClick={() => api.deletePromotion(p.id).then(load).catch((e) => console.error("[PromotionsModal] delete:", e))} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition shrink-0"><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
