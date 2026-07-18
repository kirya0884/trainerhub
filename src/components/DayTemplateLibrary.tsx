import { BookOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import ModalShell from "./ModalShell";
import * as api from "../lib/templates";
import type { DayTemplate } from "../lib/templates";
import type { Day, Exercise } from "../types";

interface TplEx {
  tempId: string;
  name: string;
  sets: string;
  reps: string;
  weight: string;
  rest: string;
  note: string;
}

interface EditState {
  id: string | null;
  name: string;
  exercises: TplEx[];
}

function exToTpl(ex: Exercise, i: number): TplEx {
  return { tempId: ex.id || `tmp-${i}`, name: ex.name, sets: ex.sets ?? "", reps: ex.reps ?? "", weight: ex.weight ?? "", rest: ex.rest ?? "", note: ex.note ?? "" };
}

function tplToEx(e: TplEx): Partial<Exercise> & { id: string; name: string; setRows: [] } {
  return { id: e.tempId, name: e.name, sets: e.sets, reps: e.reps, weight: e.weight, rest: e.rest, note: e.note, video: "", detailed: false, group: "", tempo: "", duration: "", target: "", setRows: [] };
}

export default function DayTemplateLibrary({
  trainerId, planId, dayCount, onInserted, onClose,
}: {
  trainerId: string; planId: string; dayCount: number; onInserted: () => void; onClose: () => void;
}) {
  const [templates, setTemplates] = useState<DayTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [insertFor, setInsertFor] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api.fetchDayTemplates(trainerId).then(setTemplates).catch((e) => console.error("[DayTemplateLibrary]:", e)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [trainerId]);

  const startNew = () => setEditing({ id: null, name: "", exercises: [] });
  const startEdit = (t: DayTemplate) =>
    setEditing({ id: t.id, name: t.name, exercises: (t.day.exercises ?? []).map(exToTpl) });

  const addEx = () =>
    setEditing((e) => e ? { ...e, exercises: [...e.exercises, { tempId: `tmp-${Date.now()}`, name: "", sets: "", reps: "", weight: "", rest: "", note: "" }] } : e);
  const updateEx = (tempId: string, patch: Partial<TplEx>) =>
    setEditing((e) => e ? { ...e, exercises: e.exercises.map((ex) => ex.tempId === tempId ? { ...ex, ...patch } : ex) } : e);
  const removeEx = (tempId: string) =>
    setEditing((e) => e ? { ...e, exercises: e.exercises.filter((ex) => ex.tempId !== tempId) } : e);

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) return;
    setSaving(true);
    try {
      const day: Day = {
        id: editing.id ?? "",
        name: editing.name,
        weekday: null,
        exercises: editing.exercises.map(tplToEx) as Exercise[],
        visibleToClient: true,
        dateOf: null,
        mesocycleId: null,
      };
      if (editing.id) {
        await api.updateDayTemplate(editing.id, editing.name, day);
      } else {
        await api.saveDayAsTemplate(trainerId, editing.name, day);
      }
      load();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Удалить шаблон?")) return;
    await api.deleteDayTemplate(id);
    load();
  };

  const handleInsert = async () => {
    if (!insertFor || !insertFor.name.trim()) return;
    const tpl = templates.find((t) => t.id === insertFor.id);
    if (!tpl) return;
    setSaving(true);
    try {
      await api.applyDayTemplate(planId, { ...tpl.day, name: insertFor.name }, dayCount);
      onInserted();
    } finally {
      setSaving(false);
      setInsertFor(null);
    }
  };

  return (
    <ModalShell title="Библиотека шаблонов дней" icon={<BookOpen size={17} className="text-lime-400" />} onClose={onClose} wide>
      <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
        {editing ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 transition"><X size={16} /></button>
              <span className="text-sm text-zinc-400">{editing.id ? "Редактирование шаблона" : "Новый шаблон"}</span>
            </div>
            <input
              autoFocus
              value={editing.name}
              onChange={(e) => setEditing((s) => s ? { ...s, name: e.target.value } : s)}
              placeholder="Название шаблона"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-base font-semibold outline-none focus:border-lime-400/50"
            />
            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-[1fr_2.5rem_3.5rem_3.5rem_3.5rem_1.5rem] gap-1.5 px-2 text-[11px] text-zinc-500 uppercase tracking-wide">
                <span>Упражнение</span><span className="text-center">×</span><span className="text-center">Повт.</span><span className="text-center">Кг</span><span className="text-center">Отд.</span><span />
              </div>
              {editing.exercises.map((ex, i) => (
                <div key={ex.tempId} className="flex items-center gap-1.5 bg-zinc-800/50 rounded-lg p-2">
                  <span className="text-zinc-600 text-xs w-4 shrink-0 text-right">{i + 1}</span>
                  <input value={ex.name} onChange={(e) => updateEx(ex.tempId, { name: e.target.value })}
                    placeholder="Упражнение" className="flex-1 min-w-0 bg-zinc-900 rounded-md px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40" />
                  <input value={ex.sets} onChange={(e) => updateEx(ex.tempId, { sets: e.target.value })}
                    placeholder="×" className="w-10 bg-zinc-900 rounded-md px-1 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40 text-center shrink-0" />
                  <input value={ex.reps} onChange={(e) => updateEx(ex.tempId, { reps: e.target.value })}
                    placeholder="пов." className="w-14 bg-zinc-900 rounded-md px-1 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40 text-center shrink-0" />
                  <input value={ex.weight} onChange={(e) => updateEx(ex.tempId, { weight: e.target.value })}
                    placeholder="кг" className="w-14 bg-zinc-900 rounded-md px-1 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40 text-center shrink-0" />
                  <input value={ex.rest} onChange={(e) => updateEx(ex.tempId, { rest: e.target.value })}
                    placeholder="отд." className="w-14 bg-zinc-900 rounded-md px-1 py-1.5 text-sm outline-none focus:ring-1 focus:ring-lime-400/40 text-center shrink-0" />
                  <button onClick={() => removeEx(ex.tempId)} className="p-1 rounded hover:bg-red-500/20 hover:text-red-400 text-zinc-600 transition shrink-0"><X size={13} /></button>
                </div>
              ))}
              {editing.exercises.length === 0 && (
                <p className="text-zinc-600 text-sm text-center py-3">Нет упражнений — добавь первое</p>
              )}
              <button onClick={addEx} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-lime-400 border border-dashed border-zinc-700 hover:border-lime-400/40 rounded-lg py-2 px-3 w-full justify-center transition">
                <Plus size={14} /> Добавить упражнение
              </button>
            </div>
            <div className="flex gap-2 pt-2 border-t border-zinc-800">
              <button onClick={() => setEditing(null)} className="flex-1 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition">Отмена</button>
              <button onClick={handleSave} disabled={!editing.name.trim() || saving}
                className="flex-1 py-2 text-sm rounded-lg bg-lime-400 text-zinc-950 font-semibold hover:bg-lime-300 transition disabled:opacity-40">
                {saving ? "Сохранение…" : "Сохранить шаблон"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <button onClick={startNew}
              className="w-full flex items-center justify-center gap-1.5 bg-zinc-800/60 hover:bg-zinc-800 border border-dashed border-zinc-700 hover:border-lime-400/40 rounded-xl py-3 text-sm font-medium text-zinc-300 hover:text-lime-400 transition">
              <Plus size={16} /> Создать шаблон дня
            </button>
            {loading && <p className="text-zinc-500 text-sm text-center py-4">Загрузка…</p>}
            {!loading && templates.length === 0 && (
              <p className="text-zinc-600 text-sm text-center py-6">Шаблонов пока нет. Создай первый — сохранишь упражнения и сразу вставишь в любой план.</p>
            )}
            {templates.map((t) => (
              <div key={t.id} className="bg-zinc-800/40 border border-zinc-800 rounded-xl p-3 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{t.day.exercises?.length ?? 0} упр.</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(t)} className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-lime-400 transition" title="Редактировать"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-400 text-zinc-500 transition" title="Удалить"><Trash2 size={14} /></button>
                  </div>
                </div>
                {(t.day.exercises?.length ?? 0) > 0 && (
                  <div className="text-xs text-zinc-500 space-y-1 border-t border-zinc-800/60 pt-2">
                    {(t.day.exercises ?? []).slice(0, 5).map((e, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-zinc-700 w-4 text-right shrink-0">{i + 1}.</span>
                        <span className="text-zinc-300 truncate flex-1">{e.name || "—"}</span>
                        {e.sets && <span className="text-zinc-500 shrink-0">{e.sets}×{e.reps}</span>}
                        {e.weight && <span className="text-zinc-600 shrink-0">{e.weight} кг</span>}
                      </div>
                    ))}
                    {(t.day.exercises?.length ?? 0) > 5 && <p className="text-zinc-600 pl-5">+ ещё {t.day.exercises.length - 5}</p>}
                  </div>
                )}
                {insertFor?.id === t.id ? (
                  <div className="flex gap-2">
                    <input autoFocus value={insertFor.name}
                      onChange={(e) => setInsertFor((s) => s ? { ...s, name: e.target.value } : s)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleInsert(); if (e.key === "Escape") setInsertFor(null); }}
                      placeholder="Название дня в плане"
                      className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-cyan-400/50" />
                    <button onClick={handleInsert} disabled={!insertFor.name.trim() || saving}
                      className="px-3 py-1.5 text-sm rounded-lg bg-cyan-400 text-zinc-950 font-semibold hover:bg-cyan-300 transition disabled:opacity-40">
                      {saving ? "…" : "Вставить"}
                    </button>
                    <button onClick={() => setInsertFor(null)} className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-500 transition"><X size={14} /></button>
                  </div>
                ) : (
                  <button onClick={() => setInsertFor({ id: t.id, name: t.name })}
                    className="w-full text-sm py-1.5 rounded-lg bg-cyan-400/10 hover:bg-cyan-400/20 text-cyan-400 font-medium transition">
                    Вставить в план
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
