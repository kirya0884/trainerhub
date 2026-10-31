import { Suspense, useEffect, useMemo, useState } from "react";
import { BookOpen, Check, ChevronLeft, ChevronRight, Pencil, Plus, Search, Star, Trash2 } from "lucide-react";
import ModalShell from "./ModalShell";
import { SkeletonRows } from "./Skeleton";
import { GramsInput, MacroTiles, MACRO_COLOR } from "./NutritionParts";
import RecipeEditor from "./RecipeEditor";
import * as api from "../lib/foodDiary";
import type { FoodEntry, FoodProduct, Meal, Recipe } from "../lib/foodDiary";
import { ask, notify } from "../lib/dialog";
import { track } from "../lib/events";
import { lazyRetry } from "../lib/lazy";
import { today } from "../lib/format";

const NutritionCatalog = lazyRetry(() => import("./NutritionCatalog"));
const QUICK_GRAMS = [50, 100, 150, 200];
const PORTIONS: [number, string][] = [[0.5, "½ порции"], [1, "1 порция"], [1.5, "1½"], [2, "2 порции"]];
const per100 = (p: api.Macros) => `Б ${api.fmtN(p.protein)} · Ж ${api.fmtN(p.fat)} · У ${api.fmtN(p.carbs)} · ${api.fmtN(p.kcal, 0)} ккал`;
const str = (n: number) => (n ? String(Math.round(n * 10) / 10).replace(".", ",") : "");
type List = "recent" | "all" | "fav" | "recipes";
const LISTS: [List, string][] = [["recent", "Недавние"], ["all", "Все"], ["fav", "Избранное"], ["recipes", "Рецепты"]];
// Строка списка: продукт или рецепт (у рецепта КБЖУ на 100 г посчитаны заранее)
type Item = { kind: "product"; p: FoodProduct } | { kind: "recipe"; r: Recipe; per: api.Macros };
const itemName = (x: Item) => (x.kind === "product" ? x.p.name : x.r.name);
const itemFav = (x: Item) => (x.kind === "product" ? x.p.favorite : x.r.favorite);
const itemUsed = (x: Item) => (x.kind === "product" ? x.p.lastUsedAt : x.r.lastUsedAt) ?? "";

