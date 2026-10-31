import { useRef, useState } from "react";
import { Database, Download, Upload } from "lucide-react";
import ModalShell from "./ModalShell";
import { downloadBackup, exportBackup, importBackup } from "../lib/backup";
import { ask, notify } from "../lib/dialog";
import { humanError } from "../lib/errors";
import { track } from "../lib/events";
import { isNetworkError } from "../lib/outbox";

export default function BackupModal({ trainerId, onClose }: { trainerId: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setBusy(true);
    try { downloadBackup(await exportBackup(trainerId)); track("action", "backup_export"); }
    catch (e) {
      // Неполную копию не скачиваем — её приняли бы за полную
      console.error("[BackupModal] экспорт:", e);
      notify(isNetworkError(e)
        ? "Копия не сохранена: связь оборвалась или сервер долго не отвечает. Попробуй при хорошем интернете."
        : "Копия не сохранена: сервер не отдал часть данных. Попробуй ещё раз.");
    }
    finally { setBusy(false); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!(await ask("Импорт добавит данные из файла как новые записи (существующие не удаляются и не изменяются). Продолжить?", { ok: "Импортировать" }))) { e.target.value = ""; return; }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      let started = false; // импорт идёт пачками: после сбоя часть данных уже в базе
      try {
        const raw = JSON.parse(String(reader.result));
        setProgress({ done: 0, total: 0 });
        const { skippedNutrition } = await importBackup(trainerId, raw, (done, total) => { started = done > 0; setProgress({ done, total }); });
        track("action", "backup_import");
        setProgress(null);
        notify("Импорт завершён. Обнови страницу, чтобы увидеть новые данные."
          + (skippedNutrition ? `\n\nЗаписи дневников питания клиентов (${skippedNutrition}) не перенесены: их ведут сами клиенты, тренеру база писать в них не даёт. Они сохранены в файле копии.` : ""));
      } catch (err) {
        console.error("[BackupModal] импорт:", err);
        notify("Не удалось импортировать файл: " + humanError(err, "неверный формат или ошибка сервера").replace(/^./, (c) => c.toLowerCase())
          + (started ? "\n\nЧасть данных могла уже добавиться. Проверь клиентов и планы, прежде чем импортировать файл ещё раз — иначе появятся дубли." : ""));
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
        <p className="text-zinc-400">Экспорт сохраняет всех клиентов, планы, записи, шаблоны, питание и журнал заработка в один JSON-файл. Журнал твоих согласий тоже попадает в файл, но только для справки — при импорте он не восстанавливается.</p>
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
