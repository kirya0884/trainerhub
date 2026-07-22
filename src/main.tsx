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
    // Лаймовая кнопка вместо confirm() (блокирует мобильный Safari).
    // Висит до клика — иначе пользователь пропускает её и сидит на старой версии.
    if (document.getElementById("sw-update-btn")) return;
    const btn = document.createElement("button");
    btn.id = "sw-update-btn";
    btn.textContent = "🔄 Доступно обновление — перезайти";
    btn.style.cssText = [
      "position:fixed", "bottom:80px", "left:50%", "transform:translateX(-50%)",
      "z-index:9999", "background:#a3e635", "color:#09090b", "font-weight:700",
      "padding:10px 22px", "border:none", "border-radius:12px", "cursor:pointer",
      "font-size:14px", "box-shadow:0 4px 16px #0006", "white-space:nowrap",
    ].join(";");
    btn.onclick = () => { btn.disabled = true; btn.textContent = "Обновляем..."; updateSW(true); };
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
