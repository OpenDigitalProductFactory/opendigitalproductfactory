import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { PartialDesignSystem } from "./types";
import type { ComponentCatalogEntry } from "../types";

function safeRead(path: string): string | null {
  try {
    return readFileSync(/* turbopackIgnore: true */ path, "utf-8");
  } catch {
    return null;
  }
}

function parseTailwindColors(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const colorsMatch = source.match(/colors\s*:\s*\{([^}]*)\}/s);
  if (!colorsMatch) return result;
  const inner = colorsMatch[1];
  const pairs = inner.matchAll(/(\w+)\s*:\s*["']([#a-fA-F0-9\d,().\s]+)["']/g);
  for (const m of pairs) {
    result[m[1]] = m[2].trim();
  }
  return result;
}

function parseTailwindFontFamily(source: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const match = source.match(/fontFamily\s*:\s*\{([^}]*)\}/s);
  if (!match) return result;
  const inner = match[1];
  const pairs = inner.matchAll(/(\w+)\s*:\s*\[([^\]]+)\]/g);
  for (const m of pairs) {
    const families = m[2]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    result[m[1]] = families;
  }
  return result;
}

function parseCssRootVars(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const rootMatch = source.match(/:root\s*\{([^}]*)\}/s);
  if (!rootMatch) return result;
  const pairs = rootMatch[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g);
  for (const m of pairs) {
    result[m[1]] = m[2].trim();
  }
  return result;
}

function tryFindTailwindConfig(root: string): string | null {
  for (const name of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]) {
    const p = join(/* turbopackIgnore: true */ root, name);
    if (existsSync(/* turbopackIgnore: true */ p)) return p;
  }
  return null;
}

function tryFindGlobalsCss(root: string): string | null {
  for (const rel of ["app/globals.css", "styles/globals.css", "src/app/globals.css"]) {
    const p = join(/* turbopackIgnore: true */ root, rel);
    if (existsSync(/* turbopackIgnore: true */ p)) return p;
  }
  return null;
}

function listShadcnComponents(root: string): ComponentCatalogEntry[] {
  const componentsDir = join(/* turbopackIgnore: true */ root, "components", "ui");
  if (!existsSync(/* turbopackIgnore: true */ componentsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(/* turbopackIgnore: true */ componentsDir);
  } catch {
    return [];
  }
  const inventory: ComponentCatalogEntry[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".tsx") && !entry.endsWith(".ts")) continue;
    const name = entry.replace(/\.(tsx|ts)$/, "");
    inventory.push({
      name,
      variants: [],
      anchorFile: join("components", "ui", entry).replace(/\\/g, "/"),
      tokens: {},
    });
  }
  return inventory;
}

export async function codebaseAdapter(rootPath: string): Promise<PartialDesignSystem> {
  const gaps: string[] = [];
  const perField: Record<string, number> = {};

  if (!rootPath) {
    return {
      sources: [],
      gaps: ["no-codebase-path"],
      confidence: { overall: 0, perField: {} },
    };
  }

  if (!existsSync(/* turbopackIgnore: true */ rootPath)) {
    return {
      sources: [],
      gaps: ["codebase-path-missing"],
      confidence: { overall: 0, perField: {} },
    };
  }

  try {
    if (!statSync(/* turbopackIgnore: true */ rootPath).isDirectory()) {
      return {
        sources: [],
        gaps: ["codebase-path-not-directory"],
        confidence: { overall: 0, perField: {} },
      };
    }
  } catch {
    return {
      sources: [],
      gaps: ["codebase-path-unreadable"],
      confidence: { overall: 0, perField: {} },
    };
  }

  const partial: PartialDesignSystem = {
    sources: [{ kind: "codebase", ref: rootPath, capturedAt: new Date().toISOString() }],
  };

  const tailwindPath = tryFindTailwindConfig(rootPath);
  const tailwindColors: Record<string, string> = {};
  const tailwindFonts: Record<string, string[]> = {};
  if (tailwindPath) {
    const contents = safeRead(tailwindPath);
    if (contents) {
      Object.assign(tailwindColors, parseTailwindColors(contents));
      Object.assign(tailwindFonts, parseTailwindFontFamily(contents));
    }
  } else {
    gaps.push("no-tailwind-config");
  }

  const cssPath = tryFindGlobalsCss(rootPath);
  const cssVars: Record<string, string> = {};
  if (cssPath) {
    const contents = safeRead(cssPath);
    if (contents) {
      Object.assign(cssVars, parseCssRootVars(contents));
    }
  } else {
    gaps.push("no-globals-css");
  }

  const primary = tailwindColors.primary ?? tailwindColors.accent ?? null;
  const accent = tailwindColors.accent ?? null;
  if (primary) {
    partial.palette = {
      primary,
      secondary: tailwindColors.secondary ?? null,
      accents: accent ? [accent] : [],
      semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
      neutrals: {
        50: "#ffffff", 100: "#f9f9f9", 200: "#eeeeee", 300: "#dddddd", 400: "#bbbbbb",
        500: "#888888", 600: "#666666", 700: "#444444", 800: "#222222", 900: "#111111", 950: "#000000",
      },
      surfaces: {
        background: cssVars["color-background"] ?? "#ffffff",
        foreground: cssVars["color-foreground"] ?? "#000000",
        muted: "#f5f5f5",
        card: "#ffffff",
        border: "#e5e5e5",
      },
    };
    perField["palette.primary"] = 0.8;
  } else {
    gaps.push("no-primary-color");
  }

  const sansFamily = tailwindFonts.sans;
  const monoFamily = tailwindFonts.mono;
  if (sansFamily && sansFamily.length > 0) {
    partial.typography = {
      families: {
        sans: sansFamily[0],
        serif: tailwindFonts.serif?.[0] ?? null,
        mono: monoFamily?.[0] ?? "JetBrains Mono",
        display: tailwindFonts.display?.[0] ?? null,
      },
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
    };
    perField["typography.families.sans"] = 0.8;
  } else {
    gaps.push("no-font-family");
  }

  const inventory = listShadcnComponents(rootPath);
  partial.components = {
    library: inventory.length > 0 ? "shadcn" : "unknown",
    inventory,
    patterns: [],
  };
  if (inventory.length > 0) {
    perField["components.inventory"] = 0.8;
  } else {
    gaps.push("no-component-library");
  }

  const populatedFields = Object.keys(perField).length;
  const overall = populatedFields === 0 ? 0 : Math.min(0.85, populatedFields * 0.3);

  return {
    ...partial,
    gaps,
    confidence: { overall, perField },
  };
}
