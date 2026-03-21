export type ThemeTokens = {
  version: string;
  palette: {
    bg: string; surface1: string; surface2: string;
    accent: string; muted: string; border: string;
    text: string;  // NEW
  };
  typography: { fontFamily: string; headingFontFamily: string };
  spacing: { xs: string; sm: string; md: string; lg: string; xl: string };
  radius: { sm: string; md: string; lg: string; xl: string };
  surfaces: { page: string; panel: string; card: string; sidebar: string; modal: string };
  states: {
    idle: string; hover: string; active: string; focus: string;
    success: string; warning: string; error: string; info: string;
  };
  shadows: { panel: string; card: string; button: string };
};

export type DualThemeTokens = {
  dark: ThemeTokens;
  light: ThemeTokens;
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map(v => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function mixWithDark(accent: string, darkBase: string, ratio: number): string {
  const [ar, ag, ab] = hexToRgb(accent);
  const [dr, dg, db] = hexToRgb(darkBase);
  return rgbToHex(dr + (ar - dr) * ratio, dg + (ag - dg) * ratio, db + (ab - db) * ratio);
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100, ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = ln - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color)));
  };
  return rgbToHex(f(0), f(8), f(4));
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(color1: string, color2: string): number {
  const l1 = relativeLuminance(color1);
  const l2 = relativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Nudge a foreground color's HSL lightness until it meets the required
 * contrast ratio against the given background. Darkens for light backgrounds,
 * lightens for dark backgrounds. Max 30 iterations at 3% steps.
 */
function ensureContrast(fg: string, bg: string, minRatio: number): string {
  const bgHsl = hexToHsl(bg);
  const isLightBg = bgHsl.l > 50;
  const fgHsl = hexToHsl(fg);
  const originalL = fgHsl.l;
  let { h, s, l } = fgHsl;

  for (let i = 0; i < 30; i++) {
    const candidate = hslToHex(h, s, l);
    if (contrastRatio(candidate, bg) >= minRatio) {
      if (
        typeof process !== "undefined" &&
        process.env?.NODE_ENV === "development" &&
        Math.abs(l - originalL) > 10
      ) {
        console.warn(
          `ensureContrast: nudged lightness by ${Math.abs(l - originalL).toFixed(1)}% ` +
          `(${originalL.toFixed(1)} → ${l.toFixed(1)}) for ${fg} against ${bg}`
        );
      }
      return candidate;
    }
    // Darken for light backgrounds, lighten for dark backgrounds
    l += isLightBg ? -3 : 3;
    l = Math.max(0, Math.min(100, l));
  }

  // Return best effort after max iterations
  return hslToHex(h, s, l);
}

export type Correction = {
  mode: "light" | "dark";
  foreground: string;
  background: string;
  original: string;
  corrected: string;
  originalRatio: number;
  correctedRatio: number;
};

type ContrastCheck = {
  fgPath: string;
  bgPath: string;
  getFg: (t: ThemeTokens) => string;
  getBg: (t: ThemeTokens) => string;
  setFg: (t: ThemeTokens, v: string) => void;
  minRatio: number;
};

function makeChecks(): ContrastCheck[] {
  const text45 = (bgPath: string, getBg: (t: ThemeTokens) => string): ContrastCheck => ({
    fgPath: "palette.text", bgPath, minRatio: 4.5,
    getFg: t => t.palette.text, getBg,
    setFg: (t, v) => { t.palette.text = v; },
  });

  return [
    text45("palette.bg", t => t.palette.bg),
    text45("palette.surface1", t => t.palette.surface1),
    text45("palette.surface2", t => t.palette.surface2),
    text45("surfaces.panel", t => t.surfaces.panel),
    text45("surfaces.card", t => t.surfaces.card),
    text45("surfaces.sidebar", t => t.surfaces.sidebar),
    text45("surfaces.modal", t => t.surfaces.modal),
    { fgPath: "palette.muted", bgPath: "palette.bg", minRatio: 4.5,
      getFg: t => t.palette.muted, getBg: t => t.palette.bg,
      setFg: (t, v) => { t.palette.muted = v; } },
    { fgPath: "palette.muted", bgPath: "palette.surface1", minRatio: 4.5,
      getFg: t => t.palette.muted, getBg: t => t.palette.surface1,
      setFg: (t, v) => { t.palette.muted = v; } },
    { fgPath: "palette.accent", bgPath: "palette.bg", minRatio: 4.5,
      getFg: t => t.palette.accent, getBg: t => t.palette.bg,
      setFg: (t, v) => { t.palette.accent = v; } },
    { fgPath: "palette.accent", bgPath: "palette.surface1", minRatio: 3,
      getFg: t => t.palette.accent, getBg: t => t.palette.surface1,
      setFg: (t, v) => { t.palette.accent = v; } },
    { fgPath: "palette.border", bgPath: "palette.bg", minRatio: 3,
      getFg: t => t.palette.border, getBg: t => t.palette.bg,
      setFg: (t, v) => { t.palette.border = v; } },
    { fgPath: "palette.border", bgPath: "palette.surface1", minRatio: 3,
      getFg: t => t.palette.border, getBg: t => t.palette.surface1,
      setFg: (t, v) => { t.palette.border = v; } },
    { fgPath: "states.focus", bgPath: "palette.bg", minRatio: 3,
      getFg: t => t.states.focus, getBg: t => t.palette.bg,
      setFg: (t, v) => { t.states.focus = v; } },
    { fgPath: "states.focus", bgPath: "palette.surface1", minRatio: 3,
      getFg: t => t.states.focus, getBg: t => t.palette.surface1,
      setFg: (t, v) => { t.states.focus = v; } },
    ...["success", "warning", "error", "info"].map((key): ContrastCheck => ({
      fgPath: `states.${key}`, bgPath: "palette.bg", minRatio: 3,
      getFg: t => t.states[key as keyof typeof t.states],
      getBg: t => t.palette.bg,
      setFg: (t, v) => { (t.states as Record<string, string>)[key] = v; },
    })),
  ];
}

const CONTRAST_CHECKS = makeChecks();

export function validateTokenContrast(
  tokens: ThemeTokens,
  mode: "light" | "dark" = "light",
): {
  correctedTokens: ThemeTokens;
  corrections: Correction[];
} {
  const corrected: ThemeTokens = JSON.parse(JSON.stringify(tokens));
  const corrections: Correction[] = [];

  for (const check of CONTRAST_CHECKS) {
    const fg = check.getFg(corrected);
    const bg = check.getBg(corrected);
    if (!fg || !bg || !/^#[0-9a-fA-F]{6}$/.test(fg) || !/^#[0-9a-fA-F]{6}$/.test(bg)) continue;

    const ratio = contrastRatio(fg, bg);
    if (ratio >= check.minRatio) continue;

    const fixed = ensureContrast(fg, bg, check.minRatio);
    const fixedRatio = contrastRatio(fixed, bg);
    check.setFg(corrected, fixed);
    corrections.push({
      mode,
      foreground: check.fgPath,
      background: check.bgPath,
      original: fg,
      corrected: fixed,
      originalRatio: Math.round(ratio * 100) / 100,
      correctedRatio: Math.round(fixedRatio * 100) / 100,
    });
  }

  return { correctedTokens: corrected, corrections };
}

type DeriveOptions = { fontFamily?: string; headingFontFamily?: string };

function deriveDarkTokens(accent: string, opts?: DeriveOptions): ThemeTokens {
  const darkBase = "#0a0a1a";
  const bg = mixWithDark(accent, darkBase, 0.03);
  const surface1 = mixWithDark(accent, darkBase, 0.07);
  const surface2 = mixWithDark(accent, darkBase, 0.05);
  const muted = ensureContrast(lighten(accent, 0.4), bg, 4.5);
  const border = ensureContrast(mixWithDark(accent, "#1a1a2e", 0.2), bg, 3);
  const text = ensureContrast("#e2e2f0", bg, 4.5);
  const accentAdj = ensureContrast(accent, bg, 4.5);

  const font = opts?.fontFamily ?? "Inter, system-ui, sans-serif";
  const headingFont = opts?.headingFontFamily ?? font;

  return {
    version: "1.0.0",
    palette: { bg, surface1, surface2, accent: accentAdj, muted, border, text },
    typography: { fontFamily: font, headingFontFamily: headingFont },
    spacing: { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px" },
    radius: { sm: "6px", md: "10px", lg: "14px", xl: "18px" },
    surfaces: { page: bg, panel: surface1, card: surface2, sidebar: surface1, modal: surface2 },
    states: {
      idle: accent, hover: lighten(accent, 0.25), active: darken(accent, 0.15),
      focus: lighten(accent, 0.35), success: "#4ade80", warning: "#fbbf24",
      error: "#f87171", info: "#38bdf8",
    },
    shadows: {
      panel: "0 18px 48px rgba(0, 0, 0, 0.45)",
      card: "0 12px 24px rgba(0, 0, 0, 0.35)",
      button: "0 6px 12px rgba(0, 0, 0, 0.28)",
    },
  };
}

export function deriveLightTokens(accent: string, opts?: DeriveOptions): ThemeTokens {
  const bg = "#fafafa";
  const surface1 = "#ffffff";
  const surface2 = "#f4f4f6";
  const text = "#1a1a2e";
  const border = ensureContrast("#d4d4dc", bg, 3);
  const muted = ensureContrast("#6b7280", bg, 4.5);
  const accentAdj = ensureContrast(accent, bg, 4.5);

  const font = opts?.fontFamily ?? "Inter, system-ui, sans-serif";
  const headingFont = opts?.headingFontFamily ?? font;

  return {
    version: "1.0.0",
    palette: { bg, surface1, surface2, accent: accentAdj, muted, border, text },
    typography: { fontFamily: font, headingFontFamily: headingFont },
    spacing: { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px" },
    radius: { sm: "6px", md: "10px", lg: "14px", xl: "18px" },
    surfaces: { page: bg, panel: surface1, card: surface2, sidebar: surface1, modal: surface2 },
    states: {
      idle: accentAdj, hover: darken(accentAdj, 0.10), active: darken(accentAdj, 0.20),
      focus: lighten(accentAdj, 0.15), success: "#16a34a", warning: "#d97706",
      error: "#dc2626", info: "#2563eb",
    },
    shadows: {
      panel: "0 18px 48px rgba(0, 0, 0, 0.10)",
      card: "0 12px 24px rgba(0, 0, 0, 0.08)",
      button: "0 6px 12px rgba(0, 0, 0, 0.06)",
    },
  };
}

export function deriveThemeTokens(accent: string, opts?: DeriveOptions): DualThemeTokens {
  return {
    dark: deriveDarkTokens(accent, opts),
    light: deriveLightTokens(accent, opts),
  };
}

type PresetRow = {
  id: string; scope: string; label: string; tokens: DualThemeTokens;
};

function makePreset(slug: string, name: string, accent: string, font?: string): PresetRow {
  const scope = `theme-preset:${slug}`;
  return {
    id: scope, scope, label: name,
    tokens: deriveThemeTokens(accent, font ? { fontFamily: font } : undefined),
  };
}

export const OOTB_PRESETS: PresetRow[] = [
  makePreset("corporate-blue", "Corporate Blue", "#2563eb", "Inter, system-ui, sans-serif"),
  makePreset("warm-earth", "Warm Earth", "#d97706", "Source Sans 3, Arial, sans-serif"),
  makePreset("modern-dark", "Modern Dark", "#8b5cf6", "Space Grotesk, system-ui, sans-serif"),
  makePreset("clean-minimal", "Clean Minimal", "#6b7280", "Inter, system-ui, sans-serif"),
  makePreset("ocean-teal", "Ocean Teal", "#0d9488", "Lato, Arial, sans-serif"),
  makePreset("forest-green", "Forest Green", "#16a34a", "Nunito, Arial, sans-serif"),
];
