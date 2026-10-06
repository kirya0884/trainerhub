// Цвета для графиков recharts, которым нельзя передать класс Tailwind: читаем токены темы
// из CSS-переменных (index.css). Вызывать при рендере графика — тогда в светлой теме
// сетка, оси и подсказка светлые, а не тёмные, как было с жёсткими hex.
const read = (name: string, fallback: string) => {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v})` : fallback;
};

export const chartColors = () => ({
  grid: read("--line-700", "#3f3f46"),
  axis: read("--ink-500", "#71717a"),
  tooltipBg: read("--bg-900", "#18181b"),
  tooltipBorder: read("--line-700", "#3f3f46"),
  tooltipLabel: read("--ink-400", "#a1a1aa"),
});
