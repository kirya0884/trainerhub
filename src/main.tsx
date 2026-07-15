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
    // Лаймовая кнопка вместо confirm() (блокирует мобильный Safari)
    const btn = document.createElement("button");
    btn.textContent = "🔄 Обновить Reps";
    btn.style.cssText = [
      "position:fixed", "bottom:80px", "left:50%", "transform:translateX(-50%)",
      "z-index:9999", "background:#a3e635", "color:#09090b", "font-weight:700",
      "padding:10px 22px", "border:none", "border-radius:12px", "cursor:pointer",
      "font-size:14px", "box-shadow:0 4px 16px #0006", "white-space:nowrap",
    ].join(";");
    btn.onclick = () => updateSW(true);
    document.body.appendChild(btn);
    setTimeout(() => btn.remove(), 15_000);
  },
  onOfflineReady() {
    console.log("[SW] Reps готов к работе офлайн");
  },
});
