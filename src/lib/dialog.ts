// Свои сообщения и подтверждения вместо alert/confirm. Системные окна браузера на телефоне
// показывают адрес сайта, выбиваются из дизайна и блокируют страницу (в Safari — особенно).
// notify() — короткое сообщение сверху, само исчезает; ask() — окно подтверждения,
// возвращает Promise<boolean>; askInput() — окно с полями ввода вместо prompt,
// возвращает значения или null при отмене. Рисует их DialogHost (подключён в main.tsx).

export type Toast = { id: number; text: string; kind: "info" | "error"; action?: ToastAction };
/** Кнопка в сообщении, например «Отменить» после переноса */
export type ToastAction = { label: string; run: () => void };
/** password — поле со скрытым вводом (пароль перед удалением аккаунта) */
export type Field = { key: string; label: string; value?: string; placeholder?: string; numeric?: boolean; password?: boolean };
/** alt — вторая явная кнопка (choose); тогда закрытие окна (фон, Esc) — это отмена */
export type Ask = { id: number; text: string; ok: string; cancel: string; danger: boolean; fields?: Field[]; alt?: string; resolve: (v: boolean | "alt", values?: Record<string, string>) => void };
type State = { toasts: Toast[]; ask: Ask | null; queue: Ask[] };

let state: State = { toasts: [], ask: null, queue: [] };
let seq = 0;
const listeners = new Set<(s: State) => void>();
const emit = () => listeners.forEach((l) => l(state));

export function subscribe(l: (s: State) => void) {
  listeners.add(l); l(state);
  return () => { listeners.delete(l); };
}

/** Похоже на ошибку — красный значок; остальное — нейтрально */
const looksLikeError = (t: string) => /не удалось|ошибк|не получилось|проверьте интернет|проверь интернет|нет интернета/i.test(t);

/** Возвращает id сообщения — чтобы закрыть его раньше (dismiss) */
export function notify(text: string, kind?: Toast["kind"], action?: ToastAction) {
  const t: Toast = { id: ++seq, text, kind: kind ?? (looksLikeError(text) ? "error" : "info"), action };
  state = { ...state, toasts: [...state.toasts.slice(-2), t] };
  emit();
  // Длинный текст висит дольше: ~4 с плюс время на чтение; с кнопкой — не меньше 5 с
  setTimeout(() => dismiss(t.id), Math.max(action ? 8000 : 0, Math.min(12000, 3500 + text.length * 40)));
  return t.id;
}

export function dismiss(id: number) {
  state = { ...state, toasts: state.toasts.filter((t) => t.id !== id) };
  emit();
}

export function ask(text: string, opts: { ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const a: Ask = { id: ++seq, text, ok: opts.ok ?? "Да", cancel: opts.cancel ?? "Отмена", danger: !!opts.danger, resolve: (v) => resolve(v === true) };
    if (state.ask) state = { ...state, queue: [...state.queue, a] };
    else state = { ...state, ask: a };
    emit();
  });
}

/** Окно с полями ввода: значения по ключам или null, если нажали «Отмена» */
export function askInput(text: string, fields: Field[], opts: { ok?: string; cancel?: string } = {}): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const a: Ask = { id: ++seq, text, ok: opts.ok ?? "Готово", cancel: opts.cancel ?? "Отмена", danger: false, fields, resolve: (v, values) => resolve(v ? values ?? {} : null) };
    if (state.ask) state = { ...state, queue: [...state.queue, a] };
    else state = { ...state, ask: a };
    emit();
  });
}

/** Вопрос с двумя вариантами и отменой: "ok", "alt" или null — нажали «Отмена»/фон/Esc */
export function choose(text: string, opts: { ok: string; alt: string; cancel?: string }): Promise<"ok" | "alt" | null> {
  return new Promise((resolve) => {
    const a: Ask = { id: ++seq, text, ok: opts.ok, alt: opts.alt, cancel: opts.cancel ?? "Отмена", danger: false, resolve: (v) => resolve(v === true ? "ok" : v === "alt" ? "alt" : null) };
    if (state.ask) state = { ...state, queue: [...state.queue, a] };
    else state = { ...state, ask: a };
    emit();
  });
}

export function answer(v: boolean | "alt", values?: Record<string, string>) {
  if (!state.ask) return;
  state.ask.resolve(v, values);
  const [next, ...rest] = state.queue;
  state = { ...state, ask: next ?? null, queue: rest };
  emit();
}
