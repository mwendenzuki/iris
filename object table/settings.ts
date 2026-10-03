import type { Lang } from "./i18n";

export interface Settings {
  language: Lang;
  height: number;
} // height in cm

const KEY = "iris";

export function loadSettings(): Settings | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      s &&
      (s.language === "en" || s.language === "sw") &&
      s.height >= 100 &&
      s.height <= 220
    )
      return s;
  } catch {
    /* corrupt or unavailable */
  }
  return null;
}

export const saveSettings = (s: Settings) =>
  localStorage.setItem(KEY, JSON.stringify(s));

/** Walking stride (m) from height (cm). */
export const strideM = (h: number) => (0.415 * h) / 100;
/** Approx. phone height at chest level (m). */
export const camHeightM = (h: number) => (0.72 * h) / 100;
