# EP-UX-001: Light Mode UX Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add light mode support driven by OS `prefers-color-scheme`, with WCAG AA contrast enforcement, dual palette derivation, and an accessibility policy.

**Architecture:** Extend `deriveThemeTokens()` to produce both dark and light token sets. `buildBrandingStyleTag()` emits light tokens as `:root` default and dark tokens under `@media (prefers-color-scheme: dark)`. Contrast validation at save time guarantees WCAG AA. Hardcoded hex colors in components remediated to use CSS variables.

**Tech Stack:** TypeScript, Vitest, Next.js 16, Tailwind CSS 3.4, Prisma, CSS Media Queries Level 5

**Spec:** `docs/superpowers/specs/2026-03-19-light-mode-ux-theme-design.md`

---

### Task 1: Add `text` to ThemeTokens palette and add contrast utilities

**Files:**
- Modify: `apps/web/lib/branding-presets.ts`
- Modify: `apps/web/lib/branding-presets.test.ts`

- [ ] **Step 1: Write failing tests for contrast utilities and `text` field**

Add to `apps/web/lib/branding-presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  deriveThemeTokens,
  OOTB_PRESETS,
  contrastRatio,
  hexToHsl,
  hslToHex,
} from "./branding-presets";

describe("contrastRatio", () => {
  it("returns 21 for black on white", () => {
    const ratio = contrastRatio("#000000", "#ffffff");
    expect(ratio).toBeCloseTo(21, 0);
  });

  it("returns 1 for white on white", () => {
    const ratio = contrastRatio("#ffffff", "#ffffff");
    expect(ratio).toBeCloseTo(1, 1);
  });

  it("returns correct ratio for known pair", () => {
    // #767676 on white = ~4.54:1 (WCAG AA threshold)
    const ratio = contrastRatio("#767676", "#ffffff");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("hexToHsl / hslToHex", () => {
  it("round-trips pure red", () => {
    const hsl = hexToHsl("#ff0000");
    expect(hsl.h).toBeCloseTo(0, 0);
    expect(hsl.s).toBeCloseTo(100, 0);
    expect(hsl.l).toBeCloseTo(50, 0);
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe("#ff0000");
  });

  it("round-trips a mid-tone blue within 1 channel tolerance", () => {
    const hex = "#2563eb";
    const hsl = hexToHsl(hex);
    const result = hslToHex(hsl.h, hsl.s, hsl.l);
    // Allow ±1 per channel due to float rounding in HSL conversion
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    const [r1, g1, b1] = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
    const [r2, g2, b2] = [parseInt(result.slice(1,3),16), parseInt(result.slice(3,5),16), parseInt(result.slice(5,7),16)];
    expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(1);
    expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(1);
    expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/branding-presets.test.ts`
Expected: FAIL — `contrastRatio`, `hexToHsl`, `hslToHex` are not exported

- [ ] **Step 3: Implement contrast utilities and HSL helpers**

In `apps/web/lib/branding-presets.ts`, add these exports before `deriveThemeTokens`:

```ts
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
```

Also add `text` to the `ThemeTokens.palette` type:

```ts
export type ThemeTokens = {
  version: string;
  palette: {
    bg: string; surface1: string; surface2: string;
    accent: string; muted: string; border: string;
    text: string;  // NEW
  };
  // ... rest unchanged
};
```

And set `text` in `deriveThemeTokens()` return:

```ts
palette: { bg, surface1, surface2, accent, muted, border, text: "#e2e2f0" },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/branding-presets.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/branding-presets.ts apps/web/lib/branding-presets.test.ts
git commit -m "feat(branding): add contrastRatio, HSL utilities, and text palette token"
```

---

### Task 2: Implement dual palette derivation (`DualThemeTokens`)

**Files:**
- Modify: `apps/web/lib/branding-presets.ts`
- Modify: `apps/web/lib/branding-presets.test.ts`

- [ ] **Step 1: Write failing tests for dual token derivation**

Add to `apps/web/lib/branding-presets.test.ts`:

```ts
describe("deriveThemeTokens (dual)", () => {
  it("returns an object with dark and light keys", () => {
    const tokens = deriveThemeTokens("#2563eb");
    expect(tokens).toHaveProperty("dark");
    expect(tokens).toHaveProperty("light");
  });

  it("dark palette has dark background, light text", () => {
    const { dark } = deriveThemeTokens("#2563eb");
    // Dark bg should be low luminance
    const bgHsl = hexToHsl(dark.palette.bg);
    expect(bgHsl.l).toBeLessThan(20);
    expect(dark.palette.text).toBe("#e2e2f0");
  });

  it("light palette has light background, dark text", () => {
    const { light } = deriveThemeTokens("#2563eb");
    expect(light.palette.bg).toBe("#fafafa");
    expect(light.palette.surface1).toBe("#ffffff");
    expect(light.palette.text).toBe("#1a1a2e");
  });

  it("light palette shadows have lower opacity than dark", () => {
    const { dark, light } = deriveThemeTokens("#2563eb");
    // Extract opacity from shadow string
    const getOpacity = (s: string) => parseFloat(s.match(/[\d.]+\)$/)?.[0] ?? "0");
    expect(getOpacity(light.shadows.panel)).toBeLessThan(getOpacity(dark.shadows.panel));
  });

  it("preserves accent hue between modes", () => {
    const { dark, light } = deriveThemeTokens("#2563eb");
    const darkHsl = hexToHsl(dark.palette.accent);
    const lightHsl = hexToHsl(light.palette.accent);
    // Hue should be within 5 degrees
    expect(Math.abs(darkHsl.h - lightHsl.h)).toBeLessThan(5);
  });

  it("all 6 OOTB presets produce valid dual tokens", () => {
    for (const preset of OOTB_PRESETS) {
      expect(preset.tokens).toHaveProperty("dark");
      expect(preset.tokens).toHaveProperty("light");
      const { dark, light } = preset.tokens as { dark: any; light: any };
      expect(dark.palette.bg).toBeTruthy();
      expect(light.palette.bg).toBe("#fafafa");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/branding-presets.test.ts`
