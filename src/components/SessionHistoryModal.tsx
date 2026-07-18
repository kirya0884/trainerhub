import { CalendarCheck } from "lucide-react";
import { useEffect, useState } from "react";
import * as bookingsApi from "../lib/bookings";
import { fmtDate } from "../lib/format";
import ModalShell from "./ModalShell";

export default function SessionHistoryModal({ trainerId, clientId, onClose }: { trainerId: string; clientId: string; onClose: () => void }) {
  const [sessions, setSessions] = useState<{ date: string; time: string }[] | null>(null);

  useEffect(() => { bookingsApi.fetchClientDoneSessions(trainerId, clientId).then(setSessions).catch((e) => console.error("[SessionHistoryModal]:", e)); }, [trainerId, clientId]);

  return (
    <ModalShell title="История тренировок" icon={<CalendarCheck size={16} className="text-lime-400" />} onClose={onClose}>
      <div className="p-4 overflow-y-auto space-y-1.5">
        {sessions === null && <p className="text-sm text-zinc-500">Загрузка...</p>}
        {sessions?.length === 0 && <p className="text-sm text-zinc-600">Проведённых тренировок пока нет</p>}
        {sessions?.map((s, i) => (
          <div key={i} className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-3 py-2 text-sm">
            <span className="text-zinc-200">{fmtDate(s.date)}</span>
            {s.time && <span className="text-zinc-500 font-mono text-xs">{s.time}</span>}
          </div>
        ))}
        {sessions && sessions.length > 0 && <p className="text-xs text-zinc-600 pt-1">Всего проведено: {sessions.length}</p>}
      </div>
    </ModalShell>
  );
}
