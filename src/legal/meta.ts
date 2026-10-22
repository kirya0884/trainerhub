// Лёгкая часть юридических документов: версия и адреса нужны при каждом запуске (журнал
// согласий, страницы #/legal/…), а сами тексты (docs.ts) грузятся, только когда документ открывают.
// При любой правке текста в docs.ts — поднять LEGAL_VERSION.
export const LEGAL_VERSION = "2026-10-22";

export const DOC_SLUGS = ["privacy", "terms", "consent", "consent-client"] as const;
export type DocSlug = (typeof DOC_SLUGS)[number];