// Добавление в приём пищи: свой продукт или рецепт из списка (выбрал → граммы или порции)
// или новый продукт (КБЖУ на 100 г с упаковки → граммы). Новый по умолчанию запоминается.
// Свой продукт и рецепт можно поправить или удалить — записи в дневнике от этого не меняются.
export default function FoodAddSheet({ clientId, date, meal: initialMeal, initial, onAdded, onClose }: {
  clientId: string; date: string; meal: Meal; onAdded: (e: FoodEntry) => void; onClose: () => void;
  /** Уже выбранный продукт или рецепт (из каталога): приём пищи тогда выбирается здесь же */
  initial?: FoodProduct | Recipe;
}) {
  const initialRecipe = initial && "items" in initial ? initial : null;
  const initialProduct = initial && !("items" in initial) ? initial : null;
  const [meal, setMeal] = useState(initialMeal);
  const [products, setProducts] = useState<FoodProduct[] | null>(null);
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [q, setQ] = useState("");
  const [list, setList] = useState<List>("recent");
  const [picked, setPicked] = useState<FoodProduct | null>(initialProduct);
  const [pickedRecipe, setPickedRecipe] = useState<Recipe | null>(initialRecipe);
  const [recipeEdit, setRecipeEdit] = useState<Recipe | "new" | null>(null);
  const [catalog, setCatalog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false); // правка выбранного продукта
  const [grams, setGrams] = useState(() => initialRecipe ? str(initialRecipe.lastGrams ?? api.portionWeight(initialRecipe)) || "100" : String(initialProduct?.lastGrams ?? 100));
  const [busy, setBusy] = useState(false);
  // Форма продукта (новый или правка)
  const [name, setName] = useState("");
  const [p, setP] = useState(""); const [f, setF] = useState(""); const [c, setC] = useState(""); const [kcal, setKcal] = useState("");
  const [remember, setRemember] = useState(true);

  const loadRecipes = () => api.fetchRecipes(clientId).then((l) => { setRecipes(l); return l; })
    .catch((e) => { console.error("[FoodAddSheet] рецепты:", e); setRecipes([]); return [] as Recipe[]; });
  const loadAll = () => {
    api.fetchProducts(clientId).then(setProducts).catch((e) => { console.error("[FoodAddSheet] продукты:", e); setProducts([]); });
    loadRecipes();
  };
  useEffect(loadAll, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const term = api.searchKey(q);
  const shown = useMemo<Item[]>(() => {
    const ps: Item[] = (products ?? []).map((x) => ({ kind: "product", p: x }));
    const rs: Item[] = (recipes ?? []).map((r) => ({ kind: "recipe", r, per: api.recipePer100(r) }));
    let l = list === "recipes" ? rs : [...ps, ...rs];
    if (term) l = l.filter((x) => api.searchKey(itemName(x)).includes(term));
    if (list === "fav") l = l.filter(itemFav);
    if (list === "recent") { l = l.filter((x) => term || itemUsed(x)).sort((a, b) => itemUsed(b).localeCompare(itemUsed(a))); if (!term) l = l.slice(0, 30); }
    else l = [...l].sort((a, b) => itemName(a).localeCompare(itemName(b), "ru"));
    return l;
  }, [products, recipes, term, list]);

  const autoKcal = api.kcalOf({ protein: api.num(p), fat: api.num(f), carbs: api.num(c) });
  const formPer100: api.Macros = { kcal: kcal.trim() ? api.num(kcal) : autoKcal, protein: api.num(p), fat: api.num(f), carbs: api.num(c) };
  const recipePer = pickedRecipe ? api.recipePer100(pickedRecipe) : null;
  const portion = pickedRecipe ? api.portionWeight(pickedRecipe) : 0;
  const base = editing ? null : recipePer ?? picked ?? (creating ? formPer100 : null);
  const g = api.num(grams);
  const eaten = base ? api.scale(base, g) : api.ZERO;
  const mealLabel = api.MEALS.find((m) => m.key === meal)!.label;

  const patchLocal = (id: string, patch: Partial<FoodProduct>) => {
    setProducts((l) => (l ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setPicked((x) => (x && x.id === id ? { ...x, ...patch } : x));
  };
  const pick = (x: FoodProduct) => { setPicked(x); setGrams(String(x.lastGrams ?? 100)); };
  const pickRecipe = (r: Recipe) => { setPickedRecipe(r); setGrams(str(r.lastGrams ?? api.portionWeight(r)) || "100"); };
  const fillForm = (x: { name: string } & api.Macros) => { setName(x.name); setP(str(x.protein)); setF(str(x.fat)); setC(str(x.carbs)); setKcal(Math.round(api.kcalOf(x)) === Math.round(x.kcal) ? "" : str(x.kcal)); };
  const startNew = () => { setCreating(true); setPicked(null); fillForm({ name: q.trim(), ...api.ZERO }); setGrams("100"); };
  const startEdit = () => { if (picked) { fillForm(picked); setEditing(true); } };
  const back = () => { if (editing) { setEditing(false); return; } setPicked(null); setPickedRecipe(null); setCreating(false); };

  const run = async (f: () => Promise<void>, msg = "Не удалось сохранить. Проверь интернет.") => {
    if (busy) return;
    setBusy(true);
    try { await f(); } catch (e) { console.error("[FoodAddSheet]", e); notify(msg); } finally { setBusy(false); }
  };
  const toggleFav = (x: Item) => {
    if (x.kind === "product") {
      patchLocal(x.p.id, { favorite: !x.p.favorite });
      api.updateProduct(x.p.id, { favorite: !x.p.favorite }).catch((e) => { console.error("[FoodAddSheet] избранное:", e); patchLocal(x.p.id, { favorite: x.p.favorite }); });
    } else {
      const flip = (v: boolean) => { setRecipes((l) => (l ?? []).map((r) => (r.id === x.r.id ? { ...r, favorite: v } : r))); setPickedRecipe((r) => (r && r.id === x.r.id ? { ...r, favorite: v } : r)); };
      flip(!x.r.favorite);
      api.updateRecipeMeta(x.r.id, { favorite: !x.r.favorite }).catch((e) => { console.error("[FoodAddSheet] избранное:", e); flip(x.r.favorite); });
    }
  };
  const saveEdit = () => run(async () => {
    if (!picked || !name.trim()) return;
    const patch = { name: name.trim(), ...formPer100 };
    await api.updateProduct(picked.id, patch);
    patchLocal(picked.id, patch);
    setEditing(false);
  });
  const removeProduct = async () => {
    if (!picked || !(await ask(`Удалить «${picked.name}» из моих продуктов? Записи в дневнике останутся.`, { danger: true, ok: "Удалить" }))) return;
    run(async () => {
      await api.deleteProduct(picked.id);
      setProducts((l) => (l ?? []).filter((x) => x.id !== picked.id));
      setPicked(null); setEditing(false);
    }, "Не удалось удалить продукт.");
  };

  const save = () => run(async () => {
    if (!g || !base || (creating && !name.trim())) return;
    // Без сети запись уйдёт в очередь и вернётся с пометкой «ждёт отправки»
    const entry = await api.addEntryOrQueue({
      clientId,
      entry: { date, meal, productId: picked?.id ?? null, recipeId: pickedRecipe?.id ?? null, name: pickedRecipe?.name ?? picked?.name ?? name.trim(), grams: g, ...eaten },
      newProduct: creating && remember ? { name: name.trim(), ...formPer100 } : undefined,
      touch: picked ? { productId: picked.id, grams: g } : pickedRecipe ? { recipeId: pickedRecipe.id, grams: g } : undefined,
    });
    track("action", "food_add", { source: pickedRecipe ? "recipe" : picked ? "product" : remember ? "new_saved" : "new", meal, pending: !!entry.pending });
    if (entry.pending) notify("Нет интернета — запись сохранена на телефоне и отправится сама, когда появится сеть.", "info");
    onAdded(entry);
    onClose();
  }, "Не удалось добавить. Проверь интернет и попробуй ещё раз.");

  if (catalog) {
    // Каталог мог поменять продукты и рецепты — по возвращении список перечитываем
    return (
      <Suspense fallback={null}>
        <NutritionCatalog clientId={clientId} onClose={() => { setCatalog(false); loadAll(); }}
          onPick={(x) => { setCatalog(false); loadAll(); if ("items" in x) pickRecipe(x); else pick(x); }} />
      </Suspense>
    );
  }

  if (recipeEdit) {
    return (
      <RecipeEditor clientId={clientId} recipe={recipeEdit === "new" ? null : recipeEdit} products={products ?? []}
        onProductAdded={(x) => setProducts((l) => [x, ...(l ?? [])])} onClose={onClose}
        onSaved={async (id) => { const l = await loadRecipes(); setRecipeEdit(null); const r = l.find((x) => x.id === id); if (r) pickRecipe(r); }}
        onDeleted={async () => { await loadRecipes(); setRecipeEdit(null); setPickedRecipe(null); }} />
    );
  }

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

  const current = pickedRecipe ? { kind: "recipe" as const, r: pickedRecipe, per: recipePer! } : picked ? { kind: "product" as const, p: picked } : null;
  const title = editing ? "Изменить продукт" : creating ? "Новый продукт" : current ? itemName(current) : mealLabel;
  const chip = (on: boolean) => `h-9 px-3 rounded-full text-[13px] font-semibold transition ${on ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`;
  return (
    <ModalShell title={title} onClose={onClose} footer={footer}>
      <div className="p-4 space-y-3">
        {(current || creating) && (
          <div className="flex items-center justify-between -mt-1">
            <button onClick={back} className="flex items-center gap-1 text-sm font-semibold text-zinc-400 hover:text-zinc-100 transition"><ChevronLeft size={17} /> {editing ? "Назад" : "К списку"}</button>
            {current && !editing && (
              <div className="flex gap-1">
                <button onClick={() => toggleFav(current)} aria-pressed={itemFav(current)} aria-label={itemFav(current) ? "Убрать из избранного" : "В избранное"}
                  className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition"><Star size={18} className={itemFav(current) ? "text-amber-400 fill-amber-400" : "text-zinc-500"} /></button>
                <button onClick={() => (pickedRecipe ? setRecipeEdit(pickedRecipe) : startEdit())} aria-label={pickedRecipe ? "Открыть рецепт" : "Изменить продукт"}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition"><Pencil size={17} /></button>
              </div>
            )}
          </div>
        )}

        {!current && !creating && (
          <>
            <label className="flex items-center gap-2.5 h-11 px-3.5 rounded-xl bg-zinc-800">
              <Search size={18} className="text-zinc-500 shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти продукт или рецепт" className="flex-1 min-w-0 bg-transparent outline-none" />
            </label>
            {!initial && (
              <button onClick={() => setCatalog(true)} className="w-full h-11 -my-1 flex items-center justify-between px-1 text-sm font-semibold text-zinc-300 hover:text-zinc-100 transition">
                Все продукты и рецепты <ChevronRight size={18} className="text-zinc-500" />
              </button>
            )}
            <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-0.5">
              {LISTS.map(([k, l]) => (
                <button key={k} onClick={() => setList(k)} aria-pressed={list === k} className={`${chip(list === k)} shrink-0 !px-3.5`}>{l}</button>
              ))}
            </div>
            {list === "recipes"
              ? <button onClick={() => setRecipeEdit("new")} className="w-full flex items-center gap-2 h-10 px-1 text-sm font-semibold text-lime-400"><Plus size={18} /> Новый рецепт</button>
              : <button onClick={startNew} className="w-full flex items-center gap-2 h-10 px-1 text-sm font-semibold text-lime-400"><Plus size={18} /> {term ? `Новый продукт «${q.trim()}»` : "Новый продукт"}</button>}
            {products === null || recipes === null ? <SkeletonRows rows={3} /> : shown.length === 0 ? (
              <p className="text-sm text-zinc-500 px-1">
                {list === "recipes" && !recipes.length ? "Рецептов пока нет. Собери блюдо из своих продуктов — КБЖУ посчитаются по весу готового."
                  : !products.length && !recipes.length ? "Здесь появятся продукты, которые ты добавишь. Начни с «Новый продукт» — КБЖУ на 100 г есть на упаковке."
                  : list === "fav" && !term ? "В избранном пусто — отметь продукт или рецепт звёздочкой."
                  : list === "recent" && !term ? "Недавних пока нет — открой «Все»." : "Ничего не нашлось"}
              </p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {shown.map((x) => (
                  <div key={x.kind + (x.kind === "product" ? x.p.id : x.r.id)} className="flex items-center">
                    <button onClick={() => (x.kind === "product" ? pick(x.p) : pickRecipe(x.r))} className="flex-1 min-w-0 text-left py-2.5 px-1 hover:bg-zinc-800/50 rounded-lg transition">
                      <span className="flex items-center gap-1.5 font-semibold min-w-0">{x.kind === "recipe" && <BookOpen size={15} className="text-zinc-500 shrink-0" />}<span className="truncate">{itemName(x)}</span></span>
                      <span className="block text-[13px] text-zinc-500 truncate">
                        {x.kind === "product" ? `на 100 г: ${per100(x.p)}` : `рецепт · на 100 г ${api.fmtN(x.per.kcal, 0)} ккал${x.r.servings > 1 ? ` · порция ${api.fmtN(api.portionWeight(x.r), 0)} г` : ""}`}
                      </span>
                    </button>
                    <button onClick={() => toggleFav(x)} aria-pressed={itemFav(x)} aria-label={itemFav(x) ? `Убрать «${itemName(x)}» из избранного` : `«${itemName(x)}» в избранное`}
                      className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition"><Star size={18} className={itemFav(x) ? "text-amber-400 fill-amber-400" : "text-zinc-600"} /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {picked && !editing && <p className="text-[13px] text-zinc-400">На 100 г: {per100(picked)}</p>}
        {pickedRecipe && recipePer && (
          <p className="text-[13px] text-zinc-400">Рецепт · на 100 г: {per100(recipePer)}{pickedRecipe.servings > 1 ? ` · порция ${api.fmtN(portion, 0)} г` : ""}</p>
        )}

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
            <p className="text-[13px] text-zinc-500 px-0.5">Ккал считаются сами: Б×4 + Ж×9 + У×4. Если на упаковке другое число — впиши его.</p>
            {editing && <p className="text-[13px] text-zinc-500 px-0.5">Уже записанное в дневник не изменится.</p>}
            {creating && <p className="text-[13px] font-semibold text-zinc-400 px-0.5 pt-1">Съедено</p>}
          </>
        )}

        {base && (
          <>
            {date !== today() && <p className="text-[13px] font-semibold text-zinc-400 px-0.5">В дневник за {new Date(date + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</p>}
            {initial && (
              <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Приём пищи">
                {api.MEALS.map((m) => <button key={m.key} onClick={() => setMeal(m.key)} aria-pressed={meal === m.key} className={`${chip(meal === m.key)} !h-11 !px-1`}>{m.label}</button>)}
              </div>
            )}
            <GramsInput value={grams} onChange={setGrams} />
            <div className="flex gap-1.5 flex-wrap">
              {pickedRecipe && pickedRecipe.servings > 1
                ? PORTIONS.map(([k, l]) => { const v = Math.round(portion * k); return <button key={k} onClick={() => setGrams(String(v))} className={chip(Math.round(g) === v)}>{l}</button>; })
                : QUICK_GRAMS.map((n) => <button key={n} onClick={() => setGrams(String(n))} className={chip(g === n)}>{n} г</button>)}
              {(() => {
                const last = picked?.lastGrams ?? pickedRecipe?.lastGrams;
                return last && !QUICK_GRAMS.includes(last) && !(pickedRecipe && PORTIONS.some(([k]) => Math.round(portion * k) === Math.round(last)))
                  ? <button onClick={() => setGrams(str(last))} className={chip(g === last)}>как в прошлый раз · {api.fmtN(last, 0)} г</button> : null;
              })()}
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

export function Per100({ label, value, onChange, color, placeholder = "0" }: { label: string; value: string; onChange: (v: string) => void; color: string; placeholder?: string }) {
  return (
    <label className="block text-center rounded-xl bg-zinc-800 px-1 py-2">
      <span className="block text-[11px] text-zinc-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder={placeholder} aria-label={`${label} на 100 г`}
        className="w-full bg-transparent text-center text-lg font-extrabold outline-none placeholder:text-zinc-600" style={{ color }} />
    </label>
  );
}