Expected: FAIL — `deriveThemeTokens` returns flat `ThemeTokens`, not `DualThemeTokens`

- [ ] **Step 3: Implement dual palette derivation**

Refactor `deriveThemeTokens()` in `apps/web/lib/branding-presets.ts`. Rename the existing function body to `deriveDarkTokens()` (internal), then add `deriveLightTokens()`, and make `deriveThemeTokens()` return both:

```ts
export type DualThemeTokens = {
  dark: ThemeTokens;
  light: ThemeTokens;
};

function deriveDarkTokens(accent: string, opts?: DeriveOptions): ThemeTokens {
  // Existing logic, plus contrast validation on text/muted
  const darkBase = "#0a0a1a";
  const bg = mixWithDark(accent, darkBase, 0.03);
  const surface1 = mixWithDark(accent, darkBase, 0.07);
  const surface2 = mixWithDark(accent, darkBase, 0.05);
  const muted = ensureContrast(lighten(accent, 0.4), bg, 4.5);
  const border = mixWithDark(accent, "#1a1a2e", 0.2);
  const text = ensureContrast("#e2e2f0", bg, 4.5);
  const font = opts?.fontFamily ?? "Inter, system-ui, sans-serif";
  const headingFont = opts?.headingFontFamily ?? font;

  return {
    version: "1.0.0",
    palette: { bg, surface1, surface2, accent, muted, border, text },
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

/** Nudge a color via HSL lightness until it meets minRatio against bg. */
function ensureContrast(fg: string, bg: string, minRatio: number): string {
  let current = fg;
  const originalL = hexToHsl(fg).l;
  const bgLum = relativeLuminance(bg);
  const bgIsLight = bgLum > 0.5;
  for (let i = 0; i < 30; i++) {
    if (contrastRatio(current, bg) >= minRatio) {
      // Dev warning when nudge is large
      const finalL = hexToHsl(current).l;
      if (Math.abs(finalL - originalL) > 10 && typeof process !== "undefined" && process.env?.NODE_ENV === "development") {
        console.warn(`[branding] ensureContrast nudged ${fg} → ${current} (${Math.abs(finalL - originalL).toFixed(1)}% lightness shift) to meet ${minRatio}:1 against ${bg}`);
      }
      return current;
    }
    const hsl = hexToHsl(current);
    // Darken for light bg, lighten for dark bg
    hsl.l = bgIsLight ? Math.max(0, hsl.l - 3) : Math.min(100, hsl.l + 3);
    current = hslToHex(hsl.h, hsl.s, hsl.l);
  }
  return current;
}

export function deriveLightTokens(accent: string, opts?: DeriveOptions): ThemeTokens {
  const bg = "#fafafa";
  const surface1 = "#ffffff";
  const surface2 = "#f4f4f6";
  const text = "#1a1a2e";
  const border = "#d4d4dc";
  const muted = ensureContrast("#6b7280", bg, 4.5);
  const lightAccent = ensureContrast(accent, bg, 4.5);

  const font = opts?.fontFamily ?? "Inter, system-ui, sans-serif";
  const headingFont = opts?.headingFontFamily ?? font;

  return {
    version: "1.0.0",
    palette: { bg, surface1, surface2, accent: lightAccent, muted, border, text },
    typography: { fontFamily: font, headingFontFamily: headingFont },
    spacing: { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px" },
    radius: { sm: "6px", md: "10px", lg: "14px", xl: "18px" },
    surfaces: { page: bg, panel: surface1, card: surface2, sidebar: surface1, modal: surface2 },
    states: {
      idle: lightAccent, hover: darken(lightAccent, 0.1), active: darken(lightAccent, 0.2),
      focus: lighten(lightAccent, 0.2), success: "#16a34a", warning: "#d97706",
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
```

Update `PresetRow` type and `makePreset` to store `DualThemeTokens`:

```ts
type PresetRow = {
  id: string; scope: string; companyName: string; logoUrl: string; tokens: DualThemeTokens;
};

function makePreset(slug: string, name: string, accent: string, font?: string): PresetRow {
  const scope = `theme-preset:${slug}`;
  return {
    id: scope, scope, companyName: name, logoUrl: DPF_LOGO,
    tokens: deriveThemeTokens(accent, font ? { fontFamily: font } : undefined),
  };
}
```

- [ ] **Step 4: Fix existing tests that expect flat ThemeTokens**

Update the existing tests in `branding-presets.test.ts` that reference `tokens.palette` directly — they now need to use `tokens.dark.palette`:

