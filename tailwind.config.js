/** @type {import('tailwindcss').Config} */
export default {
  // Р6: без этого Tailwind генерирует hover: без @media (hover: hover), и мобильные
  // браузеры держат :hover после тапа до следующего касания — кнопка «залипала»
  // подсвеченной. Одна строка чинит все 363 использования hover: разом.
  future: { hoverOnlyWhenSupported: true },
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
