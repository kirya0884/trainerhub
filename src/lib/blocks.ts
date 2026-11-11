import { supabase } from "./supabase";
import { ask, pickOption } from "./dialog";
import type { Membership } from "./clients";

// Этап 11: оплаченные блоки клиента (таблица client_blocks). Каждый блок — свой вид, остаток,
// цена и цвет; сплит-блок общий на двоих. Списание и оплата — на сервере (charge_session,
// record_payment…), здесь — чтение и выбор блока тренером.

export type BlockKind = "personal" | "split" | "group";
export interface Block {
  id: string;
  clientId: string;
  partnerClientId: string | null;
  /** Имена владельца и партнёра — для подписи «Сплит с …» у обоих */
  ownerName: string;
  partnerName: string;
  kind: BlockKind;
  total: number;
  remaining: number;
  price: number;
  color: number;
  paidAt: string | null;
}

/** Цвета блоков: первый — акцент тренера, второй — бирюзовый, третий — сиреневый */
export const BLOCK_COLORS = [
  { text: "text-lime-400", dot: "bg-lime-400", ring: "text-lime-400" },
  { text: "text-cyan-400", dot: "bg-cyan-400", ring: "text-cyan-400" },
  { text: "text-violet-400", dot: "bg-violet-400", ring: "text-violet-400" },
];
export const blockColor = (b: Pick<Block, "color">) => BLOCK_COLORS[b.color] ?? BLOCK_COLORS[0];

/** «Персональный», «Сплит · Катя», «Группа» — с точки зрения клиента forId (имя без склонения) */
export function blockLabel(b: Block, forId: string): string {
  if (b.kind === "personal") return "Персональный";
  if (b.kind === "group") return "Группа";
  const other = b.clientId === forId ? b.partnerName : b.ownerName;
  return other ? `Сплит · ${other.split(" ")[0]}` : "Сплит";
}

type Row = {
  id: string; client_id: string; partner_client_id: string | null; kind: BlockKind; total: number; remaining: number;
  price: number | string; color: number; paid_at: string | null;
  owner: { name: string } | null; partner: { name: string } | null;
};
const toBlock = (r: Row): Block => ({
  id: r.id, clientId: r.client_id, partnerClientId: r.partner_client_id, kind: r.kind,
  ownerName: r.owner?.name?.trim() ?? "", partnerName: r.partner?.name?.trim() ?? "",
  total: r.total, remaining: r.remaining, price: Number(r.price) || 0, color: r.color, paidAt: r.paid_at,
});
const COLS = "id,client_id,partner_client_id,kind,total,remaining,price,color,paid_at,owner:clients!client_blocks_client_id_fkey(name),partner:clients!client_blocks_partner_client_id_fkey(name)";

/** Блоки клиента (свои и общие сплиты), раньше оплаченные — первыми. Ошибка — пустой список:
 *  тогда экраны показывают общий остаток, как до блоков. */
export async function fetchBlocks(clientId: string): Promise<Block[]> {
  const { data, error } = await supabase.from("client_blocks").select(COLS)
    .or(`client_id.eq.${clientId},partner_client_id.eq.${clientId}`)
    .order("paid_at", { ascending: true, nullsFirst: true }).order("created_at");
  if (error) { console.warn("[blocks] fetch:", error.message); return []; }
  return ((data ?? []) as unknown as Row[]).map(toBlock);
}

/** Блоки с остатком — то, что показываем в карточке и списке */
export const activeBlocks = (bs: Block[]) => bs.filter((b) => b.remaining !== 0);

/** Для списка клиентов: остатки по блокам у каждого клиента (только если блоков с остатком два и больше) */
export async function fetchBlockCounts(): Promise<Record<string, { remaining: number; color: number }[]>> {
  const { data, error } = await supabase.from("client_blocks").select("client_id,partner_client_id,remaining,color,paid_at,created_at")
    .neq("remaining", 0).order("paid_at", { ascending: true, nullsFirst: true }).order("created_at");
  if (error) { console.warn("[blocks] counts:", error.message); return {}; }
  const out: Record<string, { remaining: number; color: number }[]> = {};
  for (const r of data ?? []) for (const id of [r.client_id, r.partner_client_id]) {
    if (id) (out[id] ??= []).push({ remaining: r.remaining, color: r.color });
  }
  for (const k of Object.keys(out)) if (out[k].length < 2) delete out[k];
  return out;
}