```ts
describe("deriveThemeTokens", () => {
  it("generates dual token sets from an accent color", () => {
    const tokens = deriveThemeTokens("#2563eb");
    expect(tokens.dark.version).toBe("1.0.0");
    expect(tokens.dark.palette.accent).toBe("#2563eb");
    expect(tokens.dark.palette.bg).toBeTruthy();
    expect(tokens.light.palette.bg).toBe("#fafafa");
  });

  it("accepts optional font override", () => {
    const tokens = deriveThemeTokens("#2563eb", { fontFamily: "Roboto" });
    expect(tokens.dark.typography.fontFamily).toBe("Roboto");
    expect(tokens.light.typography.fontFamily).toBe("Roboto");
  });

  it("produces valid hex colors for all dark palette entries", () => {
    const { dark } = deriveThemeTokens("#d97706");
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    expect(dark.palette.bg).toMatch(hexRe);
    expect(dark.palette.surface1).toMatch(hexRe);
    expect(dark.palette.surface2).toMatch(hexRe);
    expect(dark.palette.accent).toMatch(hexRe);
    expect(dark.palette.muted).toMatch(hexRe);
    expect(dark.palette.border).toMatch(hexRe);
    expect(dark.palette.text).toMatch(hexRe);
  });
});

describe("OOTB_PRESETS", () => {
  it("has 6 generic presets", () => {
    expect(OOTB_PRESETS).toHaveLength(6);
  });

  it("each preset has required fields with dual tokens", () => {
    for (const preset of OOTB_PRESETS) {
      expect(preset.scope).toMatch(/^theme-preset:/);
      expect(preset.companyName).toBeTruthy();
      expect(preset.logoUrl).toBe("/logos/open-digital-product-factory-logo.svg");
      expect(preset.tokens.dark.palette.accent).toBeTruthy();
      expect(preset.tokens.light.palette.accent).toBeTruthy();
    }
  });
});
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/branding-presets.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/branding-presets.ts apps/web/lib/branding-presets.test.ts
git commit -m "feat(branding): dual light/dark palette derivation with contrast enforcement"
```

---

### Task 3: Add WCAG AA contrast validation tests

**Files:**
- Modify: `apps/web/lib/branding-presets.test.ts`

- [ ] **Step 1: Write contrast compliance tests for all 6 presets**

Add to `apps/web/lib/branding-presets.test.ts`:

