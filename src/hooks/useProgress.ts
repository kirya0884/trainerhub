import { useEffect, useRef, useState } from "react";
import * as api from "../lib/progress";
import { onRevalidate, releaseStale, staleAtOf } from "../lib/offlineCache";
import type { DeletedSession, DeleteReason } from "../lib/progress";
import type { Metric, ProgressNote, Session } from "../types";

export function useProgress(planId: string) {
  const [progress, setProgress] = useState<ProgressNote[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [deletedSessions, setDeletedSessions] = useState<DeletedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false); // история не загрузилась — экран покажет «Не удалось загрузить» вместо «пока нет»
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = () => !planId ? Promise.resolve() : Promise.all([api.fetchProgressCached(planId), api.fetchDeletedSessions(planId).catch(() => [])]).then(([d, del]) => {
    if (!mountedRef.current) return;
    setProgress(d.progress); setMetrics(d.metrics); setSessions(d.sessions); setDeletedSessions(del); setError(false); setLoading(false);
  }).catch((e) => { if (!mountedRef.current) return; console.error("[useProgress] load:", e); setError(true); setLoading(false); });

  useEffect(() => {
    if (!planId) { setProgress([]); setMetrics([]); setSessions([]); setDeletedSessions([]); setError(false); setLoading(false); return; }
    let alive = true;
    setLoading(true); setError(false);
    Promise.all([api.fetchProgressCached(planId), api.fetchDeletedSessions(planId).catch(() => [])]).then(([d, del]) => {
      if (!alive) return;
      setProgress(d.progress); setMetrics(d.metrics); setSessions(d.sessions); setDeletedSessions(del); setLoading(false);
    }).catch((e) => { if (!alive) return; console.error("[useProgress] init:", e); setError(true); setLoading(false); });
    return () => { alive = false; };
  }, [planId]);
  // Вернулась сеть — история могла быть с телефона
  useEffect(() => {
    const off = onRevalidate(() => { if (staleAtOf(`progress:${planId}`) !== null) load(); });
    return () => { off(); releaseStale(`progress:${planId}`); }; // ушли с экрана — отметка снята
  }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

  const addProgress = async () => { try { const row = await api.addProgress(planId); setProgress((p) => [row, ...p]); } catch (e) { console.error("[useProgress] addProgress:", e); } };
  const updateProgress = (id: string, patch: Partial<Pick<ProgressNote, "date" | "text">>) => {
    setProgress((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    api.updateProgress(id, patch).catch((e) => console.error("[useProgress] updateProgress:", e));
  };
  const deleteProgress = async (id: string) => { const snap = progress.find((x) => x.id === id); setProgress((p) => p.filter((x) => x.id !== id)); try { await api.deleteProgress(id); } catch (e) { if (snap) setProgress((p) => [...p, snap]); console.error("[useProgress] deleteProgress:", e); } };

  const addMetric = async (m: Omit<Metric, "id">) => { try { const row = await api.addMetric(planId, m); setMetrics((p) => [...p, row]); } catch (e) { console.error("[useProgress] addMetric:", e); } };
  const deleteMetric = async (id: string) => { const snap = metrics.find((x) => x.id === id); setMetrics((p) => p.filter((x) => x.id !== id)); try { await api.deleteMetric(id); } catch (e) { if (snap) setMetrics((p) => [...p, snap]); console.error("[useProgress] deleteMetric:", e); } };

  const deleteSession = async (id: string, reason: DeleteReason) => {
    const snap = sessions.find((x) => x.id === id);
    setSessions((p) => p.filter((x) => x.id !== id));
    try {
      await api.deleteSession(id, reason);
      if (snap) setDeletedSessions((p) => [{ id, date: snap.date, dayName: snap.dayName, deletedAt: new Date().toISOString(), deleteReason: reason }, ...p]);
    } catch (e) {
      if (snap) setSessions((p) => [...p, snap]);
      console.error("[useProgress] deleteSession:", e);
    }
  };
  const restoreSession = async (id: string) => { try { await api.restoreSession(id); await load(); } catch (e) { console.error("[useProgress] restoreSession:", e); } };
  const updateSessionReview = (id: string, review: string) => {
    setSessions((p) => p.map((x) => (x.id === id ? { ...x, review } : x)));
    api.updateSessionReview(id, review).catch((e) => console.error("[useProgress] updateSessionReview:", e));
  };
  const purgeSession = async (id: string) => {
    const snap = deletedSessions.find((x) => x.id === id);
    setDeletedSessions((p) => p.filter((x) => x.id !== id));
    try { await api.permanentlyDeleteSession(id); }
    catch (e) { if (snap) setDeletedSessions((p) => [...p, snap]); console.error("[useProgress] purgeSession:", e); }
  };

  const logSession = async (metricsIn: Omit<Metric, "id">[], note: string, session: Omit<Session, "id">) => {
    try {
      const res = await api.logSession(planId, metricsIn, note, session);
      setMetrics((p) => [...p, ...res.metrics]);
      if (res.progress) setProgress((p) => [res.progress!, ...p]);
      setSessions((p) => [res.session, ...p]);
    } catch (e) { console.error("[useProgress] logSession:", e); throw e; }
  };

  return { progress, metrics, sessions, deletedSessions, loading, error, reloadProgress: load, addProgress, updateProgress, deleteProgress, addMetric, deleteMetric, deleteSession, restoreSession, purgeSession, updateSessionReview, logSession, reload: load };
}
