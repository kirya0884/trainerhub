import { useEffect, useMemo, useState } from "react";
import { ChefHat, ChevronLeft, History, Pencil, Plus, Search, SearchX, Star, Trash2, WifiOff, X } from "lucide-react";
import ModalShell from "./ModalShell";
import FoodAddSheet, { Per100 } from "./FoodAddSheet";
import RecipeEditor from "./RecipeEditor";
import { MACRO_COLOR } from "./NutritionParts";
import { useModalA11y } from "../hooks/useModalA11y";
import { useKeyboardViewport } from "../hooks/useKeyboardViewport";
import * as api from "../lib/foodDiary";
import type { FoodEntry, FoodProduct, Meal, Recipe } from "../lib/foodDiary";
import { addDays, plural, toDateStr, today } from "../lib/format";
import { ask, notify } from "../lib/dialog";

type Tab = "products" | "recipes";
type Filter = "all" | "fav" | "recent";
const FILTERS: [Filter, string][] = [["all", "Все"], ["fav", "Избранное"], ["recent", "Недавние"]];
type Item = FoodProduct | Recipe;
const isRecipe = (x: Item): x is Recipe => "items" in x;
// Звезда избранного: на белом жёлтый не читается — в светлой теме темнее
const STAR = "text-amber-400 fill-amber-400 [.light-theme_&]:text-[#b86e00] [.light-theme_&]:fill-[#b86e00]";
const WARN = "text-amber-400 [.light-theme_&]:text-[#b86e00]";
const str = (n: number) => (n ? String(Math.round(n * 10) / 10).replace(".", ",") : "");
const bju = (m: api.Macros) => `Б ${api.fmtN(m.protein)} · Ж ${api.fmtN(m.fat)} · У ${api.fmtN(m.carbs)}`;
const mealNow = (): Meal => { const h = new Date().getHours(); return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 21 ? "dinner" : "snack"; };
const recipeSize = (r: Recipe) => r.servings > 1
  ? `${r.servings} ${plural(r.servings, ["порция", "порции", "порций"])} по ${api.fmtN(api.portionWeight(r), 0)} г`
  : `${api.fmtN(api.recipeWeight(r), 0)} г готового`;
const lastUsed = (p: FoodProduct) => {
  if (!p.lastUsedAt) return "ещё не записывали";
  const d = toDateStr(new Date(p.lastUsedAt));
  const day = d === today() ? "сегодня" : d === addDays(today(), -1) ? "вчера" : new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return p.lastGrams ? `${day}, ${api.fmtN(p.lastGrams, 0)} г` : day;
};

