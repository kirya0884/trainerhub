import { useRef, useState } from "react";
import { Database, Download, Upload } from "lucide-react";
import ModalShell from "./ModalShell";
import { downloadBackup, exportBackup, importBackup } from "../lib/backup";

export default function BackupModal({ trainerId, onClose }: { trainerId: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setBusy(true);
    try { downloadBackup(await exportBackup(trainerId)); }
    finally { setBusy(false); }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm("Импорт добавит данные из файла как новые записи (существующие не удаляются и не изменяются). Продолжить?")) { e.target.value = ""; return; }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = JSON.parse(String(reader.result));
        await importBackup(trainerId, raw);
        alert("Импорт завершён. Обновите страницу, чтобы увидеть новые данные.");
      } catch (err: any) {
        alert("Не удалось импортировать файл: " + (err?.message || "неверный формат"));
      } finally {
        setBusy(false);
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  return (
    <ModalShell title="Резервная копия" icon={<Database size={17} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 space-y-3 text-sm">
        <p className="text-zinc-400">Экспорт сохраняет всех подопечных, планы, записи и шаблоны в один JSON-файл.</p>
        <button onClick={doExport} disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-lime-400 text-zinc-950 font-semibold rounded-lg py-2.5 hover:bg-lime-300 transition disabled:opacity-50"><Download size={16} /> Экспортировать всё</button>

        <div className="border-t border-zinc-800 pt-3">
          <p className="text-zinc-400 mb-2">Импорт добавляет данные из файла как новые записи — ничего не перезаписывает и не удаляет.</p>
          <label className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg py-2.5 transition cursor-pointer">
            <Upload size={16} /> {busy ? "Импорт..." : "Импортировать файл"}
            <input ref={fileRef} type="file" accept="application/json" onChange={onFile} disabled={busy} className="hidden" />
          </label>
        </div>
      </div>
    </ModalShell>
  );
}
