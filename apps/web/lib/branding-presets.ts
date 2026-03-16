export type ThemeTokens = {
  version: string;
  palette: {
    bg: string; surface1: string; surface2: string;
    accent: string; muted: string; border: string;
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
    palette: { bg, surface1, surface2, accent, muted, border },
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
