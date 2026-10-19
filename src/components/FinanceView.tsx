import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Check, ChevronLeft, ChevronRight, Download, Eye, EyeOff, Search } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchDashboardData } from "../lib/dashboard";
import type { DashboardClient, DashboardPayment } from "../lib/dashboard";
import { expandBookings } from "../lib/bookings";
import type { Booking } from "../lib/bookings";
import { cohortRetention, debtClients, revenueBySource, topClientsByRevenue, trialConversionRate } from "../lib/analytics";
import { exportAnalyticsCsv } from "../lib/exportAnalytics";
import { markPaymentPaid } from "../lib/payments";
import { addDays, addMonths, plural, toDateStr, today as todayFn } from "../lib/format";
import { chartColors } from "../lib/themeColor";
import { notify } from "../lib/dialog";
import { SkeletonRows } from "./Skeleton";
import RenewModal from "./RenewModal";

// Финансы тренера: поступления и заработок за период со сравнением с прошлым,
// кто должен, кому скоро продлевать, откуда деньги и журнал всех оплат.
type Grain = "week" | "month" | "quarter" | "year";
const GRAINS: [Grain, string][] = [["week", "Неделя"], ["month", "Месяц"], ["quarter", "Квартал"], ["year", "Год"]];
const TYPE_LABEL: Record<string, string> = { sessions: "Пакеты тренировок", subscription: "Подписка", single: "Разовые" };
const HIDE_KEY = "th-hide-money";

const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthStart = (s: string) => s.slice(0, 7) + "-01";
const rangeOf = (grain: Grain, offset: number) => {
  const t = todayFn();
  if (grain === "week") {
    const d = new Date(t + "T00:00:00");
    const from = addDays(toDateStr(d), -((d.getDay() + 6) % 7) + offset * 7);
    return { from, to: addDays(from, 6) };
  }
  const months = grain === "month" ? 1 : grain === "quarter" ? 3 : 12;
  const m0 = Number(t.slice(5, 7)) - 1;
  const base = grain === "month" ? monthStart(t) : grain === "quarter" ? `${t.slice(0, 4)}-${String(m0 - (m0 % 3) + 1).padStart(2, "0")}-01` : `${t.slice(0, 4)}-01-01`;
  const from = addMonths(base, offset * months);
  return { from, to: addDays(addMonths(from, months), -1) };
};
const rangeLabel = (grain: Grain, from: string, to: string) => {
  const d = new Date(from + "T00:00:00");
  if (grain === "year") return String(d.getFullYear());
  if (grain === "month") return capFirst(d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", ""));
  if (grain === "quarter") return `${["I", "II", "III", "IV"][Math.floor(d.getMonth() / 3)]} квартал ${d.getFullYear()}`;
  const f = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  return `${f(from)} – ${f(to)}`;
};
// Столбики графика внутри периода: дни недели/месяца, недели квартала, месяцы года
const bucketsOf = (grain: Grain, from: string, to: string) => {
  const out: { key: string; end: string; label: string }[] = [];
  if (grain === "year") {
    for (let m = from; m <= to; m = addMonths(m, 1)) out.push({ key: m, end: addDays(addMonths(m, 1), -1), label: new Date(m + "T00:00:00").toLocaleDateString("ru-RU", { month: "short" }).replace(".", "") });
  } else if (grain === "quarter") {
    for (let w = from; w <= to; w = addDays(w, 7)) out.push({ key: w, end: addDays(w, 6) > to ? to : addDays(w, 6), label: new Date(w + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "") });
  } else {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ key: d, end: d, label: grain === "week" ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][(new Date(d + "T00:00:00").getDay() + 6) % 7] : String(Number(d.slice(8))) });
  }
  return out;
};
const pricePerSession = (c: DashboardClient) => {
  const m = c.membership;
  if (m.type === "subscription") return Number(m.pricePerSession) || 0;
  const total = Number(m.total);
  return total > 0 ? (Number(m.packagePrice) || 0) / total : 0;
};

