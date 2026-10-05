/** @type {import('tailwindcss').Config} */

// Цвета берутся из CSS-переменных (src/index.css), а не из палитры Tailwind.
// Так светлая тема и акцент тренера работают для ВСЕХ вариантов класса — с прозрачностью
// (bg-zinc-800/40), hover:, focus:, ring- — без ручных !important-переопределений,
// которые раньше покрывали только часть комбинаций.
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
// Фон, текст и рамки — три отдельных набора: в светлой теме у одного оттенка
// разный смысл (bg-zinc-800 — светлая заливка поля, text-zinc-800 — тёмный текст).
const family = (name) =>
  Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));
// Акцент — произвольный hex из профиля тренера или клиента, поэтому через color-mix:
// --accent переопределяется на контейнерах (портал клиента, сессия клиента), и цвет
// пересчитывается прямо на месте, без разбора hex в каналы.
// Процент считаем здесь, а не через calc() внутри color-mix — его не понимают старые Safari.
const withAlpha = (color) => ({ opacityValue }) => {
  const a = Number(opacityValue);
  if (opacityValue === undefined || a === 1) return color;
  return `color-mix(in srgb, ${color} ${Number.isNaN(a) ? `calc(${opacityValue} * 100%)` : `${Math.round(a * 1000) / 10}%`}, transparent)`;
};
const ACCENT = "var(--accent)";
const ACCENT_HI = "color-mix(in srgb, var(--accent) 82%, white)";
// Текст акцентом: в светлой теме затемняем (--accent-ink), иначе лайм на белом даёт 1.5:1
const ACCENT_INK = "color-mix(in srgb, var(--accent) var(--accent-ink), black)";
const ACCENT_INK_HI = `color-mix(in srgb, ${ACCENT_INK} 80%, white)`;

export default {
  // Р6: без этого Tailwind генерирует hover: без @media (hover: hover), и мобильные
  // браузеры держат :hover после тапа до следующего касания — кнопка «залипала»
  // подсвеченной. Одна строка чинит все 363 использования hover: разом.
  future: { hoverOnlyWhenSupported: true },
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // Классы bg-opacity-* и т.п. в проекте не используются (прозрачность пишется как /40).
  // Без них сплошной цвет генерируется без --tw-*-opacity и calc().
  corePlugins: {
    backgroundOpacity: false, textOpacity: false, borderOpacity: false,
    divideOpacity: false, placeholderOpacity: false, ringOpacity: false,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Onest Variable"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        zinc: family("bg"),
        lime: { 300: withAlpha(ACCENT_HI), 400: withAlpha(ACCENT) },
      },
      textColor: {
        zinc: family("ink"),
        lime: { 300: withAlpha(ACCENT_INK_HI), 400: withAlpha(ACCENT_INK) },
      },
      placeholderColor: { zinc: family("ink") },
      borderColor: { zinc: family("line") },
      divideColor: { zinc: family("line") },
      ringColor: { zinc: family("line") },
    },
  },
  plugins: [],
};
