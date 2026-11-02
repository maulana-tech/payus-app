import type { Accent, Theme } from "./config";

// The whole design surface a storefront can reach, as values rather than
// markup. A shop picks a theme and an accent; everything else — the type
// scale, the spacing, the way a card sits on the page — is ours, so every
// shop is well made whoever (or whatever) configured it.

export type Palette = {
  /** The page behind everything. */
  page: string;
  /** A card or panel laid on the page. */
  surface: string;
  text: string;
  /** Secondary copy: descriptions, labels. */
  muted: string;
  line: string;
  /** The accent, used for prices, buttons and the rule under the title. */
  accent: string;
  accentText: string;
  /** For the browser's own UI (form controls, scrollbars). */
  scheme: "light" | "dark";
};

const ACCENT_HUE: Record<Accent, { light: string; dark: string }> = {
  clay: { light: "#9a4a2f", dark: "#e08a66" },
  olive: { light: "#4c5d34", dark: "#a7bd7e" },
  indigo: { light: "#3a3f8f", dark: "#9aa2ef" },
  plum: { light: "#6d2f55", dark: "#dd9ac1" },
  ochre: { light: "#8a6410", dark: "#e0b65a" },
  sea: { light: "#155f66", dark: "#7fc9d0" },
};

const BASE: Record<Theme, Omit<Palette, "accent" | "accentText">> = {
  paper: {
    page: "#f4f1e9",
    surface: "#fffdf8",
    text: "#221f1a",
    muted: "#6c675d",
    line: "#ddd7c9",
    scheme: "light",
  },
  ink: {
    page: "#16150f",
    surface: "#1e1d16",
    text: "#f3f0e6",
    muted: "#a39d8e",
    line: "#332f26",
    scheme: "dark",
  },
  sun: {
    page: "#fdf3e3",
    surface: "#fffaf1",
    text: "#2b1d0e",
    muted: "#7a6246",
    line: "#ecd9bb",
    scheme: "light",
  },
};

export function palette(theme: Theme, accent: Accent): Palette {
  // Fall back rather than throw: this renders a public page, and a row
  // written before a theme existed must still open.
  const base = BASE[theme] ?? BASE.paper;
  const hue = ACCENT_HUE[accent] ?? ACCENT_HUE.clay;
  return {
    ...base,
    accent: base.scheme === "dark" ? hue.dark : hue.light,
    accentText: base.scheme === "dark" ? "#16150f" : "#fffdf8",
  };
}

/** The palette as CSS variables, so the markup carries no colours at all. */
export function paletteVars(
  theme: Theme,
  accent: Accent,
): Record<string, string> {
  const p = palette(theme, accent);
  return {
    "--shop-page": p.page,
    "--shop-surface": p.surface,
    "--shop-text": p.text,
    "--shop-muted": p.muted,
    "--shop-line": p.line,
    "--shop-accent": p.accent,
    "--shop-accent-text": p.accentText,
    colorScheme: p.scheme,
  };
}
