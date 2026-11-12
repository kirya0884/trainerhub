import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Copy, Search } from "lucide-react";
import * as api from "../lib/api";
import type { ActiveGrant, FoundTrainer, Grant, Source, Sub } from "../lib/api";
import { useData } from "../lib/useData";
import { addDays, fmtDay, toDateStr, today } from "../lib/format";
import { SOURCES, TIERS } from "../lib/labels";
import { Card, Section, Seg, Skeleton } from "../components/ui";

// Этап 13: подписки вручную. Ищем тренера по ID (R-XXXXXX) или почте, выдаём тариф на срок
// или бессрочно с основанием и комментарием; внизу — все действующие выдачи.
type Term = "1" | "3" | "12" | "date" | "forever";
const TERMS: [Term, string][] = [["1", "1 мес"], ["3", "3 мес"], ["12", "12 мес"], ["date", "До даты"], ["forever", "Бессрочно"]];
const PAID_TIERS: [Grant["tier"], string][] = [["basic", TIERS.basic], ["pro", TIERS.pro], ["studio", TIERS.studio]];
const GRANT_SOURCES: [Source, string][] = [["barter", "Бартер"], ["gift", "Подарок"], ["developer", "Разработчик"], ["trial", "Тест"]];

const fullDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("ru-RU");
const daysLeft = (end: string) => Math.round((new Date(end + "T00:00:00").getTime() - new Date(today() + "T00:00:00").getTime()) / 86400000);
/** Последний день срока: +N месяцев от начала минус день («с 12.11 на месяц» → по 11.12) */
const plusMonths = (from: string, m: number) => { const d = new Date(from + "T00:00:00"); d.setMonth(d.getMonth() + m); return addDays(toDateStr(d), -1); };

export const subText = (s: Sub) => s.tier === "start" ? "Старт (без подписки)"
  : `${TIERS[s.tier]} · ${s.ends_at ? `по ${fullDate(s.ends_at)}` : "бессрочно"}${s.source ? ` · ${SOURCES[s.source] ?? s.source}` : ""}`;