const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;

/**
 * С какого блока списать. Блок один (или ни одного) — не спрашиваем: undefined, сервер решит сам.
 * Два и больше — окно выбора; подсказка как на сервере: сплит, если партнёр есть в записи
 * календаря, иначе сначала не-сплиты, внутри — оплаченный раньше. Закрыли окно — undefined.
 */
export async function chooseBlock(clientId: string, opts: { bookingId?: string | null; clientName?: string } = {}): Promise<string | undefined> {
  const blocks = (await fetchBlocks(clientId)).filter((b) => b.remaining > 0);
  if (blocks.length < 2) return undefined;
  let inBooking = new Set<string>();
  if (opts.bookingId) {
    const { data } = await supabase.from("booking_clients").select("client_id").eq("booking_id", opts.bookingId);
    inBooking = new Set((data ?? []).map((r) => r.client_id));
  }
  const other = (b: Block) => (b.clientId === clientId ? b.partnerClientId : b.clientId);
  const score = (b: Block) => (b.kind === "split" && other(b) && inBooking.has(other(b)!) ? 0 : b.kind === "split" ? 2 : 1);
  const def = [...blocks].sort((a, b) => score(a) - score(b))[0];
  const name = opts.clientName ?? (blocks[0].clientId === clientId ? blocks[0].ownerName : blocks[0].partnerName);
  const picked = await pickOption(`${name ? `${name}: с` : "С"} какого блока списать?`, blocks.map((b) => ({
    key: b.id, label: blockLabel(b, clientId), badge: String(b.remaining), color: blockColor(b).text,
    sub: [`станет ${b.remaining - 1}${b.kind === "split" && other(b) ? " у обоих" : ""}`, b.price ? `по ${rub(b.price)}` : ""].filter(Boolean).join(" · "),
  })), { ok: "Списать", picked: def.id });
  return picked ?? undefined;
}

/** Выбор блока для нескольких клиентов разом (отметка записи календаря): {clientId: blockId} */
export async function chooseBlocks(clientIds: string[], bookingId: string | null, names: Record<string, string> = {}): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of clientIds) {
    const b = await chooseBlock(id, { bookingId, clientName: names[id] }).catch(() => undefined);
    if (b) out[id] = b;
  }
  return out;
}

/**
 * Перед оплатой пакета: если он не прибавится к уже оплаченному блоку (другой вид или другая
 * цена), предупредить, что у клиента есть другой блок и он сохранится. true — платить.
 * Правило «прибавится» — как в record_payment: тот же вид, тот же партнёр, та же цена.
 */
export async function confirmNewBlock(clientId: string, m: Pick<Membership, "type" | "total" | "packagePrice" | "pricePerSession" | "split" | "partnerClientId" | "partnerName">): Promise<boolean> {
  if (m.type === "subscription") return true;
  const active = (await fetchBlocks(clientId)).filter((b) => b.remaining > 0);
  if (!active.length) return true;
  const total = Math.round(Number(m.total) || 0);
  const price = total > 0 ? (Number(m.packagePrice) || 0) / total : Number(m.pricePerSession) || 0;
  const kind: BlockKind = m.split ? "split" : "personal";
  const partner = m.split ? m.partnerClientId || null : null;
  const other = (b: Block) => (b.clientId === clientId ? b.partnerClientId : b.clientId);
  const merges = active.some((b) => b.kind === kind && Math.round(b.price) === Math.round(price)
    && (kind !== "split" || (other(b) ?? null) === partner));
  if (merges) return true;
  const list = active.map((b) => `• ${blockLabel(b, clientId)}: осталось ${b.remaining}${b.total ? ` из ${b.total}` : ""}`).join("\n");
  const newLabel = kind === "split" ? (m.partnerName ? `Сплит · ${m.partnerName.split(" ")[0]}` : "Сплит") : "Персональный";
  const many = active.length > 1;
  return ask(`У клиента уже есть ${many ? "оплаченные блоки" : "оплаченный блок"}:\n${list}\n\n${many ? "Они сохранятся" : "Он сохранится"}, а «${newLabel}»${total ? ` на ${total} тр.` : ""} добавится рядом отдельным блоком. При завершении тренировки спрошу, с какого блока списать.`,
    { ok: "Добавить блок", cancel: "Отмена" });
}
