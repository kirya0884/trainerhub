/** @type {import('tailwindcss').Config} */
// Цвета — CSS-переменные (src/index.css): тёмная и светлая тема меняются в одном месте
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ['"Onest Variable"', "system-ui", "sans-serif"] },
      colors: {
        bg: v("bg"), surface: v("surface"), surface2: v("surface2"), line: v("line"),
        ink: v("ink"), ink2: v("ink2"), ink3: v("ink3"), accent: v("accent"), onaccent: v("onaccent"),
        good: v("good"), bad: v("bad"),
      },
    },
  },
};
