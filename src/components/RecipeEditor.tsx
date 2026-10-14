import { useMemo, useState } from "react";
import { BookOpen, ChevronLeft, Plus, Search, Trash2, X } from "lucide-react";
import ModalShell from "./ModalShell";
import { MACRO_COLOR } from "./NutritionParts";
import * as api from "../lib/foodDiary";
import type { FoodProduct, Recipe, RecipeItem } from "../lib/foodDiary";

const str = (n: number | null | undefined) => (n ? String(Math.round(n * 10) / 10).replace(".", ",") : "");
const line = (m: api.Macros) => `Б ${api.fmtN(m.protein)} · Ж ${api.fmtN(m.fat)} · У ${api.fmtN(m.carbs)}`;
type Row = RecipeItem & { key: number; g: string };
let seq = 0;

// Рецепт: состав из своих продуктов (сырой вес), вес готового блюда и порции.
// КБЖУ на 100 г и на порцию считаются сразу. Новый продукт для состава запоминается в «Мои продукты».
export default function RecipeEditor({ clientId, recipe, products, onProductAdded, onSaved, onDeleted, onClose }: {
  clientId: string; recipe: Recipe | null; products: FoodProduct[];
  onProductAdded: (p: FoodProduct) => void; onSaved: (id: string) => void; onDeleted: (id: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(recipe?.name ?? "");
  const [rows, setRows] = useState<Row[]>(() => (recipe?.items ?? []).map((i) => ({ ...i, key: ++seq, g: str(i.grams) })));
  const [cooked, setCooked] = useState(str(recipe?.cookedWeight));
  const [servings, setServings] = useState(String(recipe?.servings ?? 1));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const items: RecipeItem[] = rows.map(({ key: _k, g, ...i }) => ({ ...i, grams: api.num(g) }));
  const draft = { cookedWeight: api.num(cooked) || null, items, servings: Math.max(1, Math.round(api.num(servings)) || 1) };
  const raw = api.recipeRawWeight(items);
  const per100 = api.recipePer100(draft);
  const portion = api.portionWeight(draft);
  const perPortion = api.scale(per100, portion);
  const canSave = !!name.trim() && items.some((i) => i.grams > 0);

  const addRow = (p: { id: string | null; name: string } & api.Macros) => {
    setRows((l) => [...l, { productId: p.id, name: p.name, kcal: p.kcal, protein: p.protein, fat: p.fat, carbs: p.carbs, grams: 100, g: "100", key: ++seq }]);
    setPicking(false);
  };
  const run = async (f: () => Promise<void>, msg: string) => {
    if (busy) return;
    setBusy(true);
    try { await f(); } catch (e) { console.error("[RecipeEditor]", e); alert(msg); setBusy(false); }
  };
  const save = () => run(async () => {
    if (!canSave) return;
    const id = await api.saveRecipe(clientId, { id: recipe?.id, name: name.trim(), ...draft, items: items.filter((i) => i.grams > 0) });
    onSaved(id);
  }, "Не удалось сохранить рецепт. Проверьте интернет.");
  const remove = () => {
    if (!recipe || !window.confirm(`Удалить рецепт «${recipe.name}»? Записи в дневнике останутся.`)) return;
    run(async () => { await api.deleteRecipe(recipe.id); onDeleted(recipe.id); }, "Не удалось удалить рецепт.");
  };

  if (picking) return <IngredientPicker clientId={clientId} products={products} onPick={addRow} onProductAdded={onProductAdded} onBack={() => setPicking(false)} onClose={onClose} />;

  const footer = (
    <div className="p-4 border-t border-zinc-800 shrink-0 space-y-2">
      <button onClick={save} disabled={busy || !canSave} className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">
        {busy ? "Сохраняю…" : recipe ? "Сохранить рецепт" : "Создать рецепт"}
      </button>
      {recipe && <button onClick={remove} disabled={busy} className="w-full h-10 flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-red-400 hover:bg-red-500/10 transition"><Trash2 size={16} /> Удалить рецепт</button>}
    </div>
  );

  return (
    <ModalShell title={recipe ? "Рецепт" : "Новый рецепт"} icon={<BookOpen size={16} className="text-lime-400" />} onClose={onClose} footer={footer}>
      <div className="p-4 space-y-3">
        <input autoFocus={!recipe} value={name} onChange={(e) => setName(e.target.value)} placeholder="Название, например «Плов с курицей»"
          className="w-full h-12 px-3.5 rounded-xl bg-zinc-800 outline-none focus:ring-2 focus:ring-lime-400/50 font-semibold" />

        <div className="flex items-baseline justify-between px-0.5">
          <p className="font-bold">Состав</p>
          <p className="text-[13px] text-zinc-500">сырой вес{raw ? ` · ${api.fmtN(raw, 0)} г` : ""}</p>
        </div>
        <div className="bg-zinc-800/50 rounded-2xl overflow-hidden">
          {rows.map((r, n) => (
            <div key={r.key} className={`flex items-center gap-2 px-3 py-2 ${n ? "border-t border-zinc-800" : ""}`}>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold truncate">{r.name}</span>
                <span className="block text-[12px] text-zinc-500">{api.fmtN(api.scale(r, api.num(r.g)).kcal, 0)} ккал</span>
              </span>
              <label className="flex items-baseline gap-0.5 h-9 w-[74px] rounded-lg bg-zinc-800 px-2 shrink-0">
                <input value={r.g} onChange={(e) => setRows((l) => l.map((x) => (x.key === r.key ? { ...x, g: e.target.value } : x)))} onFocus={(e) => e.target.select()}
                  inputMode="decimal" aria-label={`Граммы: ${r.name}`} className="w-full bg-transparent text-right font-bold outline-none self-center" />
                <span className="text-[12px] text-zinc-500">г</span>
              </label>
              <button onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))} aria-label={`Убрать «${r.name}»`} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-500 hover:text-red-400 transition"><X size={16} /></button>
            </div>
          ))}
          <button onClick={() => setPicking(true)} className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-lime-400 ${rows.length ? "border-t border-zinc-800" : ""}`}><Plus size={17} /> Ингредиент</button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block rounded-xl bg-zinc-800 px-3 py-2">
            <span className="block text-[12px] text-zinc-400">Вес готового, г</span>
            <input value={cooked} onChange={(e) => setCooked(e.target.value)} inputMode="decimal" placeholder={raw ? api.fmtN(raw, 0).replace(/\s/g, "") : "—"}
              className="w-full bg-transparent text-lg font-extrabold outline-none placeholder:text-zinc-600" />
          </label>
          <label className="block rounded-xl bg-zinc-800 px-3 py-2">
            <span className="block text-[12px] text-zinc-400">Порций</span>
            <input value={servings} onChange={(e) => setServings(e.target.value)} inputMode="numeric" className="w-full bg-transparent text-lg font-extrabold outline-none" />
          </label>
        </div>
        <p className="text-[13px] text-zinc-500 px-0.5">Взвесьте готовое блюдо: рис и крупы впитывают воду, мясо её теряет. Без веса считаем по сумме сырых продуктов.</p>

        {raw > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-zinc-800/50 px-3.5 py-3">
              <small className="text-[12px] text-zinc-400">На 100 г готового</small>
              <b className="block text-xl font-extrabold" style={{ color: MACRO_COLOR.kcal }}>{api.fmtN(per100.kcal, 0)} ккал</b>
              <p className="text-[12px] text-zinc-400 mt-0.5">{line(per100)}</p>
            </div>
            <div className="rounded-2xl bg-zinc-800/50 px-3.5 py-3">
              <small className="text-[12px] text-zinc-400">Порция · {api.fmtN(portion, 0)} г</small>
              <b className="block text-xl font-extrabold" style={{ color: MACRO_COLOR.kcal }}>{api.fmtN(perPortion.kcal, 0)} ккал</b>
              <p className="text-[12px] text-zinc-400 mt-0.5">{line(perPortion)}</p>
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// Выбор ингредиента из своих продуктов или новый продукт (сразу в «Мои продукты»)
function IngredientPicker({ clientId, products, onPick, onProductAdded, onBack, onClose }: {
  clientId: string; products: FoodProduct[]; onPick: (p: { id: string | null; name: string } & api.Macros) => void;
  onProductAdded: (p: FoodProduct) => void; onBack: () => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [p, setP] = useState(""); const [f, setF] = useState(""); const [c, setC] = useState(""); const [kcal, setKcal] = useState("");
  const [busy, setBusy] = useState(false);
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => products.filter((x) => !term || x.name.toLowerCase().includes(term)).sort((a, b) => a.name.localeCompare(b.name, "ru")), [products, term]);
  const auto = api.kcalOf({ protein: api.num(p), fat: api.num(f), carbs: api.num(c) });

  const create = async () => {
    if (busy || !q.trim()) return;
    setBusy(true);
    try {
      const prod = await api.addProduct(clientId, { name: q.trim(), kcal: kcal.trim() ? api.num(kcal) : auto, protein: api.num(p), fat: api.num(f), carbs: api.num(c) });
      onProductAdded(prod);
      onPick(prod);
    } catch (e) { console.error("[IngredientPicker]", e); alert("Не удалось сохранить продукт."); setBusy(false); }
  };
  const box = (label: string, v: string, set: (s: string) => void, color: string, ph = "0") => (
    <label className="block text-center rounded-xl bg-zinc-800 px-1 py-2">
      <span className="block text-[11px] text-zinc-400">{label}</span>
      <input value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" placeholder={ph} aria-label={`${label} на 100 г`} className="w-full bg-transparent text-center text-lg font-extrabold outline-none placeholder:text-zinc-600" style={{ color }} />
    </label>
  );

  return (
    <ModalShell title="Ингредиент" onClose={onClose}
      footer={creating ? <div className="p-4 border-t border-zinc-800 shrink-0"><button onClick={create} disabled={busy || !q.trim()} className="w-full h-12 bg-lime-400 text-zinc-950 font-bold rounded-xl hover:bg-lime-300 transition disabled:opacity-40">{busy ? "Сохраняю…" : "Добавить в состав"}</button></div> : undefined}>
      <div className="p-4 space-y-3">
        <button onClick={creating ? () => setCreating(false) : onBack} className="flex items-center gap-1 -mt-1 text-sm font-semibold text-zinc-400 hover:text-zinc-100 transition"><ChevronLeft size={17} /> Назад</button>
        <label className="flex items-center gap-2.5 h-11 px-3.5 rounded-xl bg-zinc-800">
          {!creating && <Search size={18} className="text-zinc-500 shrink-0" />}
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={creating ? "Название продукта" : "Найти в моих продуктах"} className="flex-1 min-w-0 bg-transparent outline-none" />
        </label>
        {creating ? (
          <>
            <p className="text-[13px] font-semibold text-zinc-400 px-0.5">На 100 г — с упаковки</p>
            <div className="grid grid-cols-4 gap-1.5">
              {box("Белки", p, setP, MACRO_COLOR.protein)}{box("Жиры", f, setF, MACRO_COLOR.fat)}{box("Углеводы", c, setC, MACRO_COLOR.carbs)}{box("Ккал", kcal, setKcal, MACRO_COLOR.kcal, auto ? api.fmtN(auto, 0) : "авто")}
            </div>
            <p className="text-[13px] text-zinc-500 px-0.5">Продукт запомнится в «Мои продукты».</p>
          </>
        ) : (
          <>
            <button onClick={() => setCreating(true)} className="w-full flex items-center gap-2 h-10 px-1 text-sm font-semibold text-lime-400"><Plus size={18} /> {term ? `Новый продукт «${q.trim()}»` : "Новый продукт"}</button>
            {shown.length === 0 ? <p className="text-sm text-zinc-500 px-1">{products.length ? "Ничего не нашлось" : "Своих продуктов пока нет — создайте первый."}</p> : (
              <div className="divide-y divide-zinc-800">
                {shown.map((x) => (
                  <button key={x.id} onClick={() => onPick(x)} className="w-full text-left py-2.5 px-1 hover:bg-zinc-800/50 rounded-lg transition">
                    <span className="block font-semibold truncate">{x.name}</span>
                    <span className="block text-[13px] text-zinc-500">на 100 г: {line(x)} · {api.fmtN(x.kcal, 0)} ккал</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
