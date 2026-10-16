import { useRef, useState } from "react";
import { Database, Download, Upload } from "lucide-react";
import ModalShell from "./ModalShell";
import { downloadBackup, exportBackup, importBackup } from "../lib/backup";
import { ask, notify } from "../lib/dialog";
import { track } from "../lib/events";

export default function BackupModal({ trainerId, onClose }: { trainerId: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setBusy(true);
    try { downloadBackup(await exportBackup(trainerId)); track("action", "backup_export"); }
    finally { setBusy(false); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!(await ask("Импорт добавит данные из файла как новые записи (существующие не удаляются и не изменяются). Продолжить?", { ok: "Импортировать" }))) { e.target.value = ""; return; }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = JSON.parse(String(reader.result));
        setProgress({ done: 0, total: 0 });
        const { skippedNutrition } = await importBackup(trainerId, raw, (done, total) => setProgress({ done, total }));
        track("action", "backup_import");
        setProgress(null);
        notify("Импорт завершён. Обновите страницу, чтобы увидеть новые данные."
          + (skippedNutrition ? `\n\nЗаписи дневников питания подопечных (${skippedNutrition}) не перенесены: их ведут сами подопечные, тренеру база писать в них не даёт. Они сохранены в файле копии.` : ""));
      } catch (err: any) {
        notify("Не удалось импортировать файл: " + (err?.message || "неверный формат"));
      } finally {
        setBusy(false);
        setProgress(null);
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  return (
    <ModalShell title="Резервная копия" icon={<Database size={17} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3 text-sm">
        <p className="text-zinc-400">Экспорт сохраняет всех подопечных, планы, записи, шаблоны и питание в один JSON-файл.</p>
        <button onClick={doExport} disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-xl py-2.5 hover:bg-lime-300 transition disabled:opacity-50"><Download size={16} /> Экспортировать всё</button>

        <div className="border-t border-zinc-800 pt-3">
          <p className="text-zinc-400 mb-2">Импорт добавляет данные из файла как новые записи — ничего не перезаписывает и не удаляет.</p>
          <label className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl py-2.5 transition cursor-pointer">
            <Upload size={16} /> {busy ? (progress ? `Импорт ${progress.done}/${progress.total}...` : "Импорт...") : "Импортировать файл"}
            <input ref={fileRef} type="file" accept="application/json" onChange={onFile} disabled={busy} className="hidden" />
          </label>
        </div>
      </div>
    </ModalShell>
  );
}
