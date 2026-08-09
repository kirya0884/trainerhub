import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Регистрируем Service Worker с prompt-обновлением
// (не auto-update — не хотим сбрасывать состояние во время тренировки)
const updateSW = registerSW({
  onNeedRefresh() {
    // Не confirm() — он блокирует мобильный Safari. Висит до клика: если убрать
    // по таймеру, пользователь пропускает её и остаётся на старой версии.
    //
    // B34: классы Tailwind вместо инлайновых стилей — кнопка перестала выбиваться
    // из интерфейса и заодно подхватывает светлую тему (bg-zinc-900 и text-zinc-200
    // переопределены в index.css; дробные вроде bg-zinc-900/95 — нет, поэтому не берём).
    if (document.getElementById("sw-update-btn")) return;
    const btn = document.createElement("button");
    btn.id = "sw-update-btn";
    btn.className = [
      "fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999]",
      "flex items-center gap-2 whitespace-nowrap",
      "bg-zinc-900 border border-zinc-700 rounded-full px-4 py-2",
      "text-xs font-medium text-zinc-200 shadow-lg",
      "hover:border-zinc-500 active:scale-95 transition",
    ].join(" ");

    const dot = document.createElement("span");
    dot.className = "w-1.5 h-1.5 rounded-full bg-lime-400 shrink-0 animate-pulse";
    const label = document.createElement("span");
    label.textContent = "Обновить приложение";
    btn.append(dot, label);

    btn.onclick = () => {
      btn.disabled = true;
      btn.classList.add("opacity-60");
      dot.remove();
      label.textContent = "Обновляем...";
      updateSW(true);
    };
    document.body.appendChild(btn);
  },
  onOfflineReady() {
    console.log("[SW] Reps готов к работе офлайн");
  },
  onRegistered(reg) {
    if (!reg) return;
    // PWA с рабочего экрана живёт без перезагрузок неделями — SW сам не узнаёт об обновлении.
    // Проверяем каждые 15 минут и при каждом возврате в приложение.
    const check = () => reg.update().catch(() => {});
    setInterval(check, 15 * 60_000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  },
});
