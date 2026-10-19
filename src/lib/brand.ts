// Бренд «Сет» (2026-10-20): акцент — вольт #C6FF3D вместо лайма #A3E635.
// Старый лайм остаётся в базе у тренеров и подопечных, которые его не меняли (это было значение
// по умолчанию) — при чтении поднимаем его до нового цвета, данные не трогаем.
export const BRAND_ACCENT = "#c6ff3d";
const LEGACY_LIME = "#a3e635";
export const upgradeLime = (c: string | null | undefined) => (c && c.toLowerCase() === LEGACY_LIME ? BRAND_ACCENT : c || "");
