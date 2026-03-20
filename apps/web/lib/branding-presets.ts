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

type DeriveOptions = { fontFamily?: string; headingFontFamily?: string };

export function deriveThemeTokens(accent: string, opts?: DeriveOptions): ThemeTokens {
  const darkBase = "#0a0a1a";
  const bg = mixWithDark(accent, darkBase, 0.03);
  const surface1 = mixWithDark(accent, darkBase, 0.07);
  const surface2 = mixWithDark(accent, darkBase, 0.05);
  const muted = lighten(accent, 0.4);
  const border = mixWithDark(accent, "#1a1a2e", 0.2);

  const font = opts?.fontFamily ?? "Inter, system-ui, sans-serif";
  const headingFont = opts?.headingFontFamily ?? font;

  return {
    version: "1.0.0",
    palette: { bg, surface1, surface2, accent, muted, border, text: "#e2e2f0" },
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

type PresetRow = {
  id: string; scope: string; companyName: string; logoUrl: string; tokens: ThemeTokens;
};

const DPF_LOGO = "/logos/open-digital-product-factory-logo.svg";

function makePreset(slug: string, name: string, accent: string, font?: string): PresetRow {
  const scope = `theme-preset:${slug}`;
  return {
    id: scope, scope, companyName: name, logoUrl: DPF_LOGO,
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