export default function Subscriptions() {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<FoundTrainer | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0); // перезагрузка списков после выдачи/отзыва
  const active = useData(() => api.activeGrants(), [tick]);

  const search = async (e?: FormEvent, query = q) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setMsg("");
    try {
      const t = await api.findTrainer(query.trim());
      setFound(t);
      if (!t) setMsg("Не нашёл: проверь ID или почту");
    } catch (err) { setMsg(String((err as Error).message)); }
    setBusy(false);
  };
  const refresh = async () => { setTick((x) => x + 1); if (found) await search(undefined, found.public_id); };

  return (
    <div className="space-y-6 max-w-4xl">
      <Section title="Выдать подписку" hint="ID тренер видит у себя в профиле">
        <form onSubmit={search} className="flex flex-wrap gap-2">
          <label className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="R-7K4M2P или почта" autoFocus
              className="h-10 w-72 pl-9 pr-3 rounded-lg bg-surface border border-line text-sm outline-none focus:border-accent" />
          </label>
          <button disabled={busy} className="h-10 px-4 rounded-lg bg-accent text-onaccent text-sm font-bold disabled:opacity-50">{busy ? "Ищу…" : "Найти"}</button>
        </form>
        {msg && <p className="text-sm text-bad">{msg}</p>}
        {found && <TrainerCard key={found.id + tick} t={found} onChanged={refresh} />}
      </Section>

      <Section title="Действующие подписки" hint="и выданные на будущее">
        <Card className="overflow-x-auto">
          {active.loading ? <div className="p-4"><Skeleton h={160} /></div> : active.error ? <p className="p-4 text-bad">{active.error}</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-ink3 text-[12px] border-b border-line">
                {["Тренер", "ID", "Тариф", "Основание", "Срок", ""].map((h) => <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {(active.data ?? []).map((g) => <ActiveRow key={g.id} g={g} onOpen={() => { setQ(g.public_id); search(undefined, g.public_id); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)}
                {!(active.data ?? []).length && <tr><td colSpan={6} className="px-3 py-8 text-center text-ink3">Пока никому не выдано</td></tr>}
              </tbody>
            </table>
          )}
        </Card>
      </Section>
    </div>
  );
}

function ActiveRow({ g, onOpen }: { g: ActiveGrant; onOpen: () => void }) {
  const left = g.ends_at ? daysLeft(g.ends_at) : null;
  const future = g.starts_at > today();
  return (
    <tr onClick={onOpen} className="border-b border-line/60 last:border-0 hover:bg-surface2 cursor-pointer">
      <td className="px-3 py-2.5"><div className="font-semibold">{g.name || "Без имени"}</div><div className="text-[12px] text-ink3">{g.email}</div></td>
      <td className="px-3 py-2.5 num whitespace-nowrap">{g.public_id}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">{TIERS[g.tier]}</td>
      <td className="px-3 py-2.5"><div>{SOURCES[g.source] ?? g.source}</div>{g.note && <div className="text-[12px] text-ink3 max-w-[260px] truncate" title={g.note}>{g.note}</div>}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {future ? <span className="text-ink2">с {fullDate(g.starts_at)}</span> : g.ends_at ? `по ${fullDate(g.ends_at)}` : "бессрочно"}
        {left != null && !future && <div className={`text-[12px] ${left <= 7 ? "text-bad font-semibold" : "text-ink3"}`}>{left === 0 ? "последний день" : `осталось ${left} дн.`}</div>}
      </td>
      <td className="px-3 py-2.5 text-right text-[12px] text-ink3 whitespace-nowrap">выдано {fmtDay(g.created_at.slice(0, 10))}</td>
    </tr>
  );
}

function TrainerCard({ t, onChanged }: { t: FoundTrainer; onChanged: () => void }) {
  const grants = useData(() => api.trainerGrants(t.id), [t.id]);
  const [tier, setTier] = useState<Grant["tier"]>("pro");
  const [source, setSource] = useState<Source>("barter");
  const [term, setTerm] = useState<Term>("1");
  // Есть подписка с концом (в том числе выданная наперёд) — новая по умолчанию начинается
  // на следующий день после самой поздней, чтобы продлевать, а не перекрывать
  const lastEnd = (grants.data ?? []).filter((g) => !g.revoked_at && g.ends_at && g.ends_at >= today()).map((g) => g.ends_at!).sort().pop()
    ?? (t.sub.ends_at && t.sub.ends_at >= today() ? t.sub.ends_at : null);
  const next = lastEnd ? addDays(lastEnd, 1) : today();
  const [starts, setStarts] = useState(today());
  const [until, setUntil] = useState(plusMonths(today(), 1));
  useEffect(() => { setStarts(next); setUntil(plusMonths(next, 1)); }, [next]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const ends = term === "forever" ? null : term === "date" ? until : plusMonths(starts, Number(term));
  const pickSource = (s: Source) => { setSource(s); if (s === "developer") { setTier("studio"); setTerm("forever"); setStarts(today()); } };

  const grant = async () => {
    if (ends && ends < starts) { setErr("Конец раньше начала"); return; }
    const what = `${TIERS[tier]} ${ends ? `с ${fullDate(starts)} по ${fullDate(ends)}` : `бессрочно с ${fullDate(starts)}`} — ${t.name || t.email}`;
    if (!confirm(`Выдать подписку?\n${what}`)) return;
    setBusy(true); setErr("");
    try { await api.grantSub({ trainer: t.id, tier, source, starts, ends, note }); setNote(""); onChanged(); }
    catch (e) { setErr(String((e as Error).message)); }
    setBusy(false);
  };
  const revoke = async (g: Grant) => {
    if (!confirm(`Отозвать «${TIERS[g.tier]}» (${SOURCES[g.source] ?? g.source})? Подписка перестанет действовать сразу.`)) return;
    try { await api.revokeSub(g.id); onChanged(); } catch (e) { setErr(String((e as Error).message)); }
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-extrabold">{t.name || "Без имени"}</h3>
          <p className="text-[13px] text-ink3">{t.email} · с {fullDate(t.created_at.slice(0, 10))}</p>
        </div>
        <button onClick={() => navigator.clipboard?.writeText(t.public_id)} title="Скопировать ID"
          className="h-8 px-2.5 rounded-lg bg-surface2 text-[13px] font-semibold num inline-flex items-center gap-1.5 hover:text-accent"><Copy size={13} /> {t.public_id}</button>
      </div>
      <div className="rounded-xl bg-surface2 px-3 py-2.5 text-sm">Сейчас: <b>{subText(t.sub)}</b></div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Тариф"><Seg value={tier} options={PAID_TIERS} onChange={setTier} /></Field>
        <Field label="Основание"><Seg value={source} options={GRANT_SOURCES} onChange={pickSource} /></Field>
        <Field label="Срок"><Seg value={term} options={TERMS} onChange={setTerm} size="sm" /></Field>
        <Field label={next !== today() && starts === next ? "Начало — сразу после текущей" : "Начало"}>
          <div className="flex items-center gap-2">
            <input type="date" value={starts} onChange={(e) => e.target.value && setStarts(e.target.value)} className="h-9 px-2.5 rounded-lg bg-surface border border-line text-sm" />
            {term === "date" && <><span className="text-ink3">—</span><input type="date" value={until} min={starts} onChange={(e) => setUntil(e.target.value)} className="h-9 px-2.5 rounded-lg bg-surface border border-line text-sm" /></>}
          </div>
        </Field>
      </div>
      <Field label="Комментарий (за что, где реклама)">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Реклама в ТГК @name, 2 поста"
          className="h-10 w-full px-3 rounded-lg bg-surface border border-line text-sm outline-none focus:border-accent" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={grant} disabled={busy} className="h-10 px-4 rounded-lg bg-accent text-onaccent text-sm font-bold disabled:opacity-50">
          {busy ? "Выдаю…" : `Выдать: ${TIERS[tier]}, ${ends ? `по ${fullDate(ends)}` : "бессрочно"}`}
        </button>
        {err && <span className="text-sm text-bad">{err}</span>}
      </div>

      <div>
        <h4 className="font-bold mb-2">История</h4>
        {grants.loading ? <Skeleton h={80} /> : (
          <ul className="divide-y divide-line/60 text-sm">
            {(grants.data ?? []).map((g) => {
              const over = g.revoked_at || (g.ends_at && g.ends_at < today());
              return (
                <li key={g.id} className={`py-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${over ? "text-ink3" : ""}`}>
                  <span className="font-semibold w-20">{TIERS[g.tier]}</span>
                  <span className="w-40">{SOURCES[g.source] ?? g.source}</span>
                  <span className="num">{fullDate(g.starts_at)} — {g.ends_at ? fullDate(g.ends_at) : "бессрочно"}</span>
                  <span className="flex-1 min-w-0 truncate text-ink3" title={g.note}>{g.note}</span>
                  {g.revoked_at ? <span className="text-[12px]">отозвана {fullDate(g.revoked_at.slice(0, 10))}</span>
                    : over ? <span className="text-[12px]">закончилась</span>
                    : <button onClick={() => revoke(g)} className="h-8 px-2.5 rounded-lg text-[13px] font-semibold text-bad hover:bg-surface2">Отозвать</button>}
                </li>
              );
            })}
            {!(grants.data ?? []).length && <li className="py-3 text-ink3">Подписок ещё не было</li>}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><div className="text-[12px] font-semibold text-ink3">{label}</div>{children}</div>;
}
