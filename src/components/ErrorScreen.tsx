import { Component, type ReactNode } from "react";

// Последний рубеж: любая ошибка отрисовки раньше давала белый экран без выхода.
// Теперь — понятный экран и перезагрузка. Введённое в тренировке лежит в черновиках
// и после перезагрузки вернётся.
export default class ErrorScreen extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("[ErrorScreen]", e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-xl font-bold">Что-то пошло не так</p>
        <p className="text-sm text-zinc-400 max-w-xs">Перезагрузи приложение. Данные идущей тренировки сохранены и вернутся.</p>
        <button onClick={() => location.reload()} className="h-12 px-6 rounded-xl bg-lime-400 text-zinc-950 font-bold">Перезагрузить</button>
      </div>
    );
  }
}
