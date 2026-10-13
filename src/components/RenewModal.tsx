import { Check, Clock, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import ModalShell from "./ModalShell";
import { SkeletonRows } from "./Skeleton";
import { fetchClient, type Membership } from "../lib/clients";
import { applyPromotion, fetchPackageTemplates, fetchPromotions, markPaid, type PackageTemplate, type PayStatus, type Promotion } from "../lib/payments";

const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
const tplPrice = (t: PackageTemplate) => (t.discount ? Math.round(t.price * (1 - t.discount / 100)) : t.price);
type Option = { key: string; title: string; sub: string; patch: Partial<Membership> };

// Быстрое продление: по умолчанию выбран тот же пакет, что в прошлый раз, оплата сегодняшним
// днём — одно нажатие «Оплачено». Дата, «Частями», настройки пакета — в профиле, вкладка «Оплаты».
export default function RenewModal({ trainerId, clientId, name, onDone, onClose }: {
  trainerId: string; clientId: string; name: string; onDone: () => void; onClose: () => void;
}) {
  const [data, setData] = useState<{ m: Membership; templates: PackageTemplate[]; promos: Promotion[] } | null>(null);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchClient(clientId), fetchPackageTemplates(trainerId), fetchPromotions(clientId).catch(() => [] as Promotion[])])
      .then(([c, templates, promos]) => { if (alive) setData({ m: c.membership, templates, promos }); })
      .catch((e) => { console.error("[RenewModal] загрузка:", e); alert("Не удалось загрузить абонемент."); onClose(); });
    return () => { alive = false; };
  }, [clientId, trainerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = data?.m;
  const isSub = m?.type === "subscription";
  const total = Number(m?.total) || 0, pkgPrice = Number(m?.packagePrice) || 0;
  const options: Option[] = !m ? [] : isSub
    ? (Number(m.pricePerSession) ? [{ key: "cur", title: "Подписка на месяц", sub: rub(Number(m.pricePerSession)), patch: {} }] : [])
    : [
      ...(total && pkgPrice ? [{ key: "cur", title: `${total} тренировок`, sub: `${rub(pkgPrice)} · как в прошлый раз`, patch: {} }] : []),
      ...data!.templates
        .filter((t) => !(t.sessions === total && tplPrice(t) === pkgPrice && !!t.split === !!m.split))
        .map((t) => ({ key: t.id, title: t.name, sub: `${t.sessions} тр. · ${rub(tplPrice(t))}${t.discount ? ` · −${t.discount}%` : ""}`, patch: { type: "sessions", total: String(t.sessions), packagePrice: String(tplPrice(t)), split: t.split } as Partial<Membership> })),
    ];
  const chosen = options.find((o) => o.key === sel) ?? options[0];
  const next = m && chosen ? { ...m, ...chosen.patch, paymentDate: "" } : null; // пустая дата — markPaid ставит сегодня
  const base = next ? Number(next.type === "subscription" ? next.pricePerSession : next.packagePrice) || 0 : 0;
  const promo = next && data ? applyPromotion(base, data.promos, next.type === "subscription" ? "subscription" : "sessions") : null;

  const pay = async (status: PayStatus) => {
    if (!next || busy) return;
    setBusy(true);
    try { await markPaid(clientId, next, data!.promos, status); onDone(); onClose(); }
    catch (e) { console.error("[RenewModal] оплата:", e); alert("Не удалось записать оплату."); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell title={`Продлить — ${name}`} icon={<RefreshCw size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3">
        {!data ? <SkeletonRows rows={2} /> : options.length === 0 ? (
          <p className="text-sm text-zinc-400">Пакет не настроен и шаблонов нет. Укажите пакет в профиле подопечного, во вкладке «Оплаты».</p>
        ) : (
          <>
            <div className="space-y-2">
              {options.map((o) => (
                <button key={o.key} onClick={() => setSel(o.key)} aria-pressed={chosen?.key === o.key}
                  className={`w-full text-left rounded-xl bg-zinc-800 px-3.5 py-2.5 transition ${chosen?.key === o.key ? "ring-2 ring-inset ring-lime-400" : "hover:bg-zinc-700"}`}>
                  <span className="block font-semibold">{o.title}</span>
                  <span className="block text-[13px] text-zinc-400">{o.sub}</span>
                </button>
              ))}
            </div>
            <button onClick={() => pay("paid")} disabled={busy || !base}
              className="w-full h-12 flex items-center justify-center gap-2 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98] disabled:opacity-40">
              <Check size={18} strokeWidth={2.75} /> {busy ? "Сохраняю…" : `Оплачено сегодня · ${rub(promo?.amount ?? base)}`}
            </button>
            {promo?.label && promo.amount !== base && <p className="text-[13px] text-orange-300 text-center -mt-1">{promo.label}: вместо {rub(base)}</p>}
            <button onClick={() => pay("deferred")} disabled={busy || !base}
              className="w-full h-11 flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-semibold transition disabled:opacity-40"><Clock size={16} className="text-orange-300" /> Начислить, оплата позже</button>
          </>
        )}
      </div>
    </ModalShell>
  );
}
