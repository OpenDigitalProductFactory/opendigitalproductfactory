import type { BrandDesignSystem } from "../types";
import type { PartialDesignSystem } from "./types";

const IDENTITY_PRIORITY = ["upload", "url", "codebase"] as const;
const LOGO_PRIORITY = ["upload", "url", "codebase"] as const;
const PALETTE_PRIORITY = ["codebase", "upload", "url"] as const;
const TYPOGRAPHY_PRIORITY = ["codebase", "upload", "url"] as const;
const COMPONENTS_PRIORITY = ["codebase", "upload", "url"] as const;

function partialKind(p: PartialDesignSystem): "codebase" | "url" | "upload" | null {
  const src = p.sources?.[0];
  return src ? src.kind : null;
}

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

function pickByPriority<T>(
  partials: PartialDesignSystem[],
  priority: readonly ("codebase" | "url" | "upload")[],
  get: (p: PartialDesignSystem) => T | undefined | null,
): { winner: T | null; agreeingCount: number; winningKind: string | null } {
  let winner: T | null = null;
  let winningKind: string | null = null;
  for (const kind of priority) {
    for (const p of partials) {
      if (partialKind(p) === kind) {
        const v = get(p);
        if (v !== undefined && v !== null) {
          winner = v;
          winningKind = kind;
          break;
        }
      }
    }
    if (winner !== null) break;
  }
  if (winner === null) return { winner: null, agreeingCount: 0, winningKind: null };

  let agreeingCount = 0;
  for (const p of partials) {
    const v = get(p);
    if (v !== undefined && v !== null && JSON.stringify(v) === JSON.stringify(winner)) {
      agreeingCount++;
    }
  }
  return { winner, agreeingCount, winningKind };
}

function confidenceForField(base: number | undefined, agreeingCount: number): number {
  const baseline = base ?? 0.5;
  if (agreeingCount >= 2) return Math.max(baseline, 0.9);
  if (agreeingCount === 1) return baseline;
  return 0;
}

export function merge(partials: PartialDesignSystem[]): BrandDesignSystem {
  const result = emptyDesignSystem();

  const allSources = partials.flatMap((p) => p.sources ?? []);
  result.sources = allSources;

  const allGaps: string[] = [];
  for (const p of partials) {
    if (p.gaps) allGaps.push(...p.gaps);
  }

  if (partials.length === 0) {
    result.gaps = ["no-partials-to-merge"];
    result.confidence = { overall: 0, perField: {} };
    return result;
  }

  const perField: Record<string, number> = {};

  // identity.name
  const nameResult = pickByPriority(partials, IDENTITY_PRIORITY, (p) => p.identity?.name || null);
  if (nameResult.winner) {
    result.identity.name = nameResult.winner;
    const baseConfidence = partials.find(
      (p) => partialKind(p) === nameResult.winningKind,
    )?.confidence?.perField?.["identity.name"];
    perField["identity.name"] = confidenceForField(baseConfidence, nameResult.agreeingCount);
  }

  // identity.description
  const descResult = pickByPriority(partials, IDENTITY_PRIORITY, (p) => p.identity?.description);
  if (descResult.winner) {
    result.identity.description = descResult.winner;
    const baseConfidence = partials.find(
      (p) => partialKind(p) === descResult.winningKind,
    )?.confidence?.perField?.["identity.description"];
    perField["identity.description"] = confidenceForField(baseConfidence, descResult.agreeingCount);
  }

  // identity.logo.mark
  const markResult = pickByPriority(partials, LOGO_PRIORITY, (p) => p.identity?.logo?.mark);
  if (markResult.winner) {
    result.identity.logo.mark = markResult.winner;
    const baseConfidence = partials.find(
      (p) => partialKind(p) === markResult.winningKind,
    )?.confidence?.perField?.["identity.logo.mark"];
    perField["identity.logo.mark"] = confidenceForField(baseConfidence, markResult.agreeingCount);
  }

  // palette.primary
  const primaryResult = pickByPriority(partials, PALETTE_PRIORITY, (p) => p.palette?.primary);
  if (primaryResult.winner) {
    result.palette.primary = primaryResult.winner;
    const baseConfidence = partials.find(
      (p) => partialKind(p) === primaryResult.winningKind,
    )?.confidence?.perField?.["palette.primary"];
    perField["palette.primary"] = confidenceForField(baseConfidence, primaryResult.agreeingCount);
  }

  // palette full (take the winning partial's full palette shape)
  if (primaryResult.winningKind) {
    const winningPartial = partials.find(
      (p) => partialKind(p) === primaryResult.winningKind && p.palette?.primary === primaryResult.winner,
    );
    if (winningPartial?.palette) {
      result.palette = { ...result.palette, ...winningPartial.palette };
    }
  }

  // typography.families.sans
  const sansResult = pickByPriority(partials, TYPOGRAPHY_PRIORITY, (p) => p.typography?.families?.sans);
  if (sansResult.winner) {
    result.typography.families.sans = sansResult.winner;
    const baseConfidence = partials.find(
      (p) => partialKind(p) === sansResult.winningKind,
    )?.confidence?.perField?.["typography.families.sans"];
    perField["typography.families.sans"] = confidenceForField(baseConfidence, sansResult.agreeingCount);

    const winningPartial = partials.find(
      (p) => partialKind(p) === sansResult.winningKind && p.typography?.families?.sans === sansResult.winner,
    );
    if (winningPartial?.typography) {
      result.typography = { ...result.typography, ...winningPartial.typography };
    }
  }

  // components
  const componentsResult = pickByPriority(partials, COMPONENTS_PRIORITY, (p) =>
    p.components?.inventory && p.components.inventory.length > 0 ? p.components : null,
  );
  if (componentsResult.winner) {
    result.components = componentsResult.winner;
    perField["components.inventory"] = confidenceForField(
      partials.find((p) => partialKind(p) === componentsResult.winningKind)
        ?.confidence?.perField?.["components.inventory"],
      componentsResult.agreeingCount,
    );
  }

  const fieldCount = Object.keys(perField).length;
  const sumConfidence = Object.values(perField).reduce((a, b) => a + b, 0);
  const overall = fieldCount === 0 ? 0 : sumConfidence / fieldCount;

  result.confidence = { overall, perField };
  result.gaps = allGaps;

  return result;
}
