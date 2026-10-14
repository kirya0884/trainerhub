import { useState } from "react";
import { Calculator, ChevronDown, GlassWater, Minus, Plus, Target, UserCheck } from "lucide-react";
import ModalShell from "./ModalShell";
import { MACRO_COLOR } from "./NutritionParts";
import * as api from "../lib/foodDiary";
import type { Activity, Aim, Goals, Macros, NutritionGoal, Sex } from "../lib/foodDiary";
import type { Measurement } from "../lib/clients";
import { fmtDate } from "../lib/format";

const str = (n: number | undefined) => (n ? String(Math.round(n)) : "");
const chip = (on: boolean) => `h-9 px-3 rounded-full text-[13px] font-semibold transition ${on ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`;

// Цели КБЖУ и воды. Задают оба; если цель есть у тренера — действует она, своя у клиента ждёт в запасе.
// asTrainer — окно открыл тренер: правит свою цель, видит цель клиента и может свою убрать.
export default function NutritionGoalsSheet({ clientId, goals, onSaved, onClose, asTrainer = false, measurements = [] }: {
  clientId: string; goals: Goals; onSaved: (g: Goals) => void; onClose: () => void; asTrainer?: boolean; measurements?: Measurement[];
}) {
  const who = asTrainer ? "trainer" : "client";
  const own = goals[who];
  const other = asTrainer ? goals.client : goals.trainer;
  const [p, setP] = useState(str(own?.protein));
  const [f, setF] = useState(str(own?.fat));
  const [c, setC] = useState(str(own?.carbs));
  const [kcal, setKcal] = useState(str(own?.kcal));
  const [water, setWater] = useState(own?.waterCups ?? api.activeWater(goals));
  const [showCalc, setShowCalc] = useState(!own);
  const [busy, setBusy] = useState(false);
  const auto = api.kcalOf({ protein: api.num(p), fat: api.num(f), carbs: api.num(c) });
  const next = { kcal: kcal.trim() ? api.num(kcal) : auto, protein: api.num(p), fat: api.num(f), carbs: api.num(c) };

  const run = async (fn: () => Promise<Goals>) => {
    if (busy) return;
    setBusy(true);
    try { onSaved(await fn()); onClose(); }
    catch (e) { console.error("[NutritionGoalsSheet]", e); alert("Не удалось сохранить цель."); setBusy(false); }
  };
  const save = () => next.kcal && run(async () => {
    await api.saveGoal(clientId, who, { ...next, waterCups: water });
    return { ...goals, [who]: { ...next, waterCups: water, updatedAt: new Date().toISOString() } };
  });
  const remove = () => window.confirm("Убрать цель тренера? Клиенту снова будет действовать его собственная цель.") && run(async () => {
    await api.deleteGoal(clientId, "trainer");
    return { ...goals, trainer: null };
  });
  const take = (m: Macros) => { setP(String(m.protein)); setF(String(m.fat)); setC(String(m.carbs)); setKcal(Math.round(api.kcalOf(m)) === m.kcal ? "" : String(m.kcal)); setShowCalc(false); };

  return (
    <ModalShell title="Цели питания" icon={<Target size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-4">
        {!asTrainer && goals.trainer && (
          <div className="rounded-2xl bg-zinc-800/60 p-3.5">
            <div className="flex items-center justify-between">
              <b>Действует сейчас</b>
              <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-bold bg-lime-400/15 text-lime-400"><UserCheck size={13} /> от тренера</span>
            </div>
            <GoalRow g={goals.trainer} />
            <p className="text-[13px] text-zinc-400 mt-2">Тренер задал цель {fmtDate(goals.trainer.updatedAt.slice(0, 10))}. Своя цель ниже включится, только если тренер свою уберёт.</p>
          </div>
        )}

        <div>
          <p className="font-bold mb-1">{asTrainer ? "Цель от тренера" : goals.trainer ? "Своя цель" : "Моя цель"}</p>
          <p className="text-[13px] text-zinc-400 mb-3">
            {asTrainer ? "Клиент увидит её как главную — своя у него действует, только пока вашей нет. " : ""}
            Укажите граммы белков, жиров и углеводов — калории посчитаются сами. Можно вписать свои ккал.
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            <Field label="Белки, г" value={p} onChange={setP} color={MACRO_COLOR.protein} />
            <Field label="Жиры, г" value={f} onChange={setF} color={MACRO_COLOR.fat} />
            <Field label="Углев., г" value={c} onChange={setC} color={MACRO_COLOR.carbs} />
            <Field label="Ккал" value={kcal} onChange={setKcal} color={MACRO_COLOR.kcal} placeholder={auto ? String(Math.round(auto)) : "авто"} />
          </div>
        </div>

        <div className="rounded-2xl bg-zinc-800/60">
          <button onClick={() => setShowCalc((v) => !v)} aria-expanded={showCalc} className="w-full flex items-center gap-2 px-3.5 h-12 font-bold">
            <Calculator size={17} className="text-lime-400" /> Посчитать по весу и активности
            <ChevronDown size={18} className={`ml-auto text-zinc-500 transition ${showCalc ? "rotate-180" : ""}`} />
          </button>
          {showCalc && <GoalCalculator clientId={clientId} measurements={measurements} onTake={take} />}
        </div>

        <div className="flex items-center gap-2.5 rounded-2xl bg-zinc-800/60 px-3.5 py-3">
          <GlassWater size={20} className="shrink-0" style={{ color: "#5ac8fa" }} />
          <span className="flex-1 text-sm"><b>Вода:</b> {water} {water % 10 === 1 && water !== 11 ? "стакан" : [2, 3, 4].includes(water % 10) && ![12, 13, 14].includes(water) ? "стакана" : "стаканов"} по 250 мл</span>
          <button onClick={() => setWater((w) => Math.max(1, w - 1))} aria-label="Меньше воды" className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-900 text-zinc-300 hover:bg-zinc-700 transition"><Minus size={17} /></button>
          <button onClick={() => setWater((w) => Math.min(20, w + 1))} aria-label="Больше воды" className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-900 text-zinc-300 hover:bg-zinc-700 transition"><Plus size={17} /></button>
        </div>

        <button onClick={save} disabled={busy || !next.kcal} className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
        {asTrainer && goals.trainer && (
          <button onClick={remove} disabled={busy} className="w-full h-10 rounded-xl text-sm font-semibold text-red-400 hover:bg-red-500/10 transition">Убрать цель тренера</button>
        )}

        {asTrainer && other && (
          <div className="rounded-2xl bg-zinc-800/60 p-3.5">
            <b>Цель, которую указал клиент</b>
            <GoalRow g={other} />
            <p className="text-[13px] text-zinc-400 mt-2">{goals.trainer ? "Сейчас не действует — главная ваша." : "Действует, пока вы не зададите свою."}</p>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// Калькулятор: вес — из последнего замера; пол, рост и возраст в базе не хранятся,
// поэтому запоминаем их на этом устройстве, чтобы не вводить каждый раз.
function GoalCalculator({ clientId, measurements, onTake }: { clientId: string; measurements: Measurement[]; onTake: (m: Macros) => void }) {
  const KEY = `th-nutri-calc-${clientId}`;
  const lastWeight = [...measurements].filter((m) => Number(String(m.weight).replace(",", ".")) > 0).sort((a, b) => b.date.localeCompare(a.date))[0];
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } })();
  const [sex, setSex] = useState<Sex>(saved.sex ?? "f");
  const [weight, setWeight] = useState<string>(lastWeight ? String(lastWeight.weight) : saved.weight ?? "");
  const [height, setHeight] = useState<string>(saved.height ?? "");
  const [age, setAge] = useState<string>(saved.age ?? "");
  const [activity, setActivity] = useState<Activity>(saved.activity ?? "mid");
  const [aim, setAim] = useState<Aim>(saved.aim ?? "lose");
  const ready = api.num(weight) > 0 && api.num(height) > 0 && api.num(age) > 0;
  const res = ready ? api.calcGoal({ sex, weight: api.num(weight), height: api.num(height), age: api.num(age), activity, aim }) : null;
  const take = () => {
    if (!res) return;
    try { localStorage.setItem(KEY, JSON.stringify({ sex, weight, height, age, activity, aim })); } catch { /* приватный режим */ }
    onTake(res);
  };
  const num = (label: string, v: string, set: (s: string) => void, hint?: string) => (
    <label className="block rounded-xl bg-zinc-900 px-2.5 py-2">
      <span className="block text-[11px] text-zinc-400 truncate">{label}</span>
      <input value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder="—" aria-label={label} className="w-full bg-transparent text-base font-bold outline-none placeholder:text-zinc-600" />
      {hint && <span className="block text-[11px] text-zinc-500 truncate">{hint}</span>}
    </label>
  );
  return (
    <div className="px-3.5 pb-3.5 space-y-3">
      <div className="flex gap-1.5">
        {([["f", "Женщина"], ["m", "Мужчина"]] as const).map(([k, l]) => <button key={k} onClick={() => setSex(k)} aria-pressed={sex === k} className={chip(sex === k)}>{l}</button>)}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {num("Вес, кг", weight, setWeight, lastWeight ? `замер ${fmtDate(lastWeight.date)}` : undefined)}
        {num("Рост, см", height, setHeight)}
        {num("Возраст", age, setAge)}
      </div>
      <div>
        <p className="text-[13px] font-semibold text-zinc-400 mb-1.5">Активность</p>
        <div className="flex gap-1.5 flex-wrap">{api.ACTIVITY.map(([k, l]) => <button key={k} onClick={() => setActivity(k)} aria-pressed={activity === k} className={chip(activity === k)}>{l}</button>)}</div>
      </div>
      <div>
        <p className="text-[13px] font-semibold text-zinc-400 mb-1.5">Цель</p>
        <div className="flex gap-1.5 flex-wrap">{api.AIMS.map(([k, l]) => <button key={k} onClick={() => setAim(k)} aria-pressed={aim === k} className={chip(aim === k)}>{l}</button>)}</div>
      </div>
      {res ? (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {([["kcal", "ккал"], ["protein", "белки"], ["fat", "жиры"], ["carbs", "углеводы"]] as const).map(([k, l]) => (
              <div key={k} className="text-center py-2 rounded-xl bg-zinc-900">
                <b className="block text-[17px] font-extrabold" style={{ color: MACRO_COLOR[k] }}>{api.fmtN(res[k], 0)}</b>
                <small className="text-[11px] text-zinc-400">{l}</small>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-zinc-500">Формула Миффлина — Сан-Жеора. Похудение −15% калорий, набор +10%. Белок от веса тела, жиры 0,9 г на кг.</p>
          <button onClick={take} className="w-full h-11 rounded-xl bg-zinc-100 text-zinc-950 text-sm font-bold hover:bg-white transition">Взять эти цифры</button>
        </>
      ) : <p className="text-[13px] text-zinc-500">Укажите вес, рост и возраст.</p>}
    </div>
  );
}

function GoalRow({ g }: { g: NutritionGoal }) {
  const items = [["kcal", "ккал"], ["protein", "белки"], ["fat", "жиры"], ["carbs", "углеводы"]] as const;
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-2.5">
      {items.map(([k, l]) => (
        <div key={k} className="text-center py-2 rounded-xl bg-zinc-900">
          <b className="block text-[17px] font-extrabold" style={{ color: MACRO_COLOR[k] }}>{api.fmtN(g[k], 0)}</b>
          <small className="text-[11px] text-zinc-400">{l}</small>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, color, placeholder = "0" }: { label: string; value: string; onChange: (v: string) => void; color: string; placeholder?: string }) {
  return (
    <label className="block text-center rounded-xl bg-zinc-800 px-1 py-2">
      <span className="block text-[11px] text-zinc-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder={placeholder} aria-label={label}
        className="w-full bg-transparent text-center text-lg font-extrabold outline-none placeholder:text-zinc-600" style={{ color }} />
    </label>
  );
}
