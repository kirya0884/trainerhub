import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { DocLink } from "./LegalLink";
import { recordConsents, type ConsentKind, type Role } from "../lib/consents";
import { signOutAndForget } from "../lib/offlineCache";

type Age = "adult" | "teen" | "child";

function Check({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 text-sm text-zinc-300 leading-relaxed cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="mt-0.5 accent-lime-400 shrink-0 w-5 h-5" />
      <span>{children}</span>
    </label>
  );
}
function AgeOpt({ v, age, pick, label }: { v: Age; age: Age | null; pick: (v: Age) => void; label: string }) {
  return (
    <label className={`flex items-center gap-3 rounded-xl px-3 min-h-11 py-2 text-sm cursor-pointer border ${age === v ? "border-lime-400/60 bg-lime-400/10 text-zinc-100" : "border-zinc-800 text-zinc-300"}`}>
      <input type="radio" name="age" checked={age === v} onChange={() => pick(v)} className="accent-lime-400 w-4 h-4 shrink-0" />{label}
    </label>
  );
}

// Экран согласия при входе: тренеру — соглашение и обработка данных; подопечному — ещё
// отдельное согласие на сведения о здоровье (ст. 10 152-ФЗ) и возраст (за младших — представитель).
export default function ConsentGate({ role, onDone }: { role: Role; onDone: () => void }) {
  const [main, setMain] = useState(false);
  const [health, setHealth] = useState(false);
  const [age, setAge] = useState<Age | null>(null);
  const [guardian, setGuardian] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isClient = role === "client";
  const ready = main && (!isClient || (health && age && (age === "adult" || guardian)));

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      const kinds: ConsentKind[] = isClient ? ["terms", "consent_client", "health"] : ["terms", "consent"];
      if (isClient && age !== "adult") kinds.push("guardian");
      await recordConsents(kinds, isClient ? { age } : {});
      onDone();
    } catch (e) {
      console.error("[ConsentGate]", e);
      setErr("Не удалось сохранить. Проверьте интернет и попробуйте ещё раз.");
      setBusy(false);
    }
  };

  const pickAge = (v: Age) => { setAge(v); setGuardian(false); };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-8">
      <div className="max-w-md mx-auto space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-lime-400/15 text-lime-400 flex items-center justify-center"><ShieldCheck size={24} /></div>
        <h1 className="text-2xl font-extrabold tracking-tight">{isClient ? "Перед входом в кабинет" : "Документы обновились"}</h1>
        <p className="text-sm text-zinc-400 leading-relaxed">
          {isClient
            ? "Тренер ведёт вашу программу и прогресс в Reps. Чтобы мы могли хранить эти данные, нужно ваше согласие."
            : "Чтобы продолжить работу, подтвердите условия сервиса. Это нужно один раз для текущей редакции документов."}
        </p>

        {isClient && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Ваш возраст</p>
            <AgeOpt v="adult" age={age} pick={pickAge} label="Мне есть 18 лет" />
            <AgeOpt v="teen" age={age} pick={pickAge} label="Мне от 14 до 18 лет" />
            <AgeOpt v="child" age={age} pick={pickAge} label="Мне меньше 14 лет — заполняет родитель" />
          </div>
        )}

        <Check on={main} set={setMain}>
          Принимаю <DocLink slug="terms">пользовательское соглашение</DocLink> и даю {isClient
            ? <DocLink slug="consent-client">согласие на обработку моих персональных данных</DocLink>
            : <DocLink slug="consent">согласие на обработку персональных данных</DocLink>} на условиях <DocLink slug="privacy">политики</DocLink>
        </Check>
        {isClient && (
          <Check on={health} set={setHealth}>
            Отдельно даю согласие на обработку <b className="text-zinc-100">сведений о здоровье</b>: вес, замеры, фото прогресса, ограничения, самочувствие, питание. Без них кабинет не сможет показывать программу и прогресс.
          </Check>
        )}
        {isClient && age && age !== "adult" && (
          <Check on={guardian} set={setGuardian}>
            {age === "teen"
              ? "Мой родитель или законный представитель знает об этом и согласен на обработку моих данных."
              : "Я — родитель или законный представитель ребёнка и даю эти согласия от его имени."}
          </Check>
        )}

        {err && <p className="text-sm text-red-400">{err}</p>}
        <button onClick={submit} disabled={!ready || busy} className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition active:scale-[0.98] disabled:opacity-40">
          {busy ? "Сохраняем…" : "Продолжить"}
        </button>
        <button onClick={() => signOutAndForget()} className="w-full h-11 text-sm text-zinc-500 hover:text-zinc-300">Не согласен — выйти</button>
        <p className="text-xs text-zinc-500 leading-relaxed">Согласие можно отозвать в любой момент: удалить аккаунт в профиле или написать оператору — контакты в политике.</p>
      </div>
    </div>
  );
}
