import { Suspense, useEffect, useState } from "react";
import { lazyRetry } from "../lib/lazy";
import { DOC_SLUGS, type DocSlug } from "../legal/meta";

// Тексты документов (LegalDoc + legal/docs) тяжёлые и нужны редко — грузятся при открытии,
// а ссылки и адрес страницы, которые нужны на входе и экране согласия, остаются здесь.
const LegalModal = lazyRetry(() => import("./LegalDoc").then((m) => ({ default: m.LegalModal })));

/** Ссылка-кнопка на документ: открывает окно поверх текущего экрана */
export function DocLink({ slug, children, className = "" }: { slug: DocSlug; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* span, а не button: кнопка — блок и рвёт строку текста согласия. preventDefault — чтобы клик
          по ссылке внутри label не ставил галочку */}
      <span role="button" tabIndex={0} onClick={(e) => { e.preventDefault(); setOpen(true); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
        className={`cursor-pointer text-lime-400 hover:text-lime-300 underline underline-offset-2 ${className}`}>{children}</span>
      {open && <Suspense fallback={null}><LegalModal slug={slug} onClose={() => setOpen(false)} /></Suspense>}
    </>
  );
}

/** Адрес публичной страницы #/legal/<slug> — открывается без входа (ссылка для магазинов приложений и сайта) */
export function legalSlugFromHash(hash: string): DocSlug | null {
  const m = hash.match(/^#\/legal\/([a-z-]+)/);
  return m && (DOC_SLUGS as readonly string[]).includes(m[1]) ? (m[1] as DocSlug) : null;
}
export function useLegalRoute() {
  const [slug, setSlug] = useState(() => legalSlugFromHash(location.hash));
  useEffect(() => {
    const on = () => setSlug(legalSlugFromHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // Адрес #/ при старте приложение может переписать само — поэтому «назад» закрывает явно
  const close = () => { setSlug(null); if (location.hash.startsWith("#/legal/")) location.hash = "#/"; };
  return [slug, close] as const;
}
