import { useEffect, useRef, useState } from "react";
import * as api from "../lib/progress";
import type { DeletedSession, DeleteReason } from "../lib/progress";
import type { Metric, ProgressNote, Session } from "../types";

export function useProgress(planId: string) {
  const [progress, setProgress] = useState<ProgressNote[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [deletedSessions, setDeletedSessions] = useState<DeletedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = () => Promise.all([api.fetchProgress(planId), api.fetchDeletedSessions(planId)]).then(([d, del]) => {
    if (!mountedRef.current) return;
    setProgress(d.progress); setMetrics(d.metrics); setSessions(d.sessions); setDeletedSessions(del); setLoading(false);
  });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.fetchProgress(planId), api.fetchDeletedSessions(planId)]).then(([d, del]) => {
      if (!alive) return;
      setProgress(d.progress); setMetrics(d.metrics); setSessions(d.sessions); setDeletedSessions(del); setLoading(false);
    });
    return () => { alive = false; };
  }, [planId]);

  const addProgress = async () => { const row = await api.addProgress(planId); setProgress((p) => [row, ...p]); };
  const updateProgress = (id: string, patch: Partial<Pick<ProgressNote, "date" | "text">>) => {
    setProgress((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    api.updateProgress(id, patch).catch((e) => console.error("[useProgress] updateProgress:", e));
  };
  const deleteProgress = async (id: string) => { const snap = progress.find((x) => x.id === id); setProgress((p) => p.filter((x) => x.id !== id)); try { await api.deleteProgress(id); } catch (e) { if (snap) setProgress((p) => [...p, snap]); console.error("[useProgress] deleteProgress:", e); } };

  const addMetric = async (m: Omit<Metric, "id">) => { const row = await api.addMetric(planId, m); setMetrics((p) => [...p, row]); };
  const deleteMetric = async (id: string) => { const snap = metrics.find((x) => x.id === id); setMetrics((p) => p.filter((x) => x.id !== id)); try { await api.deleteMetric(id); } catch (e) { if (snap) setMetrics((p) => [...p, snap]); console.error("[useProgress] deleteMetric:", e); } };

  const deleteSession = async (id: string, reason: DeleteReason) => {
    const session = sessions.find((x) => x.id === id);
    setSessions((p) => p.filter((x) => x.id !== id));
    await api.deleteSession(id, reason);
    if (session) setDeletedSessions((p) => [{ id, date: session.date, dayName: session.dayName, deletedAt: new Date().toISOString(), deleteReason: reason }, ...p]);
  };
  const restoreSession = async (id: string) => { await api.restoreSession(id); await load(); };
  const updateSessionReview = (id: string, review: string) => {
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, review } : x)));
    api.updateSessionReview(id, review).catch((e) => console.error("[useProgress] updateSessionReview:", e));
  };
  const purgeSession = async (id: string) => { setDeletedSessions((p) => p.filter((x) => x.id !== id)); await api.permanentlyDeleteSession(id); };

  const logSession = async (metricsIn: Omit<Metric, "id">[], note: string, session: Omit<Session, "id">) => {
    const res = await api.logSession(planId, metricsIn, note, session);
    setMetrics((p) => [...p, ...res.metrics]);
    if (res.progress) setProgress((p) => [res.progress!, ...p]);
    setSessions((p) => [res.session, ...p]);
  };

  return { progress, metrics, sessions, deletedSessions, loading, addProgress, updateProgress, deleteProgress, addMetric, deleteMetric, deleteSession, restoreSession, purgeSession, updateSessionReview, logSession, reload: load };
}
