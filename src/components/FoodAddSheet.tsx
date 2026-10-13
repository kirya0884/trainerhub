import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, Pencil, Plus, Search, Star, Trash2 } from "lucide-react";
import ModalShell from "./ModalShell";
import { SkeletonRows } from "./Skeleton";
import { GramsInput, MacroTiles, MACRO_COLOR } from "./NutritionParts";
import * as api from "../lib/foodDiary";
import type { FoodEntry, FoodProduct, Meal } from "../lib/foodDiary";

const QUICK_GRAMS = [50, 100, 150, 200];
const per100 = (p: api.Macros) => `Б ${api.fmtN(p.protein)} · Ж ${api.fmtN(p.fat)} · У ${api.fmtN(p.carbs)} · ${api.fmtN(p.kcal, 0)} ккал`;
const str = (n: number) => (n ? String(Math.round(n * 10) / 10).replace(".", ",") : "");
type List = "recent" | "all" | "fav";
const LISTS: [List, string][] = [["recent", "Недавние"], ["all", "Все"], ["fav", "Избранное"]];

// Добавление в приём пищи: свой продукт из списка (выбрал → граммы) или новый
// (КБЖУ на 100 г с упаковки → граммы). Новый по умолчанию запоминается в «Мои продукты».
// Свой продукт можно поправить или удалить — записи в дневнике от этого не меняются.
export default function FoodAddSheet({ clientId, date, meal, onAdded, onClose }: {
  clientId: string; date: string; meal: Meal; onAdded: (e: FoodEntry) => void; onClose: () => void;
}) {
  const [products, setProducts] = useState<FoodProduct[] | null>(null);
  const [q, setQ] = useState("");
  const [list, setList] = useState<List>("recent");
  const [picked, setPicked] = useState<FoodProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false); // правка выбранного продукта
  const [grams, setGrams] = useState("100");
  const [busy, setBusy] = useState(false);
  // Форма продукта (новый или правка)
  const [name, setName] = useState("");
  const [p, setP] = useState(""); const [f, setF] = useState(""); const [c, setC] = useState(""); const [kcal, setKcal] = useState("");
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    api.fetchProducts(clientId).then(setProducts).catch((e) => { console.error("[FoodAddSheet] продукты:", e); setProducts([]); });
  }, [clientId]);

  const term = q.trim().toLowerCase();
  const shown = useMemo(() => {
    let l = (products ?? []).filter((x) => !term || x.name.toLowerCase().includes(term));
    if (list === "fav") l = l.filter((x) => x.favorite);
    if (list === "all") l = [...l].sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (list === "recent" && !term) l = l.filter((x) => x.lastUsedAt).slice(0, 30);
    return l;
  }, [products, term, list]);

  const autoKcal = api.kcalOf({ protein: api.num(p), fat: api.num(f), carbs: api.num(c) });
  const formPer100: api.Macros = { kcal: kcal.trim() ? api.num(kcal) : autoKcal, protein: api.num(p), fat: api.num(f), carbs: api.num(c) };
  const base = editing ? null : picked ?? (creating ? formPer100 : null);
  const g = api.num(grams);
  const eaten = base ? api.scale(base, g) : api.ZERO;
  const mealLabel = api.MEALS.find((m) => m.key === meal)!.label;

  const patchLocal = (id: string, patch: Partial<FoodProduct>) => {
    setProducts((l) => (l ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setPicked((x) => (x && x.id === id ? { ...x, ...patch } : x));
  };
  const pick = (x: FoodProduct) => { setPicked(x); setGrams(String(x.lastGrams ?? 100)); };
  const fillForm = (x: { name: string } & api.Macros) => { setName(x.name); setP(str(x.protein)); setF(str(x.fat)); setC(str(x.carbs)); setKcal(Math.round(api.kcalOf(x)) === Math.round(x.kcal) ? "" : str(x.kcal)); };
  const startNew = () => { setCreating(true); setPicked(null); fillForm({ name: q.trim(), ...api.ZERO }); setGrams("100"); };
  const startEdit = () => { if (picked) { fillForm(picked); setEditing(true); } };
  const back = () => { if (editing) { setEditing(false); return; } setPicked(null); setCreating(false); };

  const run = async (f: () => Promise<void>, msg = "Не удалось сохранить. Проверьте интернет.") => {
    if (busy) return;
    setBusy(true);
    try { await f(); } catch (e) { console.error("[FoodAddSheet]", e); alert(msg); } finally { setBusy(false); }
  };
  const toggleFav = (x: FoodProduct) => {
    patchLocal(x.id, { favorite: !x.favorite });
    api.updateProduct(x.id, { favorite: !x.favorite }).catch((e) => { console.error("[FoodAddSheet] избранное:", e); patchLocal(x.id, { favorite: x.favorite }); });
  };
  const saveEdit = () => run(async () => {
    if (!picked || !name.trim()) return;
    const patch = { name: name.trim(), ...formPer100 };
    await api.updateProduct(picked.id, patch);
    patchLocal(picked.id, patch);
    setEditing(false);
  });
  const removeProduct = () => {
    if (!picked || !window.confirm(`Удалить «${picked.name}» из моих продуктов? Записи в дневнике останутся.`)) return;
    run(async () => {
      await api.deleteProduct(picked.id);
      setProducts((l) => (l ?? []).filter((x) => x.id !== picked.id));
      setPicked(null); setEditing(false);
    }, "Не удалось удалить продукт.");
  };

  const save = () => run(async () => {
    if (!g || !base || (creating && !name.trim())) return;
    let productId: string | null = picked?.id ?? null;
    if (creating && remember) productId = (await api.addProduct(clientId, { name: name.trim(), ...formPer100 })).id;
    const entry = await api.addEntry(clientId, { date, meal, productId, recipeId: null, name: picked?.name ?? name.trim(), grams: g, ...eaten });
    if (productId) api.touchProduct(productId, g).catch((e) => console.error("[FoodAddSheet] touch:", e));
    onAdded(entry);
    onClose();
  }, "Не удалось добавить. Проверьте интернет и попробуйте ещё раз.");

  const footer = editing ? (
    <div className="p-4 border-t border-zinc-800 shrink-0 space-y-2">
      <button onClick={saveEdit} disabled={busy || !name.trim()} className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">{busy ? "Сохраняю…" : "Сохранить продукт"}</button>
      <button onClick={removeProduct} disabled={busy} className="w-full h-11 flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-red-400 hover:bg-red-500/10 transition"><Trash2 size={16} /> Удалить из моих продуктов</button>
    </div>
  ) : base && (
    <div className="p-4 border-t border-zinc-800 shrink-0">
      <button onClick={save} disabled={busy || !g || (creating && !name.trim())}
        className="w-full h-12 flex items-center justify-center gap-2 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">
        <Check size={18} strokeWidth={2.75} /> {busy ? "Сохраняю…" : `Добавить в ${mealLabel.toLowerCase()} · ${api.fmtN(eaten.kcal, 0)} ккал`}
      </button>
    </div>
  );

  const title = editing ? "Изменить продукт" : creating ? "Новый продукт" : picked ? picked.name : mealLabel;
  return (
    <ModalShell title={title} onClose={onClose} footer={footer}>
      <div className="p-4 space-y-3">
        {(picked || creating) && (
          <div className="flex items-center justify-between -mt-1">
            <button onClick={back} className="flex items-center gap-1 text-sm font-semibold text-zinc-400 hover:text-zinc-100 transition"><ChevronLeft size={17} /> {editing ? "Назад" : "К списку"}</button>
            {picked && !editing && (
              <div className="flex gap-1">
                <button onClick={() => toggleFav(picked)} aria-pressed={picked.favorite} aria-label={picked.favorite ? "Убрать из избранного" : "В избранное"}
                  className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition"><Star size={18} className={picked.favorite ? "text-amber-400 fill-amber-400" : "text-zinc-500"} /></button>
                <button onClick={startEdit} aria-label="Изменить продукт" className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition"><Pencil size={17} /></button>
              </div>
            )}
          </div>
        )}

        {!picked && !creating && (
          <>
            <label className="flex items-center gap-2.5 h-11 px-3.5 rounded-xl bg-zinc-800">
              <Search size={18} className="text-zinc-500 shrink-0" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти в моих продуктах" className="flex-1 min-w-0 bg-transparent outline-none" />
            </label>
            <div className="flex gap-1.5">
              {LISTS.map(([k, l]) => (
                <button key={k} onClick={() => setList(k)} aria-pressed={list === k}
                  className={`h-9 px-3.5 rounded-full text-[13px] font-semibold transition ${list === k ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>{l}</button>
              ))}
            </div>
            <button onClick={startNew} className="w-full flex items-center gap-2 h-10 px-1 text-sm font-semibold text-lime-400">
              <Plus size={18} /> {term ? `Новый продукт «${q.trim()}»` : "Новый продукт"}
            </button>
            {products === null ? <SkeletonRows rows={3} /> : shown.length === 0 ? (
              <p className="text-sm text-zinc-500 px-1">
                {!products.length ? "Здесь появятся продукты, которые вы добавите. Начните с «Новый продукт» — КБЖУ на 100 г есть на упаковке."
                  : list === "fav" && !term ? "В избранном пусто — отметьте продукт звёздочкой." : "Ничего не нашлось"}
              </p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {shown.map((x) => (
                  <div key={x.id} className="flex items-center">
                    <button onClick={() => pick(x)} className="flex-1 min-w-0 text-left py-2.5 px-1 hover:bg-zinc-800/50 rounded-lg transition">
                      <span className="block font-semibold truncate">{x.name}</span>
                      <span className="block text-[13px] text-zinc-500">на 100 г: {per100(x)}</span>
                    </button>
                    <button onClick={() => toggleFav(x)} aria-pressed={x.favorite} aria-label={x.favorite ? `Убрать «${x.name}» из избранного` : `«${x.name}» в избранное`}
                      className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition"><Star size={18} className={x.favorite ? "text-amber-400 fill-amber-400" : "text-zinc-600"} /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {picked && !editing && <p className="text-[13px] text-zinc-400">На 100 г: {per100(picked)}</p>}

        {(creating || editing) && (
          <>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название, например «Творог 5%»" className="w-full h-12 px-3.5 rounded-xl bg-zinc-800 outline-none focus:ring-2 focus:ring-lime-400/50" />
            <p className="text-[13px] font-semibold text-zinc-400 px-0.5">На 100 г — с упаковки</p>
            <div className="grid grid-cols-4 gap-1.5">
              <Per100 label="Белки" value={p} onChange={setP} color={MACRO_COLOR.protein} />
              <Per100 label="Жиры" value={f} onChange={setF} color={MACRO_COLOR.fat} />
              <Per100 label="Углеводы" value={c} onChange={setC} color={MACRO_COLOR.carbs} />
              <Per100 label="Ккал" value={kcal} onChange={setKcal} color={MACRO_COLOR.kcal} placeholder={autoKcal ? api.fmtN(autoKcal, 0) : "авто"} />
            </div>
            <p className="text-[13px] text-zinc-500 px-0.5">Ккал считаются сами: Б×4 + Ж×9 + У×4. Если на упаковке другое число — впишите его.</p>
            {editing && <p className="text-[13px] text-zinc-500 px-0.5">Уже записанное в дневник не изменится.</p>}
            {creating && <p className="text-[13px] font-semibold text-zinc-400 px-0.5 pt-1">Съедено</p>}
          </>
        )}

        {base && (
          <>
            <GramsInput value={grams} onChange={setGrams} autoFocus={!creating} />
            <div className="flex gap-1.5 flex-wrap">
              {QUICK_GRAMS.map((n) => (
                <button key={n} onClick={() => setGrams(String(n))} className={`h-9 px-3 rounded-full text-[13px] font-semibold transition ${g === n ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>{n} г</button>
              ))}
              {picked?.lastGrams && !QUICK_GRAMS.includes(picked.lastGrams) && (
                <button onClick={() => setGrams(String(picked.lastGrams))} className={`h-9 px-3 rounded-full text-[13px] font-semibold transition ${g === picked.lastGrams ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>как в прошлый раз · {api.fmtN(picked.lastGrams, 0)} г</button>
              )}
            </div>
            <MacroTiles m={eaten} />
            {creating && (
              <label className="flex items-center gap-3 pt-1 cursor-pointer">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-5 h-5 accent-lime-400" />
                <span className="text-sm">Запомнить в «Мои продукты»</span>
              </label>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}

function Per100({ label, value, onChange, color, placeholder = "0" }: { label: string; value: string; onChange: (v: string) => void; color: string; placeholder?: string }) {
  return (
    <label className="block text-center rounded-xl bg-zinc-800 px-1 py-2">
      <span className="block text-[11px] text-zinc-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder={placeholder} aria-label={`${label} на 100 г`}
        className="w-full bg-transparent text-center text-lg font-extrabold outline-none placeholder:text-zinc-600" style={{ color }} />
    </label>
  );
}
