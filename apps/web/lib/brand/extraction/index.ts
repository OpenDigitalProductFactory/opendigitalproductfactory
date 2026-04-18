import type { BrandDesignSystem } from "../types";
import type { ExtractionInput, ExtractionResult, ProgressEmitter } from "./types";

function emptyDesignSystem(): BrandDesignSystem {
  return {
    version: "1.0.0",
    extractedAt: new Date().toISOString(),
    sources: [],
    identity: {
      name: "",
      tagline: null,
      description: null,
      logo: { darkBg: null, lightBg: null, mark: null },
      voice: { tone: "neutral", sampleCopy: [] },
    },
    palette: {
      primary: "#000000",
      secondary: null,
      accents: [],
      semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
      neutrals: {
        50: "#ffffff", 100: "#f9f9f9", 200: "#eeeeee", 300: "#dddddd", 400: "#bbbbbb",
        500: "#888888", 600: "#666666", 700: "#444444", 800: "#222222", 900: "#111111", 950: "#000000",
      },
      surfaces: {
        background: "#ffffff",
        foreground: "#000000",
        muted: "#f5f5f5",
        card: "#ffffff",
        border: "#e5e5e5",
      },
    },
    typography: {
      families: { sans: "Inter", serif: null, mono: "JetBrains Mono", display: null },
      scale: {
        xs: { size: "0.75rem", lineHeight: "1rem", tracking: "0", weight: 400 },
        sm: { size: "0.875rem", lineHeight: "1.25rem", tracking: "0", weight: 400 },
        base: { size: "1rem", lineHeight: "1.5rem", tracking: "0", weight: 400 },
        lg: { size: "1.125rem", lineHeight: "1.75rem", tracking: "0", weight: 400 },
        xl: { size: "1.25rem", lineHeight: "1.75rem", tracking: "0", weight: 500 },
        "2xl": { size: "1.5rem", lineHeight: "2rem", tracking: "0", weight: 600 },
        "3xl": { size: "1.875rem", lineHeight: "2.25rem", tracking: "0", weight: 700 },
        "4xl": { size: "2.25rem", lineHeight: "2.5rem", tracking: "0", weight: 700 },
        "5xl": { size: "3rem", lineHeight: "1", tracking: "0", weight: 700 },
        "6xl": { size: "3.75rem", lineHeight: "1", tracking: "0", weight: 700 },
      },
      pairings: [],
    },
    components: { library: "unknown", inventory: [], patterns: [] },
    tokens: { radii: {}, spacing: {}, shadows: {}, motion: {}, breakpoints: {} },
    confidence: { overall: 0, perField: {} },
    gaps: [],
    overrides: {},
  };
}

export async function extractBrandDesignSystem(
  input: ExtractionInput,
  _emit: ProgressEmitter,
): Promise<ExtractionResult> {
  const start = Date.now();
  const { sources } = input;
  const hasAnySource = Boolean(sources.url || sources.codebasePath || (sources.uploads && sources.uploads.length > 0));

  const designSystem = emptyDesignSystem();
  if (!hasAnySource) {
    designSystem.gaps = ["no sources provided"];
  }

  return {
    designSystem,
    sourcesUsed: [],
    durationMs: Date.now() - start,
  };
}