```ts
describe("WCAG AA contrast compliance", () => {
  const presetAccents = ["#2563eb", "#d97706", "#8b5cf6", "#6b7280", "#0d9488", "#16a34a"];

  for (const accent of presetAccents) {
    describe(`accent ${accent}`, () => {
      const { dark, light } = deriveThemeTokens(accent);

      it("dark mode: text on bg >= 4.5:1", () => {
        expect(contrastRatio(dark.palette.text, dark.palette.bg)).toBeGreaterThanOrEqual(4.5);
      });

      it("dark mode: text on surface1 >= 4.5:1", () => {
        expect(contrastRatio(dark.palette.text, dark.palette.surface1)).toBeGreaterThanOrEqual(4.5);
      });

      it("light mode: text on bg >= 4.5:1", () => {
        expect(contrastRatio(light.palette.text, light.palette.bg)).toBeGreaterThanOrEqual(4.5);
      });

      it("light mode: text on surface1 >= 4.5:1", () => {
        expect(contrastRatio(light.palette.text, light.palette.surface1)).toBeGreaterThanOrEqual(4.5);
      });

      it("light mode: muted on bg >= 4.5:1", () => {
        expect(contrastRatio(light.palette.muted, light.palette.bg)).toBeGreaterThanOrEqual(4.5);
      });

      it("light mode: accent on bg >= 4.5:1", () => {
        expect(contrastRatio(light.palette.accent, light.palette.bg)).toBeGreaterThanOrEqual(4.5);
      });

      it("light mode: accent on surface1 >= 3:1", () => {
        expect(contrastRatio(light.palette.accent, light.palette.surface1)).toBeGreaterThanOrEqual(3);
      });

      it("light mode: border on bg >= 3:1", () => {
        expect(contrastRatio(light.palette.border, light.palette.bg)).toBeGreaterThanOrEqual(3);
      });
    });
  }
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/branding-presets.test.ts`
Expected: PASS — if any fail, the `ensureContrast` logic in Task 2 needs adjustment

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/branding-presets.test.ts
git commit -m "test(branding): WCAG AA contrast compliance tests for all presets"
```

---

### Task 4: Update `buildBrandingStyleTag()` for dual emission

**Files:**
- Modify: `apps/web/lib/branding.ts`
- Modify: `apps/web/lib/branding.test.ts`

- [ ] **Step 1: Write failing tests for dual CSS emission**

Add to `apps/web/lib/branding.test.ts`:

```ts
describe("buildBrandingStyleTag (dual tokens)", () => {
  const dualTokens = {
    dark: {
      palette: { bg: "#0f0f1a", surface1: "#1a1a2e", surface2: "#161625", accent: "#7c8cf8", muted: "#8888a0", border: "#2a2a40", text: "#e2e2f0" },
      typography: { fontFamily: "Inter", headingFontFamily: "Inter" },
    },
    light: {
      palette: { bg: "#fafafa", surface1: "#ffffff", surface2: "#f4f4f6", accent: "#2563eb", muted: "#6b7280", border: "#d4d4dc", text: "#1a1a2e" },
      typography: { fontFamily: "Inter", headingFontFamily: "Inter" },
    },
  };

  it("emits light tokens in :root", () => {
    const css = buildBrandingStyleTag(dualTokens);
    // Light tokens should be in the first :root block (before media query)
    const rootMatch = css.match(/^:root\s*\{([^}]+)\}/);
    expect(rootMatch).toBeTruthy();
    expect(rootMatch![1]).toContain("--dpf-bg: #fafafa");
    expect(rootMatch![1]).toContain("--dpf-text: #1a1a2e");
  });

  it("emits dark tokens inside @media (prefers-color-scheme: dark)", () => {
    const css = buildBrandingStyleTag(dualTokens);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--dpf-bg: #0f0f1a");
    expect(css).toContain("--dpf-text: #e2e2f0");
  });

  it("includes --dpf-text variable", () => {
    const css = buildBrandingStyleTag(dualTokens);
    expect(css).toContain("--dpf-text:");
  });

  it("falls back gracefully with flat (legacy) tokens", () => {
    const flatTokens = {
      palette: { bg: "#0f0f1a", accent: "#7c8cf8", text: "#e2e2f0" },
      typography: { fontFamily: "Inter" },
    };
    const css = buildBrandingStyleTag(flatTokens);
    // Should still produce valid CSS (single :root block, no crash)
    expect(css).toContain(":root");
    expect(css).toContain("--dpf-bg: #0f0f1a");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/branding.test.ts`
Expected: FAIL — `buildBrandingStyleTag` doesn't handle dual tokens or `--dpf-text`

- [ ] **Step 3: Implement dual emission in `buildBrandingStyleTag()`**

Replace the `buildBrandingStyleTag` function in `apps/web/lib/branding.ts`:

```ts
function isDualTokens(tokens: unknown): tokens is { dark: TokenRecord; light: TokenRecord } {
  return isRecord(tokens) && isRecord((tokens as any).dark) && isRecord((tokens as any).light);
}

function buildCssBlock(tokens: TokenRecord): string {
  const palette = isRecord(tokens.palette) ? tokens.palette : {};
  const typography = isRecord(tokens.typography) ? tokens.typography : {};

  const pairs: [string, string | null][] = [
    ["--dpf-bg", safeString(palette.bg)],
    ["--dpf-surface-1", safeString(palette.surface1)],
    ["--dpf-surface-2", safeString(palette.surface2)],
    ["--dpf-text", safeString(palette.text)],
    ["--dpf-accent", safeString(palette.accent)],
    ["--dpf-muted", safeString(palette.muted)],
    ["--dpf-border", safeString(palette.border)],
    ["--dpf-font-body", safeString(typography.fontFamily)],
    ["--dpf-font-heading", safeString(typography.headingFontFamily)],
  ];

  return pairs
    .filter((p): p is [string, string] => p[1] !== null)
    .map(([prop, val]) => `  ${prop}: ${val};`)
    .join("\n");
}

export function buildBrandingStyleTag(tokens: unknown): string {
  if (!isRecord(tokens)) return "";

  if (isDualTokens(tokens)) {
    const lightDecls = buildCssBlock(tokens.light as TokenRecord);
    const darkDecls = buildCssBlock(tokens.dark as TokenRecord);
    if (lightDecls.length === 0 && darkDecls.length === 0) return "";

    let css = "";
    if (lightDecls.length > 0) {
      css += `:root {\n${lightDecls}\n}`;
    }
    if (darkDecls.length > 0) {
      css += `\n@media (prefers-color-scheme: dark) {\n  :root {\n${darkDecls.replace(/^/gm, "  ")}\n  }\n}`;
    }
    return css;
  }

  // Legacy flat tokens fallback
  const declarations = buildCssBlock(tokens as TokenRecord);
  if (declarations.length === 0) return "";
  return `:root {\n${declarations}\n}`;
}
```

- [ ] **Step 4: Fix existing tests affected by changes**

Update existing tests in `branding.test.ts`:
- The test `"only maps the 8 active CSS variables"` must be updated to `"only maps the 9 active CSS variables"` — add `expect(css).toContain("--dpf-text:");` and rename.
- The test `"wraps in :root selector"` should still pass with flat tokens (legacy fallback).
- Tests that pass flat tokens should continue working via the legacy fallback path.

- [ ] **Step 5: Run all branding tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/branding.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/branding.ts apps/web/lib/branding.test.ts
git commit -m "feat(branding): dual CSS emission with prefers-color-scheme media query"
```

---

### Task 5: Update `globals.css` for light-first defaults

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Update globals.css**

Replace the contents of `apps/web/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Light mode defaults (fallback when no BrandingConfig exists) */
:root {
  --dpf-bg: #fafafa;
  --dpf-surface-1: #ffffff;
  --dpf-surface-2: #f4f4f6;
  --dpf-text: #1a1a2e;
  --dpf-accent: #2563eb;
  --dpf-border: #d4d4dc;
  --dpf-muted: #6b7280;
  --dpf-font-body: Inter, system-ui, sans-serif;
  --dpf-font-heading: Inter, system-ui, sans-serif;
}

/* Dark mode defaults */
@media (prefers-color-scheme: dark) {
  :root {
    --dpf-bg: #0f0f1a;
    --dpf-surface-1: #1a1a2e;
    --dpf-surface-2: #161625;
    --dpf-text: #e2e2f0;
    --dpf-accent: #7c8cf8;
    --dpf-border: #2a2a40;
    --dpf-muted: #8888a0;
  }
}

/* Logo visibility toggles */
.logo-light { display: block; }
.logo-dark { display: none; }
@media (prefers-color-scheme: dark) {
  .logo-light { display: none; }
  .logo-dark { display: block; }
}

body {
  background: var(--dpf-bg);
  color: var(--dpf-text);
  font-family: var(--dpf-font-body);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd apps/web && npx next build --no-lint`
Expected: Build succeeds (or at least no CSS parse errors). If full build is slow, skip and verify visually.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(theme): light-first CSS defaults with dark media query override"
```

---

### Task 6: Update branding server actions for dual tokens

**Files:**
- Modify: `apps/web/lib/actions/branding.ts`

- [ ] **Step 1: Verify Task 2 is complete, then update `saveSimpleBrand()`**

**Prerequisite check:** Confirm `deriveThemeTokens` in `branding-presets.ts` returns `DualThemeTokens` (Task 2 must be complete). If not, complete Task 2 first.

In `apps/web/lib/actions/branding.ts`, `saveSimpleBrand()` already calls `deriveThemeTokens(accent, { fontFamily })`. Since Task 2 changed this function to return `DualThemeTokens { dark, light }`, no code change is needed here — the upsert stores the dual object as JSON automatically.

Verify by checking the return type: `const tokens = deriveThemeTokens(accent, { fontFamily });` — TypeScript will now type `tokens` as `DualThemeTokens`.

- [ ] **Step 2: Update `saveActiveThemePreset()` and `saveThemePreset()`**

These functions use `buildThemeTokens(formData)` which constructs flat tokens from form fields. They are the legacy admin path for manual token editing. Wrap the result in dual format by keeping the manually-entered values as the dark variant and deriving only the light variant from the accent:

In `saveActiveThemePreset()`, after `const tokens = buildThemeTokens(formData);`, add:

```ts
// Wrap: keep manually-entered tokens as dark, derive light from accent
import { deriveLightTokens } from "@/lib/branding-presets";
const accent = readString(formData.get("palette_accent")) || "#7c8cf8";
const fontFamily = readString(formData.get("typography_fontFamily")) || undefined;
const dualTokens = {
  dark: tokens,
  light: deriveLightTokens(accent, fontFamily ? { fontFamily } : undefined),
};
```

Then use `dualTokens` instead of `tokens` in the upsert. Apply the same pattern to `saveThemePreset()`.

**Note:** This requires exporting `deriveLightTokens` from `branding-presets.ts` (currently internal). Add `export` to its definition in Task 2.

- [ ] **Step 3: Run related tests**

Run: `cd apps/web && npx vitest run lib/branding`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/branding.ts
git commit -m "feat(branding): all save paths produce dual light/dark token sets"
```

---

### Task 7: Update shell layout for `logoUrlLight` and dual token passthrough

**Files:**
- Modify: `apps/web/app/(shell)/layout.tsx`

- [ ] **Step 1: Add `logoUrlLight` to Prisma select**

In `apps/web/app/(shell)/layout.tsx`, update the `activeBranding` query (around line 26) to include `logoUrlLight`:

```ts
prisma.brandingConfig.findUnique({
  where: { scope: "organization" },
  select: {
    companyName: true,
    logoUrl: true,
    logoUrlLight: true,
    tokens: true,
  },
}),
```

- [ ] **Step 2: Pass both logo URLs to Header**

Update the Header props to include both logo variants. Change the `brandLogoUrl` prop to pass an object, or add a second prop. The simpler approach — add a `brandLogoUrlLight` prop:

```tsx
<Header
  platformRole={user.platformRole}
  isSuperuser={user.isSuperuser}
  brandName={organization?.name ?? activeBranding?.companyName ?? "Open Digital Product Factory"}
  brandLogoUrl={resolveBrandingLogoUrl(
    organization?.logoUrl ?? activeBranding?.logoUrl ?? null,
    organization?.name ?? activeBranding?.companyName ?? "Open Digital Product Factory",
  )}
  brandLogoUrlLight={resolveBrandingLogoUrl(
    activeBranding?.logoUrlLight ?? null,
    organization?.name ?? activeBranding?.companyName ?? "Open Digital Product Factory",
  )}
  userId={user.id}
/>
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(shell)/layout.tsx"
git commit -m "feat(shell): pass logoUrlLight to Header for light mode logo switching"
```

---

### Task 8: Update Header for dual logo and hardcoded color remediation

**Files:**
- Modify: `apps/web/components/shell/Header.tsx`

- [ ] **Step 1: Add `brandLogoUrlLight` prop and dual logo rendering**

In `apps/web/components/shell/Header.tsx`, update the Props type:

```ts
type Props = {
  platformRole: string | null;
  isSuperuser: boolean;
  brandName: string;
  brandLogoUrl: string | null;
  brandLogoUrlLight?: string | null;
  userId?: string | null;
};
```

In the component, add:

```ts
const logoLight = brandLogoUrlLight?.trim() ?? "";
const hasLightLogo = logoLight.length > 0;
```

Replace the single `<img>` logo rendering with dual logos:

```tsx
{hasLogo && !logoFailed ? (
  <div className="h-14 flex items-center">
    {hasLightLogo ? (
      <>
        <img
          src={logoLight}
          alt={`${companyName} logo`}
          className="logo-light block h-full w-auto max-w-[220px] object-contain"
          onError={() => { setLogoFailed(true); }}
        />
        <img
          src={logoSource}
          alt={`${companyName} logo`}
          className="logo-dark block h-full w-auto max-w-[220px] object-contain"
          onError={() => { setLogoFailed(true); }}
        />
      </>
    ) : (
      <img
        src={logoSource}
        alt={`${companyName} logo`}
        className="block h-full w-auto max-w-[220px] object-contain"
        onError={() => {
          console.warn(`[Header] Logo failed to load: ${logoSource}`);
          setLogoFailed(true);
        }}
      />
    )}
  </div>
) : (
  // ... initials fallback unchanged
)}
```

- [ ] **Step 2: Fix `hover:text-white` on sign-out button**

Replace line 87:
```tsx
className="text-xs text-[var(--dpf-muted)] hover:text-white transition-colors"
```
with:
```tsx
className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/shell/Header.tsx
git commit -m "feat(header): dual logo switching and hardcoded color remediation"
```

---

### Task 9: Remediate hardcoded colors in WorkspaceCalendar

**Files:**
- Modify: `apps/web/components/workspace/WorkspaceCalendar.tsx`

- [ ] **Step 1: Replace hardcoded hex colors in the `<style>` block**

In `apps/web/components/workspace/WorkspaceCalendar.tsx`, update the `<style>` block (around line 86-107). Replace:

- `color: #e0e0ff` → `color: var(--dpf-text)`
- `color: #7c8cf8` → `color: var(--dpf-accent)`
- `color: #fff` → `color: var(--dpf-text)`
- `border-color: #7c8cf8 !important` → `border-color: var(--dpf-accent) !important`

The updated style block:

```tsx
<style>{`
  .fc {
    --fc-border-color: var(--dpf-border);
    --fc-page-bg-color: transparent;
    --fc-neutral-bg-color: var(--dpf-surface-2);
    --fc-list-event-hover-bg-color: var(--dpf-surface-2);
    --fc-today-bg-color: rgba(124, 140, 248, 0.05);
    --fc-event-border-color: transparent;
    font-size: 11px;
  }
  .fc .fc-col-header-cell { color: var(--dpf-muted); font-size: 10px; text-transform: uppercase; }
  .fc .fc-daygrid-day-number { color: var(--dpf-text); font-size: 11px; }
  .fc .fc-daygrid-day.fc-day-today .fc-daygrid-day-number { color: var(--dpf-accent); font-weight: 700; }
  .fc .fc-button { background: var(--dpf-surface-2); border-color: var(--dpf-border); color: var(--dpf-text); font-size: 11px; padding: 4px 10px; }
  .fc .fc-button:hover { background: rgba(124,140,248,0.15); }
  .fc .fc-button-active { background: rgba(124,140,248,0.2) !important; border-color: var(--dpf-accent) !important; }
  .fc .fc-toolbar-title { color: var(--dpf-text); font-size: 15px; font-weight: 600; }
  .fc .fc-event { border-radius: 3px; padding: 1px 3px; font-size: 10px; cursor: pointer; }
  .fc .fc-daygrid-event-dot { display: none; }
  .fc .fc-scrollgrid { border-color: var(--dpf-border); }
  .fc td, .fc th { border-color: var(--dpf-border) !important; }
`}</style>
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/workspace/WorkspaceCalendar.tsx
git commit -m "fix(calendar): replace hardcoded hex colors with CSS variables for light mode"
```

---

### Task 10: Remediate hardcoded colors in BrandingPreview

**Files:**
- Modify: `apps/web/components/admin/BrandingPreview.tsx`

- [ ] **Step 1: Add `textColor` prop and replace hardcoded `#fff`**

Update the Props type to accept a `textColor` prop:

```ts
type Props = {
  companyName: string;
  logoUrl: string;
  accentColor: string;
  fontFamily: string;
  bgColor?: string;
  surface1Color?: string;
  borderColor?: string;
  mutedColor?: string;
  textColor?: string;
};
```

Add to defaults: `textColor = "#e2e2f0"`.

Add to cssVars: `"--preview-text": textColor`.

Replace all instances of `color: "#fff"` with `color: "var(--preview-text)"`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/admin/BrandingPreview.tsx
git commit -m "fix(preview): replace hardcoded #fff text with theme-aware variable"
```

---

### Task 11: Add side-by-side light/dark preview to BrandingPreview

**Files:**
- Modify: `apps/web/components/admin/BrandingPreview.tsx`
- Modify: `apps/web/components/admin/BrandingWizard.tsx`
- Modify: `apps/web/components/admin/BrandingQuickEdit.tsx`

- [ ] **Step 1: Create dual preview wrapper**

In `BrandingPreview.tsx`, add a new export `BrandingDualPreview` that renders the existing `BrandingPreview` twice — once with light tokens, once with dark tokens:

```tsx
type DualProps = {
  companyName: string;
  logoUrl: string;
  accentColor: string;  // used only as fallback when token sets not provided
  fontFamily: string;
  darkTokens?: { bg: string; surface1: string; border: string; muted: string; text: string; accent: string };
  lightTokens?: { bg: string; surface1: string; border: string; muted: string; text: string; accent: string };
};

export function BrandingDualPreview({ companyName, logoUrl, accentColor, fontFamily, darkTokens, lightTokens }: DualProps) {
  const defaultDark = { bg: "#0f0f1a", surface1: "#15151f", border: "#2a2a3a", muted: "#6b7280", text: "#e2e2f0", accent: accentColor };
  const defaultLight = { bg: "#fafafa", surface1: "#ffffff", border: "#d4d4dc", muted: "#6b7280", text: "#1a1a2e", accent: accentColor };
  const dk = darkTokens ?? defaultDark;
  const lt = lightTokens ?? defaultLight;

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="text-xs text-[var(--dpf-muted)] mb-2 font-medium">Light</p>
        <BrandingPreview
          companyName={companyName} logoUrl={logoUrl} accentColor={lt.accent} fontFamily={fontFamily}
          bgColor={lt.bg} surface1Color={lt.surface1} borderColor={lt.border} mutedColor={lt.muted} textColor={lt.text}
        />
      </div>
      <div>
        <p className="text-xs text-[var(--dpf-muted)] mb-2 font-medium">Dark</p>
        <BrandingPreview
          companyName={companyName} logoUrl={logoUrl} accentColor={dk.accent} fontFamily={fontFamily}
          bgColor={dk.bg} surface1Color={dk.surface1} borderColor={dk.border} mutedColor={dk.muted} textColor={dk.text}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update BrandingWizard and BrandingQuickEdit to use dual preview**

In both components, replace `<BrandingPreview ... />` with `<BrandingDualPreview ... />`. Pass the derived light and dark token colors from the current accent. This requires importing `deriveThemeTokens` client-side — since it's a pure function with no server dependencies, it can be called in the browser.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/admin/BrandingPreview.tsx apps/web/components/admin/BrandingWizard.tsx apps/web/components/admin/BrandingQuickEdit.tsx
git commit -m "feat(branding): side-by-side light/dark preview in wizard and quick edit"
```

---

### Task 12: Token migration script

**Files:**
- Create: `apps/web/scripts/migrate-dual-branding-tokens.ts`
- Create: `apps/web/scripts/migrate-dual-branding-tokens.test.ts`

- [ ] **Step 1: Write test for migration logic**

Create `apps/web/scripts/migrate-dual-branding-tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { needsMigration, migrateFlatTokens } from "./migrate-dual-branding-tokens";

describe("branding token migration", () => {
  it("detects flat tokens as needing migration", () => {
    const flat = { palette: { accent: "#2563eb", bg: "#0f0f1a" }, typography: {} };
    expect(needsMigration(flat)).toBe(true);
  });

  it("detects dual tokens as already migrated", () => {
    const dual = { dark: { palette: {} }, light: { palette: {} } };
    expect(needsMigration(dual)).toBe(false);
  });

  it("migrates flat tokens to dual format", () => {
    const flat = { palette: { accent: "#2563eb", bg: "#0f0f1a" }, typography: {} };
    const result = migrateFlatTokens(flat);
    expect(result).toHaveProperty("dark");
    expect(result).toHaveProperty("light");
    expect(result.light.palette.bg).toBe("#fafafa");
  });
});
```

- [ ] **Step 2: Write migration script**

Create `apps/web/scripts/migrate-dual-branding-tokens.ts`:

```ts
/**
 * One-time migration: upgrade flat ThemeTokens in BrandingConfig.tokens
 * to dual { dark, light } format.
 */
import { PrismaClient } from "@prisma/client";
import { deriveThemeTokens } from "@/lib/branding-presets";

const prisma = new PrismaClient();

async function main() {
  const configs = await prisma.brandingConfig.findMany();
  let migrated = 0;

  for (const config of configs) {
    const tokens = config.tokens as Record<string, unknown>;
    // Skip if already dual format
    if (tokens && typeof tokens === "object" && "dark" in tokens && "light" in tokens) {
      console.log(`[skip] ${config.scope} — already dual format`);
      continue;
    }

    // Flat tokens — treat as dark variant
    const accent = (tokens?.palette as any)?.accent ?? "#7c8cf8";
    const fontFamily = (tokens?.typography as any)?.fontFamily ?? undefined;
    const dualTokens = deriveThemeTokens(accent, fontFamily ? { fontFamily } : undefined);

    await prisma.brandingConfig.update({
      where: { id: config.id },
      data: { tokens: dualTokens as any },
    });

    console.log(`[migrated] ${config.scope} — upgraded to dual format`);
    migrated++;
  }

  console.log(`\nDone. Migrated ${migrated} of ${configs.length} records.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Run tests to verify migration logic**

Run: `cd apps/web && npx vitest run scripts/migrate-dual-branding-tokens.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/scripts/migrate-dual-branding-tokens.ts apps/web/scripts/migrate-dual-branding-tokens.test.ts
git commit -m "feat(db): migration script to upgrade flat branding tokens to dual format"
```

---

### Task 13: Seed accessibility policy

**Files:**
- Create: `packages/db/scripts/seed-accessibility-policy.ts`

- [ ] **Step 1: Write policy seed script**

Create `packages/db/scripts/seed-accessibility-policy.ts`. Follow the existing policy creation pattern from `apps/web/lib/actions/policy.ts` — use `generatePolicyId()` and `generateRequirementId()`:

```ts
/**
 * Seeds the "UX Accessibility — Color & Theme Standards" policy.
 * Safe to re-run — skips if policy with this title already exists.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

const POLICY_CONTENT = `## 1. Minimum Standard: WCAG 2.2 AA

All platform-generated color palettes must meet WCAG 2.2 Level AA contrast ratios. Normal text requires 4.5:1 contrast against its background. Large text (18pt+ or 14pt bold) and UI components require 3:1. This is enforced algorithmically at palette generation time.

## 2. OS Preference Respected

The platform respects the user's operating system color scheme preference via the CSS \`prefers-color-scheme\` media query. No manual toggle is provided. Light mode is the default for clients that do not report a preference.

## 3. Color Never Conveys Meaning Alone

Per WCAG 1.4.1, color must not be the sole means of conveying information. All color-coded elements (status badges, alerts, chart segments) must include supplementary indicators: icons, labels, patterns, or positional cues.

## 4. Both Modes Are First-Class

Every UI component must render correctly in both light and dark modes. Components that reference theme tokens via CSS variables (\`--dpf-*\`) satisfy this automatically. Custom colors or hardcoded hex values are prohibited in component styles.

## 5. Algorithmic Enforcement

Contrast validation runs at palette generation time, not as a manual review step. The \`deriveThemeTokens()\` function guarantees all critical color pairs meet the minimum ratios before tokens are stored.

## 6. Future Enhancements (Not Yet Implemented)

- \`prefers-contrast\` media query for high-contrast mode
- \`prefers-reduced-motion\` for animation preferences
- WCAG AAA compliance (7:1 text, 4.5:1 large text)

## 7. Standards Referenced

- WCAG 2.2 (W3C Recommendation)
- EN 301 549 (European ICT Accessibility Standard)
- Section 508 (US Federal Accessibility)
- CSS Media Queries Level 5 (\`prefers-color-scheme\`)
- Material Design 3 Dark Theme Guidelines (surface luminance)`;

async function main() {
  const existing = await prisma.policy.findFirst({
    where: { title: "UX Accessibility — Color & Theme Standards" },
  });

  if (existing) {
    console.log("[skip] Policy already exists:", existing.policyId);
    return;
  }

  const policyId = generateId("POL");
  const requirementId = generateId("PREQ");

  await prisma.policy.create({
    data: {
      policyId,
      title: "UX Accessibility — Color & Theme Standards",
      description: POLICY_CONTENT,
      category: "it",
      lifecycleStatus: "published",
      version: 1,
      publishedAt: new Date(),
      reviewFrequency: "annual",
      reviewDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      requirements: {
        create: {
          requirementId,
          requirementType: "acknowledgment",
          frequency: "once",
          applicability: "All developers",
          description: "Acknowledge that you have read and will follow the color and theme accessibility standards when building UI components.",
        },
      },
    },
  });

  console.log(`[created] Policy ${policyId} with requirement ${requirementId}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/scripts/seed-accessibility-policy.ts
git commit -m "feat(policy): seed UX Accessibility Color & Theme Standards policy"
```

---

### Task 14: Hardcoded color audit and remaining remediation

**Files:**
- Modify: `apps/web/components/workspace/CalendarSyncPanel.tsx` — replace `text-white` on themed backgrounds with `text-[var(--dpf-text)]`
- Possibly modify: additional components identified by grep

- [ ] **Step 1: Fix CalendarSyncPanel.tsx**

In `apps/web/components/workspace/CalendarSyncPanel.tsx`, find all instances of `text-white` on elements with themed backgrounds (`bg-[var(--dpf-bg)]` or similar) and replace with `text-[var(--dpf-text)]`. Specifically check lines with input fields and labels that use `text-white` — these are on themed backgrounds and will be invisible in light mode.

- [ ] **Step 2: Run grep audit for remaining hardcoded colors**

Run:
```bash
cd apps/web && grep -rn --include="*.tsx" --include="*.ts" -E "(color:\s*[\"']#(fff|e2e2f0|e0e0ff|ffffff)[\"']|text-white\b)" components/ --include="*.tsx" | grep -v node_modules | grep -v ".test."
```

Review the output. For each file found:
- If the hardcoded color is in a context that will break in light mode (e.g., text on a themed background), replace with `var(--dpf-text)` or appropriate CSS variable
- If it's in a self-contained context (e.g., white text on a colored badge where the badge color is also hardcoded), leave it — it's not theme-dependent

- [ ] **Step 3: Fix identified issues**

Apply fixes as needed. Common patterns:
- `text-white` on themed backgrounds → `text-[var(--dpf-text)]`
- `color: "#fff"` in inline styles → `color: "var(--dpf-text)"`
- `color: "#e2e2f0"` → `color: "var(--dpf-text)"`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(a11y): remediate remaining hardcoded colors for light mode compatibility"
```

---

### Task 15: Run full test suite and verify

**Files:**
- No new files

- [ ] **Step 1: Run the full test suite**

Run: `cd apps/web && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Fix any failures**

If any tests fail due to the `ThemeTokens` shape change (e.g., tests that mock branding tokens as flat objects), update them to use the dual `{ dark, light }` format.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(tests): update tests for dual ThemeTokens format"
```

---

### Task 16: Create backlog epic entry

**Files:**
- Database entry via existing backlog system

- [ ] **Step 1: Create the Epic entry in the backlog**

Use the platform's backlog system to create an Epic with:
- Title: "EP-UX-001: Light Mode UX Theme"
- Description: "Add light mode support driven by OS prefers-color-scheme with WCAG AA contrast enforcement, dual palette derivation, and accessibility policy."
- Link to spec: `docs/superpowers/specs/2026-03-19-light-mode-ux-theme-design.md`

- [ ] **Step 2: Commit any generated files**

```bash
git add -A
git commit -m "chore: add EP-UX-001 Light Mode UX Theme epic to backlog"
```