export default function FinanceView({ trainerId, bookings, onOpenClient, onBack }: { trainerId: string; bookings: Booking[]; onOpenClient: (id: string) => void; onBack: () => void }) {
  const [data, setData] = useState<{ clients: DashboardClient[]; payments: DashboardPayment[] } | null>(null);
  const [error, setError] = useState("");
  const [grain, setGrain] = useState<Grain>("month");
  const [offset, setOffset] = useState(0);
  const [hide, setHide] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } });
  const [q, setQ] = useState("");
  const [renew, setRenew] = useState<DashboardClient | null>(null);
  const load = () => fetchDashboardData(trainerId).then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, [trainerId]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleHide = () => setHide((v) => { try { localStorage.setItem(HIDE_KEY, v ? "0" : "1"); } catch { /* приватный режим */ } return !v; });

  const t = todayFn();
  const cur = rangeOf(grain, offset), prev = rangeOf(grain, offset - 1);
  const rub = (v: number) => (hide ? "• • •" : `${Math.round(v).toLocaleString("ru-RU")} ₽`);

  const stats = useMemo(() => {
    if (!data) return null;
    const byId = Object.fromEntries(data.clients.map((c) => [c.id, c]));
    const calc = (r: { from: string; to: string }) => {
      const pays = data.payments.filter((p) => p.date >= r.from && p.date <= r.to);
      const paid = pays.filter((p) => p.payStatus === "paid");
      const occs = r.from > t ? [] : expandBookings(bookings, r.from, r.to < t ? r.to : t);
      const done = occs.filter((o) => o.status === "done");
      const noShow = occs.filter((o) => o.status === "no-show").length;
      const earned = done.reduce((s, o) => s + o.clientIds.reduce((a, id) => a + (byId[id] ? pricePerSession(byId[id]) : 0), 0), 0);
      const received = paid.reduce((s, p) => s + p.amount, 0);
      return {
        pays, paid, received, earned, done: done.length,
        attendance: done.length + noShow ? Math.round((done.length / (done.length + noShow)) * 100) : null,
        avg: paid.length ? received / paid.length : 0,
        payers: new Set(paid.map((p) => p.clientId)).size,
      };
    };
    return { byId, cur: calc(cur), prev: calc(prev) };
  }, [data, bookings, cur.from, cur.to, prev.from, prev.to, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Shell onBack={onBack}><p className="text-sm text-red-400">Не удалось загрузить: {error}</p></Shell>;
  if (!data || !stats) return <Shell onBack={onBack}><SkeletonRows rows={5} /></Shell>;

  const { clients, payments } = data;
  const { byId, cur: c, prev: p } = stats;
  const active = clients.filter((x) => x.status !== "left");
  const pending = payments.filter((x) => x.payStatus !== "paid").sort((a, b) => a.date.localeCompare(b.date));
  const pendingSum = pending.reduce((s, x) => s + x.amount, 0);
  const debt = debtClients(clients);
  const soon = addDays(t, 14);
  const renewals = active.flatMap((x) => {
    const m = x.membership;
    if (m.type === "subscription" && m.nextPaymentDate && m.nextPaymentDate >= t && m.nextPaymentDate <= soon)
      return [{ c: x, when: m.nextPaymentDate as string, note: "подписка", amount: Number(m.pricePerSession) || 0 }];
    const r = Number(m.remaining);
    if (m.type === "sessions" && m.remaining !== "" && m.remaining != null && (r === 1 || r === 2))
      return [{ c: x, when: "", note: `осталось ${r} ${plural(r, ["тренировка", "тренировки", "тренировок"])}`, amount: Number(m.packagePrice) || 0 }];
    return [];
  }).sort((a, b) => (a.when || "9").localeCompare(b.when || "9"));
  const renewSum = renewals.reduce((s, x) => s + x.amount, 0);

  const buckets = bucketsOf(grain, cur.from, cur.to).map((b) => ({
    label: b.label, from: b.key, to: b.end,
    total: c.paid.filter((x) => x.date >= b.key && x.date <= b.end).reduce((s, x) => s + x.amount, 0),
  }));
  const byType = Object.entries(c.paid.reduce<Record<string, number>>((acc, x) => { const k = x.type || "other"; acc[k] = (acc[k] || 0) + x.amount; return acc; }, {}))
    .map(([k, v]) => ({ label: TYPE_LABEL[k] ?? "Другое", total: v })).sort((a, b) => b.total - a.total);
  const bySource = revenueBySource(clients, c.paid);
  const top = topClientsByRevenue(clients, c.paid, 5);
  const journal = [...c.pays].sort((a, b) => b.date.localeCompare(a.date))
    .filter((x) => !q.trim() || (byId[x.clientId]?.name ?? "").toLowerCase().includes(q.trim().toLowerCase()));
  const conversion = trialConversionRate(clients);
  const cohorts = cohortRetention(clients);
  const cc = chartColors();

  const settle = async (pay: DashboardPayment) => {
    try { await markPaymentPaid(pay.id); await load(); }
    catch (e) { console.error("[FinanceView] markPaymentPaid:", e); notify("Не удалось отметить оплату."); }
  };

  return (
    <Shell onBack={onBack} right={
      <button onClick={toggleHide} aria-label={hide ? "Показать суммы" : "Скрыть суммы"} title={hide ? "Показать суммы" : "Скрыть суммы"}
        className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition">{hide ? <Eye size={19} /> : <EyeOff size={19} />}</button>
    }>
      {/* Период: тип и переключение назад/вперёд */}
      <div className="space-y-2">
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
          {GRAINS.map(([k, l]) => (
            <button key={k} onClick={() => { setGrain(k); setOffset(0); }} aria-pressed={grain === k}
              className={`flex-1 h-9 rounded-lg text-sm font-semibold transition ${grain === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <p className="flex-1 min-w-0 font-bold truncate pl-1">{rangeLabel(grain, cur.from, cur.to)}</p>
          {offset !== 0 && <button onClick={() => setOffset(0)} className="h-9 px-2.5 rounded-lg text-sm font-semibold text-lime-400 hover:bg-zinc-800 transition">Сейчас</button>}
          <button onClick={() => setOffset((o) => o - 1)} aria-label="Предыдущий период" className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-400"><ChevronLeft size={20} /></button>
          <button onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0} aria-label="Следующий период" className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 disabled:hover:bg-transparent"><ChevronRight size={20} /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Поступило" value={rub(c.received)} cur={c.received} prev={p.received} hide={hide} hint="Оплаты со статусом «оплачено»" accent />
        <Kpi label="Заработано" value={rub(c.earned)} cur={c.earned} prev={p.earned} hide={hide} hint="Стоимость проведённых тренировок по цене абонемента" />
        <Kpi label="Оплат" value={String(c.paid.length)} cur={c.paid.length} prev={p.paid.length} sub={c.paid.length ? `средний чек ${rub(c.avg)}` : undefined} />
        <Kpi label="Платящих клиентов" value={String(c.payers)} cur={c.payers} prev={p.payers} />
        <Kpi label="Проведено тренировок" value={String(c.done)} cur={c.done} prev={p.done} />
        <Kpi label="Посещаемость" value={c.attendance != null ? `${c.attendance}%` : "—"} cur={c.attendance ?? undefined} prev={p.attendance ?? undefined} hint="Проведённые из проведённых и «Не пришёл»" />
      </div>

      <Card title="Поступления" sub={grain === "year" ? "по месяцам" : grain === "quarter" ? "по неделям" : "по дням"}>
        {c.received > 0 && !hide ? (
          <div style={{ height: 170 }} className="text-lime-400 -ml-2">
            <ResponsiveContainer>
              <BarChart data={buckets} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} vertical={false} />
                <XAxis dataKey="label" stroke={cc.axis} fontSize={11} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
                <YAxis stroke={cc.axis} fontSize={11} tickLine={false} width={44} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}к` : String(v))} />
                <Tooltip cursor={{ fill: cc.grid, opacity: 0.4 }} contentStyle={{ background: cc.tooltipBg, border: `1px solid ${cc.tooltipBorder}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: cc.tooltipLabel }} formatter={(v: any) => [`${Number(v).toLocaleString("ru-RU")} ₽`, "Поступило"]} />
                <Bar dataKey="total" fill="currentColor" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="text-sm text-zinc-500 text-center py-6">{hide ? "Суммы скрыты" : "За этот период оплат нет"}</p>}
      </Card>

      {(pending.length > 0 || debt.length > 0) && (
        <Card title="Ждут оплаты" sub={pending.length ? `всего ${rub(pendingSum)}` : undefined}>
          <div className="divide-y divide-zinc-800">
            {pending.map((x) => (
              <div key={x.id} className="flex items-center gap-2.5 py-2.5">
                <ClientDot c={byId[x.clientId]} />
                <button onClick={() => onOpenClient(x.clientId)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold truncate">{byId[x.clientId]?.name ?? "—"}</p>
                  <p className="text-xs text-zinc-500">{fmtShort(x.date)} · {x.payStatus === "installment" ? "частями" : "позже"}</p>
                </button>
                <span className="text-sm font-bold text-orange-300 shrink-0">{rub(x.amount)}</span>
                <button onClick={() => settle(x)} className="h-9 px-2.5 shrink-0 flex items-center gap-1 rounded-lg bg-lime-400/15 text-lime-400 text-[13px] font-semibold hover:bg-lime-400/25 transition"><Check size={14} /> Оплачено</button>
              </div>
            ))}
            {debt.map((x) => (
              <div key={x.id} className="flex items-center gap-2.5 py-2.5">
                <ClientDot c={x} />
                <button onClick={() => onOpenClient(x.id)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold truncate">{x.name}</p>
                  <p className="text-xs text-orange-400">Пакет закончился</p>
                </button>
                <button onClick={() => setRenew(x)} className="h-9 px-3 shrink-0 rounded-lg bg-zinc-800 text-zinc-100 text-[13px] font-semibold hover:bg-zinc-700 transition">Продлить</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {renewals.length > 0 && (
        <Card title="Скоро продление" sub={`в ближайшие 2 недели · ожидается ${rub(renewSum)}`}>
          <div className="divide-y divide-zinc-800">
            {renewals.map(({ c: x, when, note, amount }) => (
              <div key={x.id} className="flex items-center gap-2.5 py-2.5">
                <ClientDot c={x} />
                <button onClick={() => onOpenClient(x.id)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold truncate">{x.name}</p>
                  <p className="text-xs text-zinc-500">{when ? `${note} · ${fmtShort(when)}` : note}</p>
                </button>
                {amount > 0 && <span className="text-sm text-zinc-300 shrink-0">{rub(amount)}</span>}
                <button onClick={() => setRenew(x)} className="h-9 px-3 shrink-0 rounded-lg bg-zinc-800 text-zinc-100 text-[13px] font-semibold hover:bg-zinc-700 transition">Продлить</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {c.received > 0 && (
        <Card title="Откуда деньги" sub="за период">
          <div className="space-y-4">
            <Bars title="По типу оплаты" items={byType.map((x) => ({ label: x.label, value: x.total }))} total={c.received} rub={rub} />
            {bySource.length > 1 && <Bars title="По источнику клиента" items={bySource.map((x) => ({ label: x.source, value: x.total }))} total={c.received} rub={rub} />}
            <Bars title="Клиенты, принёсшие больше всего" items={top.map((x) => ({ label: x.c.name, value: x.total, color: x.c.color }))} total={c.received} rub={rub} />
          </div>
        </Card>
      )}

      <Card title="Платежи" sub={`${c.pays.length} за период`} right={
        <button onClick={() => exportAnalyticsCsv(clients, payments, cur.from, cur.to)} className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-[13px] font-semibold hover:bg-zinc-700 transition"><Download size={14} /> Excel</button>
      }>
        {c.pays.length > 5 && (
          <label className="relative block mb-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по клиенту" className="w-full h-10 pl-9 pr-3 rounded-xl bg-zinc-800 outline-none focus:ring-1 focus:ring-lime-400/40" />
          </label>
        )}
        {journal.length === 0 ? <p className="text-sm text-zinc-500 text-center py-4">{c.pays.length ? "Никого не нашлось" : "За этот период платежей нет"}</p> : (
          <div className="divide-y divide-zinc-800">
            {journal.map((x) => (
              <button key={x.id} onClick={() => onOpenClient(x.clientId)} className="w-full flex items-center gap-2.5 py-2.5 text-left">
                <span className="text-xs text-zinc-500 w-12 shrink-0">{fmtShort(x.date)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{byId[x.clientId]?.name ?? "—"}</span>
                  <span className="block text-xs text-zinc-500 truncate">{[TYPE_LABEL[x.type] ?? null, x.note || null].filter(Boolean).join(" · ")}</span>
                </span>
                {x.payStatus !== "paid" && <span className="text-[11px] text-orange-400 bg-orange-400/10 rounded-md px-1.5 py-0.5 shrink-0">{x.payStatus === "installment" ? "частями" : "ожидание"}</span>}
                <span className={`text-sm font-semibold shrink-0 ${x.payStatus === "paid" ? "text-zinc-100" : "text-orange-300"}`}>{rub(x.amount)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {(conversion != null || cohorts.length > 0) && (
        <Card title="Клиенты" sub="за всё время">
          {conversion != null && <p className="text-sm text-zinc-300 mb-3">Остались после пробной: <b className="text-zinc-100">{conversion}%</b></p>}
          {cohorts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-zinc-500 mb-1">Сколько ещё занимаются — по месяцу прихода</p>
              {cohorts.map((x) => (
                <div key={x.key} className="flex items-center gap-2 text-sm">
                  <span className="text-zinc-300 w-12 shrink-0 capitalize">{x.label}</span>
                  <span className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden"><span className="block h-full bg-lime-400" style={{ width: `${Math.round((x.active / x.total) * 100)}%` }} /></span>
                  <span className="text-zinc-500 text-xs shrink-0">{x.active}/{x.total}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {renew && <RenewModal trainerId={trainerId} clientId={renew.id} name={renew.name} onDone={load} onClose={() => setRenew(null)} />}
    </Shell>
  );
}

const fmtShort = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");

function Shell({ onBack, right, children }: { onBack: () => void; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onBack} aria-label="Назад" className="w-10 h-10 -ml-2 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition"><ArrowLeft size={20} /></button>
        <h2 className="flex-1 min-w-0 text-2xl font-extrabold tracking-tight">Финансы</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Card({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-[17px] font-bold">{title}</h3>
          {sub && <p className="text-xs text-zinc-500">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, cur, prev, hint, sub, hide, accent }: { label: string; value: string; cur?: number; prev?: number; hint?: string; sub?: string; hide?: boolean; accent?: boolean }) {
  const has = cur != null && prev != null && !hide;
  const delta = has ? (prev === 0 ? null : (cur! - prev!) / prev!) : undefined;
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 min-w-0" title={hint}>
      <p className="text-xs text-zinc-500 truncate">{label}</p>
      <p className={`text-xl font-extrabold mt-1 truncate ${accent ? "text-lime-400" : "text-zinc-100"}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5 truncate">{sub}</p>}
      {has && (
        <p className="text-xs mt-1 flex items-center gap-0.5">
          {delta === null ? <span className="text-zinc-500">{cur ? "раньше не было" : "как и раньше — 0"}</span>
            : Math.round(delta! * 100) === 0 ? <span className="text-zinc-500">как в прошлом периоде</span>
            : <span className={`inline-flex items-center gap-0.5 font-semibold ${delta! > 0 ? "text-lime-400" : "text-orange-400"}`}>
                {delta! > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(Math.round(delta! * 100))}%
                <span className="text-zinc-500 font-normal ml-0.5">к прошлому</span>
              </span>}
        </p>
      )}
    </div>
  );
}

function ClientDot({ c }: { c?: DashboardClient }) {
  return <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c?.color || "#c6ff3d" }} />;
}

function Bars({ title, items, total, rub }: { title: string; items: { label: string; value: number; color?: string }[]; total: number; rub: (v: number) => string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1.5">{title}</p>
      <div className="space-y-2">
        {items.map((x) => (
          <div key={x.label}>
            <div className="flex items-baseline gap-2 text-sm">
              <span className="flex-1 min-w-0 truncate text-zinc-300">{x.label}</span>
              <span className="text-zinc-100 font-semibold shrink-0">{rub(x.value)}</span>
              <span className="text-xs text-zinc-500 w-9 text-right shrink-0">{Math.round((x.value / total) * 100)}%</span>
            </div>
            <div className="h-1.5 mt-1 bg-zinc-800 rounded-full overflow-hidden"><div className={`h-full rounded-full ${x.color ? "" : "bg-lime-400"}`} style={{ width: `${(x.value / total) * 100}%`, background: x.color }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
