import { useEffect, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { supabase } from "../lib/supabase";

export type FirstStep = "profile" | "client" | "plan" | "booking" | "access";
const STEPS: { key: FirstStep; label: string }[] = [
  { key: "profile", label: "Укажи своё имя — его увидят клиенты" },
  { key: "client", label: "Добавь первого клиента" },
  { key: "plan", label: "Составь ему план тренировок" },
  { key: "booking", label: "Запиши на тренировку" },
  { key: "access", label: "Выдай клиенту доступ в кабинет" },
];

// Разбор путей 1.1: после регистрации тренер видел «0 ₽», «Тренировок не запланировано» и свой
// email вместо имени — и не понимал, с чего начать. Чеклист отмечается по реальным данным,
// проходится частями и исчезает, когда всё сделано (или если его закрыть).
export default function FirstSteps({ trainerId, bookingsCount, onGo }: { trainerId: string; bookingsCount: number; onGo: (s: FirstStep) => void }) {
  const KEY = `reps-first-steps-hidden-${trainerId}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  // Запись считаем по уже загруженному календарю, остальное — один раз при показе главной
  const [loaded, setLoaded] = useState<Omit<Record<FirstStep, boolean>, "booking"> | null>(null);
  useEffect(() => {
    if (hidden) return;
    let alive = true;
    (async () => {
      try {
        const [self, clients, plans, access] = await Promise.all([
          // Только имя: в профиле лежит фото, тянуть его ради одной галочки незачем
          supabase.from("trainers").select("name:profile->>name").eq("id", trainerId).maybeSingle(),
          supabase.from("clients").select("id", { count: "exact", head: true }).eq("trainer_id", trainerId).is("deleted_at", null).eq("is_self", false),
          supabase.from("plans").select("id", { count: "exact", head: true }).eq("trainer_id", trainerId).is("deleted_at", null),
          supabase.from("clients").select("id", { count: "exact", head: true }).eq("trainer_id", trainerId).is("deleted_at", null).eq("is_self", false).not("auth_user_id", "is", null),
        ]);
        const err = self.error || clients.error || plans.error || access.error;
        if (err) throw err;
        if (!alive) return;
        setLoaded({ profile: !!String((self.data as { name?: string } | null)?.name ?? "").trim(), client: !!clients.count, plan: !!plans.count, access: !!access.count });
      } catch (e) { console.error("[FirstSteps]", e); }
    })();
    return () => { alive = false; };
  }, [trainerId, hidden]);
  const done = loaded && { ...loaded, booking: bookingsCount > 0 };
  const all = !!done && Object.values(done).every(Boolean);
  // Всё сделано — больше не показываем и не запрашиваем
  useEffect(() => { if (all) { try { localStorage.setItem(KEY, "1"); } catch { /* приватный режим */ } } }, [all, KEY]);

  if (hidden || !done || all) return null;
  const left = STEPS.filter((s) => !done[s.key]).length;
  return (
    <div className="relative bg-zinc-900 border border-lime-400/30 rounded-3xl p-4">
      <button onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* приватный режим */ } setHidden(true); }} aria-label="Скрыть первые шаги" className="absolute right-2 top-2 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200"><X size={16} /></button>
      <p className="font-bold">Первые шаги</p>
      <p className="text-xs text-zinc-500 mb-2">осталось {left} из {STEPS.length}</p>
      <div className="space-y-1">
        {STEPS.map((s) => (
          <button key={s.key} onClick={() => !done[s.key] && onGo(s.key)} disabled={done[s.key]}
            className="w-full min-h-11 flex items-center gap-2.5 px-2 rounded-xl text-left text-sm hover:bg-zinc-800 transition disabled:hover:bg-transparent">
            <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${done[s.key] ? "bg-lime-400 text-zinc-950" : "border border-zinc-600"}`}>{done[s.key] && <Check size={14} strokeWidth={3} />}</span>
            <span className={`flex-1 ${done[s.key] ? "text-zinc-500 line-through" : "text-zinc-200"}`}>{s.label}</span>
            {!done[s.key] && <ChevronRight size={16} className="text-zinc-500 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}
