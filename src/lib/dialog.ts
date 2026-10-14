// Свои сообщения и подтверждения вместо alert/confirm. Системные окна браузера на телефоне
// показывают адрес сайта, выбиваются из дизайна и блокируют страницу (в Safari — особенно).
// notify() — короткое сообщение сверху, само исчезает; ask() — окно подтверждения,
// возвращает Promise<boolean>. Рисует их DialogHost (подключён в main.tsx).

export type Toast = { id: number; text: string; kind: "info" | "error" };
export type Ask = { id: number; text: string; ok: string; cancel: string; danger: boolean; resolve: (v: boolean) => void };
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
const looksLikeError = (t: string) => /не удалось|ошибк|не получилось|проверьте интернет/i.test(t);

export function notify(text: string, kind?: Toast["kind"]) {
  const t: Toast = { id: ++seq, text, kind: kind ?? (looksLikeError(text) ? "error" : "info") };
  state = { ...state, toasts: [...state.toasts.slice(-2), t] };
  emit();
  // Длинный текст висит дольше: ~4 с плюс время на чтение
  setTimeout(() => dismiss(t.id), Math.min(12000, 3500 + text.length * 40));
}

export function dismiss(id: number) {
  state = { ...state, toasts: state.toasts.filter((t) => t.id !== id) };
  emit();
}

export function ask(text: string, opts: { ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const a: Ask = { id: ++seq, text, ok: opts.ok ?? "Да", cancel: opts.cancel ?? "Отмена", danger: !!opts.danger, resolve };
    if (state.ask) state = { ...state, queue: [...state.queue, a] };
    else state = { ...state, ask: a };
    emit();
  });
}

export function answer(v: boolean) {
  if (!state.ask) return;
  state.ask.resolve(v);
  const [next, ...rest] = state.queue;
  state = { ...state, ask: next ?? null, queue: rest };
  emit();
}
