import { ChevronLeft, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import ModalShell from "./ModalShell";
import { GOALS } from "../constants";
import { addClient, emptyMembership, updateClient } from "../lib/clients";
import { fetchPackageTemplates, markPaid, type PackageTemplate, type PayStatus } from "../lib/payments";
import { notify } from "../lib/dialog";
import { track } from "../lib/events";

const STEPS = ["Кто", "Контакты", "Здоровье", "Абонемент"];
const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
const tplPrice = (t: PackageTemplate) => (t.discount ? Math.round(t.price * (1 - t.discount / 100)) : t.price);
const field = "w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 h-11 outline-none focus:border-lime-400/50";
const chip = (on: boolean) => `h-10 px-3.5 rounded-xl text-sm font-semibold transition ${on ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`;
const tile = (on: boolean) => `w-full text-left rounded-xl bg-zinc-800 px-3.5 py-2.5 transition ${on ? "ring-2 ring-inset ring-lime-400" : "hover:bg-zinc-700"}`;

// Новый подопечный по шагам. Всё, кроме имени, можно пропустить. В базу пишем один раз
// в конце — брошенный на середине мастер не оставляет полупустых карточек.
export default function NewClientWizard({ trainerId, existingCount, onCreated, onClose }: {
  trainerId: string; existingCount: number; onCreated: (id: string) => void; onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(GOALS[0]);
  const [format, setFormat] = useState("offline");
  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [injuries, setInjuries] = useState("");
  const [restrictions, setRestrictions] = useState("");
  const [templates, setTemplates] = useState<PackageTemplate[]>([]);
  const [tplId, setTplId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchPackageTemplates(trainerId).then(setTemplates).catch((e) => console.error("[NewClientWizard] шаблоны:", e)); }, [trainerId]);

  const tpl = templates.find((t) => t.id === tplId);
  const canNext = step > 0 || !!name.trim();
  const save = async (pay: PayStatus) => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      const c = await addClient(trainerId, name.trim(), goal, existingCount);
      await updateClient(c.id, {
        format, phone: phone.trim(), telegram: telegram.trim(), whatsapp: whatsapp.trim(),
        health: { injuries: injuries.trim(), restrictions: restrictions.trim(), notes: "" },
      });
      if (tpl) {
        const m = { ...emptyMembership, total: String(tpl.sessions), packagePrice: String(tplPrice(tpl)), split: tpl.split };
        // «Оплата позже» — как во вкладке «Оплаты»: блок начислен, платёж в журнале «ожидается»
        await markPaid(c.id, m, [], pay);
      }
      track("action", "client_created", { via: "wizard", contacts: !!(phone || telegram || whatsapp), health: !!(injuries || restrictions), package: !!tpl });
      onCreated(c.id);
    } catch (e) {
      console.error("[NewClientWizard] сохранение:", e);
      notify("Не удалось добавить подопечного. Проверьте интернет и попробуйте ещё раз.");
      setBusy(false);
    }
  };

  const footer = (
    <div className="p-4 border-t border-zinc-800 space-y-2 shrink-0">
      {step < 3 ? (
        <div className="flex gap-2">
          {step > 0 && <button onClick={() => setStep(step - 1)} aria-label="Назад" className="w-12 h-12 shrink-0 flex items-center justify-center bg-zinc-800 rounded-xl text-zinc-300 hover:bg-zinc-700 transition"><ChevronLeft size={20} /></button>}
          <button onClick={() => canNext && setStep(step + 1)} disabled={!canNext} className="flex-1 h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">Дальше</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button onClick={() => setStep(2)} disabled={busy} aria-label="Назад" className="w-12 h-12 shrink-0 flex items-center justify-center bg-zinc-800 rounded-xl text-zinc-300 hover:bg-zinc-700 transition"><ChevronLeft size={20} /></button>
          <div className="flex-1 space-y-2">
            <button onClick={() => save("paid")} disabled={busy} className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">
              {busy ? "Сохраняю…" : tpl ? `Добавить · оплачено ${rub(tplPrice(tpl))}` : "Добавить подопечного"}
            </button>
            {tpl && <button onClick={() => save("deferred")} disabled={busy} className="w-full h-11 bg-zinc-800 rounded-xl text-sm font-semibold text-zinc-200 hover:bg-zinc-700 transition disabled:opacity-40">Добавить, оплата позже</button>}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <ModalShell title="Новый подопечный" icon={<UserPlus size={16} className="text-lime-400" />} onClose={onClose} footer={footer}>
      <div className="p-4 space-y-4">
        <div>
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => <span key={s} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-lime-400" : "bg-zinc-800"}`} />)}
          </div>
          <p className="text-[13px] text-zinc-500 mt-2">Шаг {step + 1} из {STEPS.length} · {STEPS[step]}{step > 0 ? " · можно пропустить" : ""}</p>
        </div>

        {step === 0 && (
          <>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canNext && setStep(1)} placeholder="Имя подопечного" className={field} />
            <div>
              <p className="text-sm text-zinc-400 mb-2">Цель</p>
              <div className="flex flex-wrap gap-2">{GOALS.map((g) => <button key={g} onClick={() => setGoal(g)} aria-pressed={goal === g} className={chip(goal === g)}>{g}</button>)}</div>
            </div>
            <div>
              <p className="text-sm text-zinc-400 mb-2">Формат</p>
              <div className="flex gap-2">{[["offline", "Офлайн"], ["online", "Онлайн"]].map(([k, l]) => <button key={k} onClick={() => setFormat(k)} aria-pressed={format === k} className={chip(format === k)}>{l}</button>)}</div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-sm text-zinc-400">Нужны для напоминаний о тренировках — отправка в одно нажатие.</p>
            <input autoFocus type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Телефон" className={field} />
            <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="Telegram, например @marina" className={field} />
            <input type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp, номер" className={field} />
            {phone.trim() && !whatsapp && <button onClick={() => setWhatsapp(phone)} className="text-sm text-lime-400 font-semibold">WhatsApp на этот же номер</button>}
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm text-zinc-400">Будет видно в профиле подопечного.</p>
            <textarea autoFocus value={injuries} onChange={(e) => setInjuries(e.target.value)} rows={2} placeholder="Травмы" className={`${field} h-auto py-2.5 resize-none`} />
            <textarea value={restrictions} onChange={(e) => setRestrictions(e.target.value)} rows={2} placeholder="Ограничения и противопоказания" className={`${field} h-auto py-2.5 resize-none`} />
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-sm text-zinc-400">Пакет тренировок. Подписку и свой пакет можно настроить потом в профиле, во вкладке «Оплаты».</p>
            <div className="space-y-2">
              {templates.map((t) => (
                <button key={t.id} onClick={() => setTplId(t.id)} aria-pressed={tplId === t.id} className={tile(tplId === t.id)}>
                  <span className="block font-semibold">{t.name}</span>
                  <span className="block text-[13px] text-zinc-400">{t.sessions} тр. · {rub(tplPrice(t))}{t.discount ? ` · −${t.discount}%` : ""}{t.split ? " · сплит" : ""}</span>
                </button>
              ))}
              <button onClick={() => setTplId("")} aria-pressed={!tplId} className={tile(!tplId)}>
                <span className="block font-semibold">Без пакета</span>
                <span className="block text-[13px] text-zinc-400">настрою позже</span>
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
