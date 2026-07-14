import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Layers, Timer, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fetchPlan } from "../lib/plans";
import type { Day } from "../types";
import ModalShell from "./ModalShell";

interface ActiveSession {
  planId: string;
  dayId: string;
  dayName: string;
  startedAt: number;
  progress?: Record<string, { done: boolean; setsDone?: Record<number, boolean>; note?: string }>;
}

interface Props {
  clientId: string;
  clientName: string;
  clientColor: string;
  activeSession: ActiveSession;
  onClose: () => void;
}

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function LiveWorkoutModal({ clientId, clientName, clientColor, activeSession, onClose }: Props) {
  const [day, setDay] = useState<Day | null>(null);
  const [progress, setProgress] = useState<ActiveSession["progress"]>(activeSession.progress ?? {});
  const [elapsed, setElapsed] = useState(Date.now() - activeSession.startedAt);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Load plan day exercises
  useEffect(() => {
    fetchPlan(activeSession.planId)
      .then((plan) => {
        const d = plan?.days.find((d) => d.id === activeSession.dayId);
        setDay(d ?? null);
      })
      .catch(() => {});
  }, [activeSession.planId, activeSession.dayId]);

  // Supabase realtime subscription on client record
  useEffect(() => {
    channelRef.current = supabase
      .channel("live-workout-" + clientId)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "clients", filter: `id=eq.${clientId}` },
        (payload: any) => {
          const sess = payload.new?.active_session;
          if (sess?.progress) setProgress(sess.progress);
        }
      )
      .subscribe();
    return () => { channelRef.current?.unsubscribe(); };
  }, [clientId]);

  // Elapsed timer
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - activeSession.startedAt), 1000);
    return () => clearInterval(t);
  }, [activeSession.startedAt]);

  const exercises = day?.exercises ?? [];
  const doneCount = exercises.filter((ex) => progress?.[ex.id]?.done).length;

  return (
    <ModalShell title={`Тренировка — ${clientName}`} onClose={onClose}>
      <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">

        {/* Header stats */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-zinc-950 text-sm shrink-0" style={{ background: clientColor }}>
            {clientName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-zinc-100 truncate">{activeSession.dayName}</p>
            <p className="text-xs text-zinc-500">{doneCount} из {exercises.length} упражнений выполнено</p>
          </div>
          <div className="flex items-center gap-1.5 text-cyan-400 text-sm font-mono font-semibold shrink-0">
            <Timer size={14} />
            {fmtTime(elapsed)}
          </div>
        </div>

        {/* Progress bar */}
        {exercises.length > 0 && (
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.round((doneCount / exercises.length) * 100)}%`, background: "var(--accent, #a3e635)" }}
            />
          </div>
        )}

        {/* Exercise list */}
        {day === null && (
          <p className="text-sm text-zinc-500 text-center py-4">Загрузка упражнений...</p>
        )}
        {exercises.length === 0 && day !== null && (
          <p className="text-sm text-zinc-500 text-center py-4">Нет упражнений в этом дне</p>
        )}
        <div className="space-y-2">
          {exercises.map((ex, idx) => {
            const p = progress?.[ex.id];
            const done = !!p?.done;
            const setsTotal = ex.detailed ? (ex.setRows?.length ?? 0) : (parseInt(ex.sets) || 0);
            const setsDoneCount = p?.setsDone ? Object.values(p.setsDone).filter(Boolean).length : (done ? setsTotal : 0);

            return (
              <div
                key={ex.id}
                className="flex items-start gap-3 rounded-xl p-3 transition"
                style={{ background: done ? "rgba(163,230,53,0.07)" : "rgba(39,39,42,0.8)", border: `1px solid ${done ? "rgba(163,230,53,0.2)" : "rgba(63,63,70,0.6)"}` }}
              >
                <div className="shrink-0 mt-0.5">
                  {done
                    ? <CheckCircle2 size={18} style={{ color: "var(--accent, #a3e635)" }} />
                    : <Circle size={18} className="text-zinc-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${done ? "line-through text-zinc-500" : "text-zinc-100"}`}>
                    <span className="text-zinc-600 mr-1.5">{idx + 1}.</span>{ex.name || "—"}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {ex.sets && <span className="text-xs text-zinc-500">{ex.sets} × {ex.reps}</span>}
                    {ex.weight && <span className="text-xs text-zinc-500">{ex.weight}</span>}
                    {setsTotal > 0 && (
                      <span className="text-xs flex items-center gap-1" style={{ color: done ? "var(--accent,#a3e635)" : "#71717a" }}>
                        <Layers size={11} />
                        {setsDoneCount}/{setsTotal} подходов
                      </span>
                    )}
                  </div>
                  {p?.note && <p className="text-xs text-zinc-500 mt-1 italic">"{p.note}"</p>}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-zinc-600 text-center pt-1">Страница обновляется в реальном времени</p>
      </div>
    </ModalShell>
  );
}
