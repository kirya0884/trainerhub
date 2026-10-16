import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Статический сайт: относительные пути — можно положить в любую папку хостинга (REG.RU)
export default defineConfig({ plugins: [react()], base: "./", build: { outDir: "dist", sourcemap: false } });