// Продукты и рецепты: свой каталог отдельно от добавления еды — поправить БЖУ, удалить дубль,
// заранее собрать рецепт. «Добавить в дневник» открывает обычное окно добавления с выбранным
// продуктом; при входе из окна добавления (onPick) — просто возвращает выбранное туда.
export default function NutritionCatalog({ clientId, date, onAdded, onPick, onClose }: {
  clientId: string;
  /** День для «Добавить в дневник»; по умолчанию сегодня */
  date?: string;
  /** Запись добавлена из каталога — дневнику обновить список */
  onAdded?: (e: FoodEntry) => void;
  /** Вход из окна добавления еды: вместо своего окна вернуть выбранный продукт или рецепт */
  onPick?: (x: Item) => void;
  onClose: () => void;
}) {
  const { titleId, panelProps } = useModalA11y(onClose);
  // С открытой клавиатурой экран стоит в видимой над ней области — список докручивается до конца
  const kb = useKeyboardViewport();
  const [products, setProducts] = useState<FoodProduct[] | null>(null);
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("products");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [card, setCard] = useState<FoodProduct | null>(null);
  const [form, setForm] = useState<{ product: FoodProduct | null; name: string } | null>(null);
  const [recipeEdit, setRecipeEdit] = useState<Recipe | "new" | null>(null);
  const [adding, setAdding] = useState<Item | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = () => {
    setFailed(false);
    return Promise.all([api.fetchProducts(clientId), api.fetchRecipes(clientId)])
      .then(([p, r]) => { setProducts(p); setRecipes(r); })
      .catch((e) => { console.error("[NutritionCatalog]", e); setFailed(true); });
  };
  useEffect(() => { load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 2500); return () => clearTimeout(t); }, [flash]);
  // Имя удалённого: второе удаление за 2,5 с меняет текст — диктор объявит и его
  const [gone, setGone] = useState("");
  useEffect(() => { if (!gone) return; const t = setTimeout(() => setGone(""), 2500); return () => clearTimeout(t); }, [gone]);

  const term = api.searchKey(q);
  const shown = useMemo<Item[]>(() => {
    const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, "ru");
    const used = (x: Item) => x.lastUsedAt ?? "";
    let l: Item[] = tab === "recipes" || filter === "all" ? (tab === "recipes" ? recipes : products) ?? [] : [...products ?? [], ...recipes ?? []];
    if (term) l = l.filter((x) => api.searchKey(x.name).includes(term));
    if (tab === "products" && filter === "fav") l = l.filter((x) => x.favorite);
    if (tab === "products" && filter === "recent") return l.filter(used).sort((a, b) => used(b).localeCompare(used(a))).slice(0, 30);
    return [...l].sort(byName);
  }, [products, recipes, tab, filter, term]);

  const patchProduct = (p: FoodProduct) => {
    setProducts((l) => (l ?? []).map((x) => (x.id === p.id ? p : x)));
    setCard((c) => (c && c.id === p.id ? p : c));
  };
  const toggleFav = (p: FoodProduct) => {
    patchProduct({ ...p, favorite: !p.favorite });
    api.updateProduct(p.id, { favorite: !p.favorite }).catch((e) => { console.error("[NutritionCatalog] избранное:", e); patchProduct(p); notify("Не удалось сохранить. Проверь интернет."); });
  };
  const inRecipes = (p: FoodProduct) => (recipes ?? []).filter((r) => r.items.some((i) => i.productId === p.id)).map((r) => r.name);
  const remove = async (p: FoodProduct) => {
    const rs = inRecipes(p);
    const tail = rs.length ? ` ${rs.length > 1 ? "Рецепты" : "Рецепт"} ${rs.map((n) => `«${n}»`).join(" и ")} не пересчита${rs.length > 1 ? "ются" : "ется"} — состав в них хранится отдельно.` : "";
    if (!(await ask(`Удалить «${p.name}»?\nЗаписи в дневнике останутся.${tail}`, { danger: true, ok: "Удалить" }))) return;
    try {
      await api.deleteProduct(p.id);
      setProducts((l) => (l ?? []).filter((x) => x.id !== p.id));
      setCard(null);
      setGone(p.name);
    } catch (e) { console.error("[NutritionCatalog] удаление:", e); notify("Не удалось удалить продукт. Проверь интернет."); }
  };
  const addToDiary = (x: Item) => { setCard(null); setRecipeEdit(null); if (onPick) onPick(x); else setAdding(x); };
  const startNew = () => (tab === "recipes" ? setRecipeEdit("new") : setForm({ product: null, name: q.trim() }));

  const loading = (products === null || recipes === null) && !failed;
  const segBtn = (on: boolean) => `flex-1 h-10 flex items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition ${on ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"}`;
  const pill = (on: boolean) => `h-11 px-4 shrink-0 flex items-center gap-1.5 rounded-full text-[14px] font-semibold transition ${on ? "bg-lime-400 text-zinc-950" : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100"}`;
  const empty = (icon: JSX.Element, title: string, text: string, action?: [string, () => void]) => (
    <div className="mt-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-center px-5 pt-7 pb-5">
      <div className="w-16 h-16 mx-auto mb-3.5 rounded-2xl bg-zinc-800 text-zinc-400 flex items-center justify-center">{icon}</div>
      {title && <p className="text-[17px] font-bold">{title}</p>}
      <p className="text-sm text-zinc-400 leading-snug mt-1.5">{text}</p>
      {action && <button onClick={action[1]} className="mt-4 w-full h-11 flex items-center justify-center gap-1.5 rounded-xl bg-lime-400 text-zinc-950 font-bold hover:bg-lime-300 transition"><Plus size={18} /> {action[0]}</button>}
    </div>
  );

  let body: JSX.Element | null = null;
  if (loading) {
    body = (
      <div className="mt-3 rounded-2xl bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800 animate-pulse" role="status" aria-label="Загрузка">
        {[55, 40, 62, 48].map((w) => (
          <div key={w} className="h-[60px] flex items-center gap-3 px-3.5">
            <div className="flex-1"><div className="h-3 rounded-full bg-zinc-800" style={{ width: `${w}%` }} /><div className="h-2.5 mt-2 rounded-full bg-zinc-800" style={{ width: `${w + 22}%` }} /></div>
            <div className="w-9 h-4 rounded-full bg-zinc-800" />
          </div>
        ))}
      </div>
    );
  } else if (products && recipes) {
    if (shown.length) {
      body = (
        <ul className="mt-3 rounded-2xl bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {shown.map((x) => {
            const r = isRecipe(x) ? x : null;
            const per = r ? api.recipePer100(r) : (x as FoodProduct);
            const perPortion = r && r.servings > 1;
            return (
              <li key={(r ? "r" : "p") + x.id}>
                <button onClick={() => (r ? setRecipeEdit(r) : setCard(x as FoodProduct))} ref={flash === x.id ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                  className={`w-full min-h-[60px] flex items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-zinc-800/50 ${flash === x.id ? "bg-lime-400/10" : ""}`}>
                  {r && <span className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center" style={{ color: MACRO_COLOR.kcal, background: `color-mix(in srgb, ${MACRO_COLOR.kcal} 16%, transparent)` }}><ChefHat size={20} /></span>}
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5 font-semibold text-[15px]">
                      {x.favorite && <Star size={14} className={`${STAR} shrink-0`} aria-label="в избранном" />}
                      <span className="truncate">{x.name}</span>
                    </span>
                    <span className="block text-[13px] text-zinc-500 truncate mt-0.5">
                      {r ? (tab === "recipes" ? `${recipeSize(r)} · ${r.items.length} ${plural(r.items.length, ["продукт", "продукта", "продуктов"])}` : `рецепт · ${recipeSize(r)}`) : `на 100 г · ${bju(per)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <b className="block font-display text-[15px] font-bold">{api.fmtN(perPortion ? api.scale(per, api.portionWeight(r)).kcal : per.kcal, 0)}</b>
                    <small className="text-[11px] text-zinc-500">{r ? (perPortion ? "на порцию" : "на 100 г") : "ккал"}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      );
    } else if (term) {
      body = tab === "products"
        ? empty(<SearchX size={28} />, `«${q.trim()}» нет в твоих продуктах`, "Создай его — название уже подставим.", [`Создать «${q.trim()}»`, startNew])
        : empty(<SearchX size={28} />, `«${q.trim()}» нет в твоих рецептах`, "Собери его из своих продуктов.", ["Новый рецепт", startNew]);
    } else if (tab === "recipes") {
      body = empty(<ChefHat size={28} />, "", "Рецептов пока нет. Собери блюдо из своих продуктов — КБЖУ посчитаются по весу готового.", ["Новый рецепт", startNew]);
    } else if (!products.length) {
      body = empty(<Plus size={28} />, "", "Здесь появятся твои продукты. КБЖУ на 100 г есть на упаковке.", ["Новый продукт", startNew]);
    } else {
      body = empty(filter === "fav" ? <Star size={28} /> : <History size={28} />, "", filter === "fav"
        ? "В избранном пусто — отметь продукт звёздочкой в его карточке."
        : "Недавних пока нет — здесь появится то, что ты запишешь в дневник.");
    }
  }

  return (
    <>
      <div {...panelProps} className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950 text-zinc-100 outline-none" style={{ paddingTop: "env(safe-area-inset-top)", ...(kb ? { top: kb.top, bottom: kb.bottom } : {}) }}>
        <div className="max-w-lg mx-auto px-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}>
          <div className="flex items-center gap-1.5 min-h-[52px] pt-1 pb-3">
            <button onClick={onClose} aria-label="Назад" className="-ml-2.5 w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"><ChevronLeft size={24} /></button>
            <h2 id={titleId} className="font-display text-[17px] font-bold truncate">Продукты и рецепты</h2>
          </div>

          <div className="flex p-1 rounded-xl bg-zinc-900 border border-zinc-800">
            {([["products", "Продукты", products], ["recipes", "Рецепты", recipes]] as const).map(([k, l, list]) => (
              <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={segBtn(tab === k)}>
                {l}{list && <small className="text-[12px] font-semibold opacity-70">{list.length}</small>}
              </button>
            ))}
          </div>

          <div className="flex gap-2 mt-3">
            <label className="flex-1 min-w-0 flex items-center gap-2.5 h-11 pl-3 rounded-xl bg-zinc-800 focus-within:ring-2 focus-within:ring-lime-400/60">
              <Search size={18} className="text-zinc-500 shrink-0" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === "recipes" ? "Найти рецепт" : "Найти продукт"} aria-label="Поиск"
                className="flex-1 min-w-0 bg-transparent outline-none" />
              {q && <button onClick={() => setQ("")} aria-label="Очистить поиск" className="w-11 h-11 shrink-0 flex items-center justify-center text-zinc-400 hover:text-zinc-100"><X size={18} /></button>}
            </label>
            <button onClick={startNew} className="h-11 px-3.5 shrink-0 flex items-center gap-1.5 rounded-xl bg-lime-400 text-zinc-950 font-bold text-[15px] hover:bg-lime-300 transition"
              aria-label={tab === "recipes" ? "Новый рецепт" : "Новый продукт"}><Plus size={18} /> Новый</button>
          </div>

          {tab === "products" && (
            <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 mt-2.5">
              {FILTERS.map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={pill(filter === k)}>{k === "fav" && <Star size={14} />}{l}</button>
              ))}
            </div>
          )}

          {failed && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-zinc-900 border border-zinc-800 py-2 pl-3.5 pr-2" role="alert">
              <WifiOff size={22} className={`${WARN} shrink-0`} />
              <p className="flex-1 text-sm">Не удалось загрузить продукты. Проверь интернет.</p>
              <button onClick={load} className="h-11 px-3.5 rounded-xl bg-zinc-800 text-sm font-semibold hover:bg-zinc-700 transition">Повторить</button>
            </div>
          )}
          {body}
          {/* Сохранённое подсвечивается в списке, удалённое исчезает из него; тост сверху закрывал бы шапку и «Назад» — для экранного диктора объявляем тут */}
          <p role="status" className="sr-only">{flash ? "Сохранено" : gone ? `Продукт «${gone}» удалён` : ""}</p>
          {tab === "products" && filter === "fav" && shown.some(isRecipe) && <p className="text-[13px] text-zinc-500 px-0.5 mt-3">В «Избранном» видны и продукты, и рецепты — как в окне добавления.</p>}
        </div>
      </div>

      {card && !form && (
        <ProductCard product={card} recipes={inRecipes(card)} onFav={() => toggleFav(card)} onClose={() => setCard(null)}
          onAdd={() => addToDiary(card)} onEdit={() => setForm({ product: card, name: card.name })} onDelete={() => remove(card)} />
      )}
      {form && (
        <ProductForm clientId={clientId} product={form.product} initialName={form.name} onClose={() => setForm(null)}
          onSaved={(p) => {
            if (form.product) patchProduct(p);
            else { setProducts((l) => [p, ...(l ?? [])]); setTab("products"); setFilter("all"); setFlash(p.id); }
            setForm(null);
          }} />
      )}
      {recipeEdit && (
        <RecipeEditor clientId={clientId} recipe={recipeEdit === "new" ? null : recipeEdit} products={products ?? []}
          onProductAdded={(p) => setProducts((l) => [p, ...(l ?? [])])} onClose={() => setRecipeEdit(null)}
          onAddToDiary={recipeEdit === "new" ? undefined : addToDiary}
          onSaved={async (id) => { await load(); setRecipeEdit(null); setFlash(id); }}
          onDeleted={(id) => { setRecipes((l) => (l ?? []).filter((r) => r.id !== id)); setRecipeEdit(null); }} />
      )}
      {adding && (
        <FoodAddSheet clientId={clientId} date={date ?? today()} meal={mealNow()} initial={adding}
          onAdded={(e) => onAdded?.(e)} onClose={() => { setAdding(null); load(); }} />
      )}
    </>
  );
}

// Карточка продукта: КБЖУ на 100 г, когда ели и в каких рецептах — чтобы решить, править или удалять
function ProductCard({ product: p, recipes, onFav, onAdd, onEdit, onDelete, onClose }: {
  product: FoodProduct; recipes: string[]; onFav: () => void; onAdd: () => void; onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const tiles = [["Ккал", p.kcal, MACRO_COLOR.kcal, 0], ["Белки", p.protein, MACRO_COLOR.protein, 1], ["Жиры", p.fat, MACRO_COLOR.fat, 1], ["Углеводы", p.carbs, MACRO_COLOR.carbs, 1]] as const;
  return (
    <ModalShell title={p.name} onClose={onClose}>
      <div className="p-4 pt-3">
        <div className="flex items-center justify-between -mt-1 mb-2">
          <p className="text-[13px] text-zinc-400">Свой продукт · на 100 г</p>
          <button onClick={onFav} aria-pressed={p.favorite} aria-label={p.favorite ? "Убрать из избранного" : "В избранное"}
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full hover:bg-zinc-800 transition"><Star size={20} className={p.favorite ? STAR : "text-zinc-500"} /></button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {tiles.map(([l, v, color, d]) => (
            <div key={l} className="rounded-xl bg-zinc-800 px-1 py-2.5 text-center">
              <small className="block text-[11px] text-zinc-400">{l}</small>
              <b className="block font-display text-[17px] font-bold mt-0.5" style={{ color }}>{api.fmtN(v, d)}</b>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-2xl bg-zinc-800 divide-y divide-zinc-700">
          <p className="flex items-center gap-2.5 px-3.5 py-3 text-sm text-zinc-400"><History size={18} className="shrink-0" /><span className="shrink-0">Последний раз</span><b className="ml-auto text-right font-semibold text-zinc-100">{lastUsed(p)}</b></p>
          <p className="flex items-center gap-2.5 px-3.5 py-3 text-sm text-zinc-400"><ChefHat size={18} className="shrink-0" /><span className="shrink-0">В рецептах</span><b className="ml-auto min-w-0 text-right font-semibold text-zinc-100">{recipes.length ? recipes.join(", ") : "нет"}</b></p>
        </div>
        <button onClick={onAdd} className="mt-4 w-full h-[52px] flex items-center justify-center gap-2 rounded-xl bg-lime-400 text-zinc-950 font-bold text-base hover:bg-lime-300 transition"><Plus size={20} /> Добавить в дневник</button>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <button onClick={onEdit} className="h-11 flex items-center justify-center gap-1.5 rounded-xl bg-zinc-800 text-[15px] font-semibold hover:bg-zinc-700 transition"><Pencil size={17} /> Изменить</button>
          <button onClick={onDelete} className="h-11 flex items-center justify-center gap-1.5 rounded-xl bg-zinc-800 text-[15px] font-semibold text-red-400 [.light-theme_&]:text-[#c9302c] hover:bg-red-500/10 transition"><Trash2 size={17} /> Удалить</button>
        </div>
      </div>
    </ModalShell>
  );
}

// Новый продукт или правка: БЖУ на 100 г, ккал сами по 4/9/4 — можно вписать своё число с упаковки
function ProductForm({ clientId, product, initialName, onSaved, onClose }: {
  clientId: string; product: FoodProduct | null; initialName: string; onSaved: (p: FoodProduct) => void; onClose: () => void;
}) {
  const init = product ?? { name: initialName, ...api.ZERO };
  const [name, setName] = useState(init.name);
  const [p, setP] = useState(str(init.protein)); const [f, setF] = useState(str(init.fat)); const [c, setC] = useState(str(init.carbs));
  const [kcal, setKcal] = useState(product && Math.round(api.kcalOf(product)) !== Math.round(product.kcal) ? str(product.kcal) : "");
  const [fav, setFav] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const auto = api.kcalOf({ protein: api.num(p), fat: api.num(f), carbs: api.num(c) });
  const dirty = name !== init.name || p !== str(init.protein) || f !== str(init.fat) || c !== str(init.carbs) || (product ? kcal !== (Math.round(api.kcalOf(product)) !== Math.round(product.kcal) ? str(product.kcal) : "") : !!kcal) || fav;

  const close = async () => { if (!dirty || busy || (await ask("Выйти без сохранения?", { ok: "Выйти", cancel: "Остаться" }))) onClose(); };
  const save = async () => {
    if (busy || !name.trim()) return;
    if (api.num(p) + api.num(f) + api.num(c) > 100) { setErr("Белков, жиров и углеводов больше 100 г — проверь цифры."); return; }
    setErr(""); setBusy(true);
    const m = { name: name.trim(), kcal: kcal.trim() ? api.num(kcal) : auto, protein: api.num(p), fat: api.num(f), carbs: api.num(c) };
    try {
      if (product) { await api.updateProduct(product.id, m); onSaved({ ...product, ...m }); return; }
      onSaved(await api.addProduct(clientId, { ...m, favorite: fav }));
    } catch (e) { console.error("[ProductForm]", e); notify("Не удалось сохранить. Проверь интернет."); setBusy(false); }
  };

  const footer = (
    <div className="p-4 border-t border-zinc-800 shrink-0">
      <button onClick={save} disabled={busy || !name.trim()} className="w-full h-[52px] bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">{busy ? "Сохраняю…" : "Сохранить продукт"}</button>
    </div>
  );
  return (
    <ModalShell title={product ? "Изменить продукт" : "Новый продукт"} onClose={close} footer={footer}>
      <div className="p-4 space-y-2">
        <label className="block">
          <span className="block text-[13px] font-semibold text-zinc-400 mb-2 px-0.5">Название</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Кефир 1%»" className="w-full h-12 px-3.5 rounded-xl bg-zinc-800 font-semibold outline-none focus:ring-2 focus:ring-lime-400/60" />
        </label>
        <p className="flex justify-between text-[13px] font-semibold text-zinc-400 px-0.5 pt-2">На 100 г <span className="font-medium text-zinc-500">с упаковки</span></p>
        <div className="grid grid-cols-4 gap-1.5">
          <Per100 label="Белки" value={p} onChange={setP} color={MACRO_COLOR.protein} />
          <Per100 label="Жиры" value={f} onChange={setF} color={MACRO_COLOR.fat} />
          <Per100 label="Углеводы" value={c} onChange={setC} color={MACRO_COLOR.carbs} />
          <Per100 label={kcal.trim() ? "Ккал" : "Ккал · авто"} value={kcal} onChange={setKcal} color={MACRO_COLOR.kcal} placeholder={auto ? api.fmtN(auto, 0) : "авто"} />
        </div>
        <p className="text-[13px] text-zinc-500 px-0.5 leading-snug">Ккал считаем сами: белки × 4 + жиры × 9 + углеводы × 4. Если на упаковке другое число — впиши его.</p>
        {product && <p className="text-[13px] text-zinc-500 px-0.5">Уже записанное в дневник не изменится.</p>}
        {!product && (
          <button role="switch" aria-checked={fav} onClick={() => setFav(!fav)} className="w-full min-h-[44px] flex items-center gap-2.5 text-left text-[15px]">
            <Star size={18} className={fav ? STAR : "text-zinc-500"} /> Сразу в избранное
            <span className={`ml-auto w-11 h-[26px] shrink-0 rounded-full p-[3px] flex transition ${fav ? "bg-lime-400 justify-end" : "bg-zinc-800 border border-zinc-700"}`}>
              <span className={`w-5 h-5 rounded-full ${fav ? "bg-[#0B0D0C]" : "bg-zinc-500"}`} />
            </span>
          </button>
        )}
        {err && <p role="alert" className="text-[13px] text-red-400 [.light-theme_&]:text-[#c9302c] px-0.5">{err}</p>}
      </div>
    </ModalShell>
  );
}
