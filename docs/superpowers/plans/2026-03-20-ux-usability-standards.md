# EP-UX-STANDARDS: Platform-Wide UI/UX Usability Standards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce WCAG 2.2 AA usability standards across all UI surfaces — portal, storefront, admin shell, agent UI — with save-time contrast validation, form element CSS layer, contrast assertion tests, and living documentation.

**Architecture:** Builds on EP-UX-001's dual token derivation (`deriveThemeTokens()`) and contrast utilities (`contrastRatio()`, `ensureContrast()`). Adds `validateTokenContrast()` for save-time auto-correction, `@layer components` for form element baseline, and a full-sweep remediation of hardcoded hex colors across all components. Portal receives full branding injection matching the shell pattern.

**Tech Stack:** TypeScript, Vitest, Next.js 16, Tailwind CSS 3.4, Prisma, CSS Custom Properties, CSS `@layer`

**Spec:** `docs/superpowers/specs/2026-03-20-ux-usability-standards-design.md`

---

### Task 1: Add `validateTokenContrast()` and `Correction` type with tests

**Files:**
- Modify: `apps/web/lib/branding-presets.ts`
- Modify: `apps/web/lib/branding-presets.test.ts`

- [ ] **Step 1: Write failing tests for validateTokenContrast**

Add to `apps/web/lib/branding-presets.test.ts`:

```ts
import {
  deriveThemeTokens,
  deriveLightTokens,
  OOTB_PRESETS,
  contrastRatio,
  hexToHsl,
  hslToHex,
  validateTokenContrast,
  type Correction,
} from "./branding-presets";

describe("validateTokenContrast", () => {
  it("returns empty corrections for compliant tokens", () => {
    const { dark } = deriveThemeTokens("#2563eb");
    const result = validateTokenContrast(dark, "dark");
    expect(result.corrections).toHaveLength(0);
  });

  it("returns empty corrections for compliant light tokens", () => {
    const { light } = deriveThemeTokens("#2563eb");
    const result = validateTokenContrast(light, "light");
    expect(result.corrections).toHaveLength(0);
  });

  it("auto-corrects non-compliant muted text", () => {
    const { light } = deriveThemeTokens("#2563eb");
    // Force muted to a very light gray that fails contrast
    const broken = { ...light, palette: { ...light.palette, muted: "#e0e0e0" } };
    const result = validateTokenContrast(broken, "light");
    expect(result.corrections.length).toBeGreaterThan(0);
    const mutedFix = result.corrections.find(c => c.foreground === "palette.muted");
    expect(mutedFix).toBeDefined();
    expect(mutedFix!.mode).toBe("light");
    expect(mutedFix!.correctedRatio).toBeGreaterThanOrEqual(4.5);
    // Corrected tokens should now be compliant
    expect(contrastRatio(result.correctedTokens.palette.muted, result.correctedTokens.palette.bg))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("auto-corrects non-compliant accent", () => {
    const { light } = deriveThemeTokens("#2563eb");
    const broken = { ...light, palette: { ...light.palette, accent: "#ffff00" } };
    const result = validateTokenContrast(broken, "light");
    const accentFix = result.corrections.find(c => c.foreground === "palette.accent");
    expect(accentFix).toBeDefined();
  });

  it("checks text against all surfaces", () => {
    const { dark } = deriveThemeTokens("#2563eb");
    // Force text to low contrast
    const broken = {
      ...dark,
      palette: { ...dark.palette, text: "#333333" },
      surfaces: { ...dark.surfaces },
    };
    const result = validateTokenContrast(broken, "dark");
    expect(result.corrections.length).toBeGreaterThan(0);
  });

  it("checks state colors against bg", () => {
    const { light } = deriveThemeTokens("#2563eb");
    // Force focus state to very light color
    const broken = { ...light, states: { ...light.states, focus: "#fafafa" } };
    const result = validateTokenContrast(broken, "light");
    const focusFix = result.corrections.find(c => c.foreground === "states.focus");
    expect(focusFix).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/branding-presets.test.ts`
Expected: FAIL — `validateTokenContrast` is not exported

- [ ] **Step 3: Implement validateTokenContrast and Correction type**

Add to `apps/web/lib/branding-presets.ts` after the `ensureContrast` function (after line 125):

```ts
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
    // Text on all backgrounds at 4.5:1
    text45("palette.bg", t => t.palette.bg),
    text45("palette.surface1", t => t.palette.surface1),
    text45("palette.surface2", t => t.palette.surface2),
    text45("surfaces.panel", t => t.surfaces.panel),
    text45("surfaces.card", t => t.surfaces.card),
    text45("surfaces.sidebar", t => t.surfaces.sidebar),
    text45("surfaces.modal", t => t.surfaces.modal),
    // Muted on backgrounds at 4.5:1
    { fgPath: "palette.muted", bgPath: "palette.bg", minRatio: 4.5,
      getFg: t => t.palette.muted, getBg: t => t.palette.bg,
      setFg: (t, v) => { t.palette.muted = v; } },
    { fgPath: "palette.muted", bgPath: "palette.surface1", minRatio: 4.5,
      getFg: t => t.palette.muted, getBg: t => t.palette.surface1,
      setFg: (t, v) => { t.palette.muted = v; } },
    // Accent on bg at 4.5:1, on surface1 at 3:1
    { fgPath: "palette.accent", bgPath: "palette.bg", minRatio: 4.5,
      getFg: t => t.palette.accent, getBg: t => t.palette.bg,
      setFg: (t, v) => { t.palette.accent = v; } },
    { fgPath: "palette.accent", bgPath: "palette.surface1", minRatio: 3,
      getFg: t => t.palette.accent, getBg: t => t.palette.surface1,
      setFg: (t, v) => { t.palette.accent = v; } },
    // Border at 3:1
    { fgPath: "palette.border", bgPath: "palette.bg", minRatio: 3,
      getFg: t => t.palette.border, getBg: t => t.palette.bg,
      setFg: (t, v) => { t.palette.border = v; } },
    { fgPath: "palette.border", bgPath: "palette.surface1", minRatio: 3,
      getFg: t => t.palette.border, getBg: t => t.palette.surface1,
      setFg: (t, v) => { t.palette.border = v; } },
    // Focus state at 3:1
    { fgPath: "states.focus", bgPath: "palette.bg", minRatio: 3,
      getFg: t => t.states.focus, getBg: t => t.palette.bg,
      setFg: (t, v) => { t.states.focus = v; } },
    { fgPath: "states.focus", bgPath: "palette.surface1", minRatio: 3,
      getFg: t => t.states.focus, getBg: t => t.palette.surface1,
      setFg: (t, v) => { t.states.focus = v; } },
    // Status colors at 3:1
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
  // Deep-clone to avoid mutating the input
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
```

Note: `ensureContrast` remains a private function — `validateTokenContrast` wraps it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/branding-presets.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/branding-presets.ts apps/web/lib/branding-presets.test.ts
git commit -m "feat(branding): add validateTokenContrast with WCAG AA auto-correction"
```

---

### Task 2: Expand WCAG AA contrast tests for all pairs and edge cases

**Files:**
- Modify: `apps/web/lib/branding-presets.test.ts`

- [ ] **Step 1: Add expanded preset contrast tests**

Replace the existing `describe("WCAG AA contrast compliance")` block (lines 179-219) in `apps/web/lib/branding-presets.test.ts` with:

```ts
describe("WCAG AA contrast compliance — expanded", () => {
  const presetAccents = ["#2563eb", "#d97706", "#8b5cf6", "#6b7280", "#0d9488", "#16a34a"];

  for (const accent of presetAccents) {
    describe(`accent ${accent}`, () => {
      const { dark, light } = deriveThemeTokens(accent);

      for (const [label, tokens] of [["dark", dark], ["light", light]] as const) {
        describe(`${label} mode`, () => {
          // Text on backgrounds
          it("text on bg >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.text, tokens.palette.bg)).toBeGreaterThanOrEqual(4.5);
          });
          it("text on surface1 >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.text, tokens.palette.surface1)).toBeGreaterThanOrEqual(4.5);
          });
          it("text on surface2 >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.text, tokens.palette.surface2)).toBeGreaterThanOrEqual(4.5);
          });
          // Text on surfaces
          it("text on surfaces.panel >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.text, tokens.surfaces.panel)).toBeGreaterThanOrEqual(4.5);
          });
          it("text on surfaces.card >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.text, tokens.surfaces.card)).toBeGreaterThanOrEqual(4.5);
          });
          it("text on surfaces.sidebar >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.text, tokens.surfaces.sidebar)).toBeGreaterThanOrEqual(4.5);
          });
          it("text on surfaces.modal >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.text, tokens.surfaces.modal)).toBeGreaterThanOrEqual(4.5);
          });
          // Muted text
          it("muted on bg >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.muted, tokens.palette.bg)).toBeGreaterThanOrEqual(4.5);
          });
          it("muted on surface1 >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.muted, tokens.palette.surface1)).toBeGreaterThanOrEqual(4.5);
          });
          // Accent
          it("accent on bg >= 4.5:1", () => {
            expect(contrastRatio(tokens.palette.accent, tokens.palette.bg)).toBeGreaterThanOrEqual(4.5);
          });
          it("accent on surface1 >= 3:1", () => {
            expect(contrastRatio(tokens.palette.accent, tokens.palette.surface1)).toBeGreaterThanOrEqual(3);
          });
          // Border
          it("border on bg >= 3:1", () => {
            expect(contrastRatio(tokens.palette.border, tokens.palette.bg)).toBeGreaterThanOrEqual(3);
          });
          // Focus state
          it("focus on bg >= 3:1", () => {
            expect(contrastRatio(tokens.states.focus, tokens.palette.bg)).toBeGreaterThanOrEqual(3);
          });
          // Status colors
          for (const key of ["success", "warning", "error", "info"] as const) {
            it(`${key} on bg >= 3:1`, () => {
              expect(contrastRatio(tokens.states[key], tokens.palette.bg)).toBeGreaterThanOrEqual(3);
            });
          }
        });
      }
    });
  }
});

describe("WCAG AA — edge-case accents", () => {
  const edgeCases = [
    { accent: "#FFE74C", label: "very light yellow" },
    { accent: "#0a0a3a", label: "very dark blue" },
    { accent: "#ffffff", label: "pure white" },
    { accent: "#000000", label: "pure black" },
  ];

  for (const { accent, label } of edgeCases) {
    it(`${label} (${accent}) produces compliant tokens`, () => {
      const { dark, light } = deriveThemeTokens(accent);
      // Text on bg must pass in both modes
      expect(contrastRatio(dark.palette.text, dark.palette.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light.palette.text, light.palette.bg)).toBeGreaterThanOrEqual(4.5);
      // Accent on bg must pass
      expect(contrastRatio(dark.palette.accent, dark.palette.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light.palette.accent, light.palette.bg)).toBeGreaterThanOrEqual(4.5);
      // Muted on bg must pass
      expect(contrastRatio(dark.palette.muted, dark.palette.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light.palette.muted, light.palette.bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/branding-presets.test.ts`
Expected: PASS — all presets and edge cases produce compliant tokens via ensureContrast

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/branding-presets.test.ts
git commit -m "test(branding): expand WCAG AA tests — all pairs, surfaces, states, edge-case accents"
```

---

### Task 3: Wire save-time contrast validation into branding actions

**Files:**
- Modify: `apps/web/lib/actions/branding.ts`

- [ ] **Step 1: Add `palette_text` to `buildThemeTokens`**

In `apps/web/lib/actions/branding.ts`, modify the `buildThemeTokens` function (line 24-77). Add `text` to the palette object:

```ts
    palette: {
      bg: tokenValue("palette_bg"),
      surface1: tokenValue("palette_surface1"),
      surface2: tokenValue("palette_surface2"),
      accent: tokenValue("palette_accent"),
      muted: tokenValue("palette_muted"),
      border: tokenValue("palette_border"),
      text: tokenValue("palette_text") || "",  // Empty when not provided; validateTokenContrast skips non-hex values
    },
```

- [ ] **Step 2: Import validateTokenContrast and Correction type**

At top of `apps/web/lib/actions/branding.ts`, update the import:

```ts
import { deriveThemeTokens, validateTokenContrast, type Correction } from "@/lib/branding-presets";
import type { ThemeTokens } from "@/lib/branding-presets";
```

- [ ] **Step 3: Add validation helper**

Add after the `revalidateBrandingSurfaces` function (after line 96):

```ts
function validateAndCorrectDualTokens(
  dualTokens: { dark: unknown; light: unknown }
): { corrected: { dark: ThemeTokens; light: ThemeTokens }; corrections: Correction[] } {
  const allCorrections: Correction[] = [];

  const darkResult = validateTokenContrast(dualTokens.dark as ThemeTokens, "dark");
  allCorrections.push(...darkResult.corrections);

  const lightResult = validateTokenContrast(dualTokens.light as ThemeTokens, "light");
  allCorrections.push(...lightResult.corrections);

  return {
    corrected: { dark: darkResult.correctedTokens, light: lightResult.correctedTokens },
    corrections: allCorrections,
  };
}
```

- [ ] **Step 4: Update `saveSimpleBrand` return type and add validation**

Change `saveSimpleBrand` (line 210) from `Promise<void>` to return corrections:

```ts
export async function saveSimpleBrand(formData: FormData): Promise<{ corrections: Correction[] }> {
  const companyName = readString(formData.get("companyName")) || "Open Digital Product Factory";
  const logoUrl = readString(formData.get("logoUrl")) || null;
  const logoUrlLight = readString(formData.get("logoUrlLight")) || null;
  const accent = readString(formData.get("accent")) || "#7c8cf8";
  const fontFamily = readString(formData.get("fontFamily")) || "Inter, system-ui, sans-serif";

  const rawTokens = deriveThemeTokens(accent, { fontFamily });
  const { corrected, corrections } = validateAndCorrectDualTokens(rawTokens);

  await Promise.all([
    prisma.brandingConfig.upsert({
      where: { scope: "organization" },
      update: { logoUrlLight, tokens: corrected as unknown as Prisma.InputJsonValue },
      create: { scope: "organization", logoUrlLight, tokens: corrected as unknown as Prisma.InputJsonValue },
    }),
    prisma.organization.updateMany({
      data: { name: companyName, logoUrl },
    }),
  ]);

  revalidateBrandingSurfaces();
  return { corrections };
}
```

- [ ] **Step 5: Update `saveActiveThemePreset` with validation**

Change `saveActiveThemePreset` (line 116) to return corrections:

```ts
export async function saveActiveThemePreset(formData: FormData): Promise<{ corrections: Correction[] }> {
  const companyName = readString(formData.get("companyName")) || "Open Digital Product Factory";
  const logoUrl = readString(formData.get("logoUrl")) || null;
  const tokens = buildThemeTokens(formData);
  const accent = readString(formData.get("palette_accent")) || "#7c8cf8";
  const fontFamily = readString(formData.get("typography_fontFamily")) || undefined;
  const { light } = deriveThemeTokens(accent, fontFamily ? { fontFamily } : undefined);
  const rawDual = { dark: tokens, light };
  const { corrected, corrections } = validateAndCorrectDualTokens(rawDual as any);

  await Promise.all([
    prisma.brandingConfig.upsert({
      where: { scope: "organization" },
      update: { tokens: corrected as unknown as Prisma.InputJsonValue },
      create: { scope: "organization", tokens: corrected as unknown as Prisma.InputJsonValue },
    }),
    prisma.organization.updateMany({
      data: { name: companyName, logoUrl },
    }),
  ]);

  revalidateBrandingSurfaces();
  return { corrections };
}
```

- [ ] **Step 6: Update `saveThemePreset` with validation**

Change `saveThemePreset` (line 98) to return corrections:

```ts
export async function saveThemePreset(formData: FormData): Promise<{ corrections: Correction[] }> {
  const scope = resolvePresetScope(formData);
  const label = readString(formData.get("companyName")) || "Custom";
  const tokens = buildThemeTokens(formData);
  const accent = readString(formData.get("palette_accent")) || "#7c8cf8";
  const fontFamily = readString(formData.get("typography_fontFamily")) || undefined;
  const { light } = deriveThemeTokens(accent, fontFamily ? { fontFamily } : undefined);
  const rawDual = { dark: tokens, light };
  const { corrected, corrections } = validateAndCorrectDualTokens(rawDual as any);

  await prisma.brandingConfig.upsert({
    where: { scope },
    update: { label, tokens: corrected as unknown as Prisma.InputJsonValue },
    create: { scope, label, tokens: corrected as unknown as Prisma.InputJsonValue },
  });

  revalidateBrandingSurfaces();
  return { corrections };
}
```

- [ ] **Step 7: Verify branding.ts compiles**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors in `BrandingWizard.tsx` and `BrandingQuickEdit.tsx` because they call `saveSimpleBrand()` but don't capture the new return type. These are expected and will be fixed in Task 11. The `branding.ts` file itself should have no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/actions/branding.ts
git commit -m "feat(branding): wire WCAG contrast validation into all save functions"
```

---

### Task 4: Form element `@layer components` in globals.css

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Replace hardcoded input styling with `@layer components` block**

In `apps/web/app/globals.css`, replace lines 46-50:

```css
/* Inputs must never inherit a theme text color — they have their own background */
input, textarea, select {
  color: #111827;
  background-color: #ffffff;
}
```

With the following block. **Note:** Although this `@layer components` block appears after `@tailwind utilities` in the file, CSS `@layer` ordering means it participates in the `components` layer (lower specificity than utilities). This is correct and intentional — Tailwind utility overrides still win.

```css
/* Form element usability standards — WCAG 2.2 AA baseline.
   Sits in Tailwind's components layer: above base, below utilities.
   Intentional overrides via utility classes still work. */
@layer components {
  input, textarea, select {
    color: var(--dpf-text);
    background-color: var(--dpf-surface-1);
    border-color: var(--dpf-border);
    border-width: 1px;
    border-style: solid;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: inherit;
    font-family: inherit;
  }

  input:focus, textarea:focus, select:focus {
    outline: 2px solid var(--dpf-accent);
    outline-offset: 2px;
  }

  input::placeholder, textarea::placeholder {
    color: var(--dpf-muted);
  }

  input:disabled, textarea:disabled, select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  input:focus, textarea:focus, select:focus {
    border-color: var(--dpf-accent);
  }

  option {
    background: var(--dpf-surface-1);
    color: var(--dpf-text);
  }

  option:checked {
    background: color-mix(in srgb, var(--dpf-accent) 15%, var(--dpf-surface-1));
  }
}
```

- [ ] **Step 2: Verify app builds**

Run: `cd apps/web && npx next build --no-lint 2>&1 | head -20`
Expected: Build starts successfully (may not complete in CI, but no CSS parse errors)

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(ux): add @layer components form element usability standards"
```

---

### Task 5: Portal branding injection

**Files:**
- Modify: `apps/web/app/(portal)/layout.tsx`

- [ ] **Step 1: Rewrite portal layout with branding injection**

Replace the entire content of `apps/web/app/(portal)/layout.tsx` with:

```tsx
// apps/web/app/(portal)/layout.tsx
// Customer portal shell — uses same branding pipeline as admin shell.
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { buildBrandingStyleTag } from "@/lib/branding";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/portal" },
  { label: "Orders", href: "/portal/orders" },
  { label: "Services", href: "/portal/services" },
  { label: "Support", href: "/portal/support" },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.type !== "customer") redirect("/");

  const user = session.user;

  const activeBranding = await prisma.brandingConfig.findUnique({
    where: { scope: "organization" },
    select: { logoUrlLight: true, tokens: true },
  });

  const brandingCss = buildBrandingStyleTag(activeBranding?.tokens ?? null);
  // Logo switching uses .logo-light / .logo-dark CSS classes from globals.css
  // Portal currently shows text "Portal" as brand link — logo switching can be added
  // when the portal header design evolves to include the org logo.

  return (
    <>
      {brandingCss && <style dangerouslySetInnerHTML={{ __html: brandingCss }} />}
      <div className="min-h-screen" style={{ background: "var(--dpf-bg)", color: "var(--dpf-text)" }}>
        {/* Portal header */}
        <header
          className="flex items-center justify-between px-6"
          style={{
            background: "var(--dpf-surface-1)",
            borderBottom: "1px solid var(--dpf-border)",
            height: 56,
          }}
        >
          <div className="flex items-center gap-6">
            <Link
              href="/portal"
              className="font-bold text-base no-underline"
              style={{ color: "var(--dpf-accent)" }}
            >
              Portal
            </Link>
            <nav className="flex gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 text-[13px] no-underline rounded"
                  style={{ color: "var(--dpf-muted)" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs" style={{ color: "var(--dpf-text)" }}>{user.accountName}</div>
              <div className="text-[10px]" style={{ color: "var(--dpf-muted)" }}>{user.email}</div>
            </div>
            <form action={async () => {
              "use server";
              const { signOut } = await import("@/lib/auth");
              await signOut({ redirectTo: "/portal/sign-in" });
            }}>
              <button
                type="submit"
                className="text-[11px] px-2.5 py-1 rounded cursor-pointer"
                style={{
                  border: "1px solid var(--dpf-border)",
                  background: "transparent",
                  color: "var(--dpf-muted)",
                }}
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        {/* Portal content */}
        <main className="max-w-[1200px] mx-auto px-6 py-6">
          {children}
        </main>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(portal)/layout.tsx
git commit -m "feat(portal): inject org branding, replace all hardcoded hex with CSS variables"
```

---

### Task 6: Portal auth page remediation

**Files:**
- Check and modify: `apps/web/app/(portal-auth)/portal/sign-in/page.tsx`
- Check other pages in `apps/web/app/(portal-auth)/`

- [ ] **Step 1: Identify all hardcoded colors in portal-auth pages**

Read all files in `apps/web/app/(portal-auth)/` and find hardcoded hex values. The portal-auth route group has no layout.tsx — each page is standalone.

- [ ] **Step 2: Replace hardcoded colors with CSS variables**

For each page found, replace hardcoded hex values:
- `#0d0d18` → `var(--dpf-bg)`
- `#1a1a2e` → `var(--dpf-surface-1)`
- `#e0e0ff` → `var(--dpf-text)`
- `#2a2a40` → `var(--dpf-border)`
- `#8888a0` → `var(--dpf-muted)`
- `#7c8cf8` → `var(--dpf-accent)`

The `globals.css` defaults ensure these CSS variables have values even without branding injection.

- [ ] **Step 3: Verify no remaining hardcoded hex in portal-auth**

Run: `grep -rn "#[0-9a-fA-F]\{6\}" apps/web/app/\(portal-auth\)/`
Expected: No matches (or only SVG/logo references)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(portal-auth\)/
git commit -m "feat(portal): replace hardcoded hex in portal-auth pages with CSS variables"
```

---

### Task 7: Storefront layout remediation

**Files:**
- Modify: `apps/web/app/(storefront)/s/[slug]/layout.tsx`

- [ ] **Step 1: Remove hardcoded inline styles**

In `apps/web/app/(storefront)/s/[slug]/layout.tsx`, find the container div with hardcoded styles (approximately line 22):

```tsx
<div style={{ minHeight: "100vh", background: "#ffffff", color: "#111827" }}>
```

Replace with:

```tsx
<div style={{ minHeight: "100vh", background: "var(--dpf-bg)", color: "var(--dpf-text)" }}>
```

The layout already calls `buildBrandingStyleTag()` to inject CSS variables — removing these inline overrides lets those variables take effect.

- [ ] **Step 2: Verify type-check passes**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(storefront)/s/[slug]/layout.tsx"
git commit -m "fix(storefront): remove hardcoded colors overriding branding CSS variables"
```

---

### Task 8: Admin shell component remediation

**Files:**
- Modify: `apps/web/components/shell/NavBar.tsx`
- Modify: `apps/web/components/workspace/CalendarEventPopover.tsx`
- Modify: `apps/web/components/workspace/WorkspaceCalendar.tsx`
- Modify: `apps/web/components/workspace/ActivityFeed.tsx`

- [ ] **Step 1: Fix NavBar.tsx**

In `apps/web/components/shell/NavBar.tsx`, find the `text-white` usage (approximately line 22-23):

```tsx
? "bg-[var(--dpf-accent)] text-white"
: "text-[var(--dpf-muted)] hover:text-white border border-[var(--dpf-border)]"
```

Replace with:

```tsx
? "bg-[var(--dpf-accent)] text-[var(--dpf-text)]"
: "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] border border-[var(--dpf-border)]"
```

- [ ] **Step 2: Fix CalendarEventPopover.tsx**

In `apps/web/components/workspace/CalendarEventPopover.tsx`, replace all hardcoded hex inline styles with CSS variables. The mapping:
- `#1a1a2e` → `var(--dpf-surface-1)`
- `#2a2a40` → `var(--dpf-border)`
- `#0d0d18` → `var(--dpf-bg)`
- `#fff` / `#ffffff` → `var(--dpf-text)`
- `rgba(124,140,248,...)` → use `var(--dpf-accent)` with opacity via `color-mix()` or tailwind opacity

Read the file, identify every inline style with hardcoded color, replace each one. Key locations: modal background (line ~77), modal border (line ~78), title text (line ~85), input backgrounds (lines ~98, ~108, ~118, ~132, ~142), textarea (line ~163), button borders/backgrounds (lines ~191-192).

- [ ] **Step 3: Fix WorkspaceCalendar.tsx**

In `apps/web/components/workspace/WorkspaceCalendar.tsx`, find remaining hardcoded values:
- `textColor: "#fff"` on event objects (approximately line 48) → `textColor: "var(--dpf-text)"`
- Any remaining `rgba(124,140,248,...)` in the injected `<style>` block → `var(--dpf-accent)`

- [ ] **Step 4: Fix ActivityFeed.tsx**

In `apps/web/components/workspace/ActivityFeed.tsx`:
- Line 79: `text-white` → `text-[var(--dpf-text)]`
- Lines 6-10: `SECTION_CONFIG` colors (`#fbbf24`, `#38bdf8`, `#8888a0`) — these are semantic status colors that map to `ThemeTokens.states` values (warning, info, muted). They are allowed to remain as hex per the usability standards (status colors referenced from `ThemeTokens.states` are exempted). Verify the hex values match the current theme's state token values and update if they diverge.
  - history `#8888a0` → `var(--dpf-muted)` (this one IS a token role, not a state color)

- [ ] **Step 5: Verify no TypeScript errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/shell/NavBar.tsx apps/web/components/workspace/CalendarEventPopover.tsx apps/web/components/workspace/WorkspaceCalendar.tsx apps/web/components/workspace/ActivityFeed.tsx
git commit -m "fix(shell): replace hardcoded colors in NavBar, Calendar, ActivityFeed with CSS variables"
```

---

### Task 9: Agent UI component remediation

**Files:**
- Modify: `apps/web/components/agent/AgentFAB.tsx`
- Modify: `apps/web/components/agent/AgentMessageBubble.tsx`
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`

- [ ] **Step 1: Fix AgentFAB.tsx**

Find all hardcoded hex values and replace:
- `rgba(124, 140, 248, 0.5)` background → `color-mix(in srgb, var(--dpf-accent) 50%, transparent)`
- `rgba(124, 140, 248, 0.25)` border → `color-mix(in srgb, var(--dpf-accent) 25%, transparent)`
- `#ffffff` text → `var(--dpf-text)`

- [ ] **Step 2: Fix AgentMessageBubble.tsx**

Replace all hardcoded colors. Key mappings:
- `#a0a0b8`, `#d0d0e8` → `var(--dpf-muted)`, `var(--dpf-text)`
- `#ffffff` / `#fff` → `var(--dpf-text)`
- `#e0e0ff` → `var(--dpf-text)`
- `rgba(22, 22, 37, 0.8)` → `color-mix(in srgb, var(--dpf-surface-1) 80%, transparent)`
- `rgba(255,255,255,0.08)` → `color-mix(in srgb, var(--dpf-text) 8%, transparent)`
- `rgba(0,0,0,0.22)` → `color-mix(in srgb, var(--dpf-bg) 22%, transparent)`
- `rgba(74,222,128,0.4)` (success) → keep or map to states.success with opacity
- `rgba(239,68,68,0.4)` (error) → keep or map to states.error with opacity

- [ ] **Step 3: Fix AgentCoworkerPanel.tsx**

Replace hardcoded colors:
- `rgba(124,140,248,0.3)` / `rgba(124,140,248,0.1)` → `color-mix(in srgb, var(--dpf-accent) 30%, transparent)` etc.
- `#7c8cf8` → `var(--dpf-accent)`
- `rgba(22, 22, 37, 0.8)` → `color-mix(in srgb, var(--dpf-surface-1) 80%, transparent)`

- [ ] **Step 4: Verify no TypeScript errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/agent/
git commit -m "fix(agent): replace hardcoded hex in AgentFAB, MessageBubble, CoworkerPanel with CSS variables"
```

---

### Task 10: Storefront component remediation

**Files:**
- Modify: `apps/web/components/storefront/SignInForm.tsx`
- Check/modify: social buttons, linked identities components

- [ ] **Step 1: Fix SignInForm.tsx**

In `apps/web/components/storefront/SignInForm.tsx`, replace all hardcoded hex:
- `#dc2626` error text → keep as-is (this is a `ThemeTokens.states.error` semantic color, allowed per standards)
- `#d1d5db` borders → `var(--dpf-border)`
- `#fff` / `#ffffff` → `var(--dpf-text)` for text, `var(--dpf-surface-1)` for backgrounds
- `#374151` → `var(--dpf-text)`
- `#6b7280` → `var(--dpf-muted)`
- `#000` → `var(--dpf-text)`
- `#9ca3af` → `var(--dpf-muted)`

Note: Social sign-in buttons (Google, Apple) have brand-specific colors. Apple's black button and Google's white button are brand guidelines. These can keep their brand colors but should use CSS variables for borders and secondary text.

- [ ] **Step 2: Find and fix social buttons / linked identities components**

Search for related components:
```
grep -rn "#[0-9a-fA-F]\{3,6\}" apps/web/components/storefront/ apps/web/components/portal/
```

Replace hardcoded hex with CSS variables for any components found. Apply the same mapping patterns.

- [ ] **Step 3: Verify no TypeScript errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/storefront/ apps/web/components/portal/
git commit -m "fix(storefront): replace hardcoded hex in SignInForm and portal components with CSS variables"
```

---

### Task 11: Branding UI corrections banner

**Files:**
- Modify: `apps/web/components/admin/BrandingWizard.tsx`
- Modify: `apps/web/components/admin/BrandingQuickEdit.tsx`

- [ ] **Step 1: Read BrandingWizard.tsx to understand the save flow**

Read `apps/web/components/admin/BrandingWizard.tsx` to find where `saveSimpleBrand` is called and how the result is handled. Identify the save button handler.

- [ ] **Step 2: Update BrandingWizard to capture and display corrections**

After `saveSimpleBrand()` resolves, capture the returned `{ corrections }`. Add state to track corrections:

```tsx
const [corrections, setCorrections] = useState<Correction[]>([]);
```

In the save handler, capture the result:

```tsx
const { corrections } = await saveSimpleBrand(formData);
setCorrections(corrections);
```

Add a corrections banner component (dismissible):

```tsx
{corrections.length > 0 && (
  <div
    className="rounded-lg p-3 mb-4 text-sm"
    style={{
      background: "color-mix(in srgb, var(--dpf-accent) 10%, var(--dpf-surface-1))",
      border: "1px solid var(--dpf-border)",
      color: "var(--dpf-text)",
    }}
  >
    <div className="flex items-center justify-between mb-1">
      <span className="font-medium">Accessibility adjustments applied</span>
      <button
        onClick={() => setCorrections([])}
        className="text-xs cursor-pointer"
        style={{ color: "var(--dpf-muted)", background: "none", border: "none" }}
      >
        Dismiss
      </button>
    </div>
    <ul className="list-disc pl-4 space-y-0.5">
      {corrections.map((c, i) => (
        <li key={i} className="text-xs" style={{ color: "var(--dpf-muted)" }}>
          {c.mode} mode: {c.foreground} adjusted from{" "}
          <code className="font-mono">{c.original}</code> to{" "}
          <code className="font-mono">{c.corrected}</code>{" "}
          (was {c.originalRatio}:1, now {c.correctedRatio}:1)
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 3: Also remediate any `text-white` in BrandingWizard.tsx**

Search for `text-white` in the file and replace with `text-[var(--dpf-text)]`.

- [ ] **Step 4: Update BrandingQuickEdit.tsx similarly**

Apply the same corrections banner pattern and `text-white` remediation to `BrandingQuickEdit.tsx`.

- [ ] **Step 5: Verify no TypeScript errors**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/admin/BrandingWizard.tsx apps/web/components/admin/BrandingQuickEdit.tsx
git commit -m "feat(branding): show WCAG contrast corrections banner after save, fix text-white violations"
```

---

### Task 12: Full grep sweep for remaining violations

**Files:**
- Any component file with hardcoded hex for token roles

- [ ] **Step 1: Run comprehensive grep for violations**

Run these searches from `apps/web/`:

```bash
# text-white / text-black (Tailwind classes)
grep -rn "text-white\|text-black" components/ app/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v ".test."

# bg-white / bg-black
grep -rn "bg-white\|bg-black" components/ app/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v ".test."

# Inline hex colors (excluding CSS variable files and test files)
grep -rn 'color: "#\|background: "#\|borderColor: "#\|border: ".*#\|backgroundColor: "#' components/ app/ --include="*.tsx" | grep -v node_modules | grep -v ".test." | grep -v globals.css | grep -v branding-presets
```

- [ ] **Step 2: Fix remaining violations**

For each file found:
- `text-white` → `text-[var(--dpf-text)]`
- `text-black` → `text-[var(--dpf-text)]`
- `bg-white` → `bg-[var(--dpf-surface-1)]`
- `bg-black` → `bg-[var(--dpf-bg)]`
- Inline hex → appropriate `var(--dpf-*)` reference

Skip files where the color is used for:
- SVG fills / brand logos
- Third-party component overrides
- Status/semantic colors that reference `ThemeTokens.states`

- [ ] **Step 3: Re-run grep to verify**

Re-run the grep commands from Step 1.
Expected: Significantly reduced results — remaining matches should all be in the "allowed" categories.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(ux): sweep remaining hardcoded color violations across all components"
```

---

### Task 13: Usability standards documentation

**Files:**
- Create: `docs/platform-usability-standards.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write usability standards document**

Create `docs/platform-usability-standards.md`:

```markdown
# Platform Usability Standards

Living reference for all UI development. All developers and AI agents must follow these standards when creating or reviewing UI code.

## Color System

Every UI component uses CSS custom properties for all color roles. These properties are set by the branding system via `buildBrandingStyleTag()` and fall back to defaults in `globals.css`.

| Variable | Purpose | Example |
|----------|---------|---------|
| `--dpf-bg` | Page background | `background: var(--dpf-bg)` |
| `--dpf-surface-1` | Cards, panels, inputs | `background: var(--dpf-surface-1)` |
| `--dpf-surface-2` | Secondary surfaces | `background: var(--dpf-surface-2)` |
| `--dpf-text` | Primary text | `color: var(--dpf-text)` |
| `--dpf-accent` | Interactive elements, links | `color: var(--dpf-accent)` |
| `--dpf-muted` | Secondary text, placeholders | `color: var(--dpf-muted)` |
| `--dpf-border` | Borders, dividers | `border-color: var(--dpf-border)` |
| `--dpf-font-body` | Body font family | `font-family: var(--dpf-font-body)` |
| `--dpf-font-heading` | Heading font family | `font-family: var(--dpf-font-heading)` |

## Contrast Requirements

All color pairs must meet WCAG 2.2 Level AA minimum contrast ratios:

| Element Type | Minimum Ratio | Standard |
|---|---|---|
| Body text on any background | 4.5:1 | WCAG 2.2 AA |
| Secondary/muted text on any background | 4.5:1 | WCAG 2.2 AA |
| Interactive text (links, buttons) on background | 4.5:1 | WCAG 2.2 AA |
| UI components (borders, focus rings) on background | 3:1 | WCAG 2.2 AA |
| Status indicators on background | 3:1 | WCAG 2.2 AA |

**Enforcement points:**
- **Derivation time:** `ensureContrast()` nudges colors during token generation
- **Save time:** `validateTokenContrast()` checks all configurable pairs and auto-corrects violations before database write

## Form Elements

All `<input>`, `<select>`, `<textarea>` elements receive a baseline via `@layer components` in `globals.css`:
- **Focus:** 2px solid outline using `--dpf-accent`, offset 2px
- **Placeholder:** Uses `--dpf-muted` (guaranteed 4.5:1 contrast)
- **Disabled:** `opacity: 0.5; cursor: not-allowed`
- **Active/focused:** Border color changes to `--dpf-accent`

## Prohibited Patterns

These patterns are NOT allowed in component code:

| Pattern | Replacement |
|---------|-------------|
| `text-white` | `text-[var(--dpf-text)]` |
| `text-black` | `text-[var(--dpf-text)]` |
| `bg-white` | `bg-[var(--dpf-surface-1)]` |
| `bg-black` | `bg-[var(--dpf-bg)]` |
| `color: "#ffffff"` | `color: "var(--dpf-text)"` |
| `background: "#000000"` | `background: "var(--dpf-bg)"` |
| Any hardcoded hex for bg/text/border/accent/muted | Use the corresponding `var(--dpf-*)` |

## Allowed Hex Usage

Literal hex values are permitted ONLY for:
1. **Status colors** referenced from `ThemeTokens.states` (success, warning, error, info)
2. **SVG brand marks** and third-party logos (Google, Apple, etc.)
3. **Third-party component overrides** where CSS variables cannot be injected

## Component Checklist

Before submitting a component, verify:
- [ ] All backgrounds use `var(--dpf-bg)`, `var(--dpf-surface-1)`, or `var(--dpf-surface-2)`
- [ ] All text uses `var(--dpf-text)` or `var(--dpf-muted)`
- [ ] All borders use `var(--dpf-border)`
- [ ] All interactive elements use `var(--dpf-accent)`
- [ ] No `text-white`, `text-black`, `bg-white`, or `bg-black` Tailwind classes
- [ ] No inline hex colors for token roles
- [ ] Component renders correctly in both light and dark mode (toggle OS preference to verify)

## Standards Referenced

- WCAG 2.2 (W3C Recommendation) — Level AA compliance
- EN 301 549 (European ICT Accessibility Standard)
- Section 508 (US Federal Accessibility)
- CSS Media Queries Level 5 (`prefers-color-scheme`)
```

- [ ] **Step 2: Update AGENTS.md**

Add a line to `AGENTS.md` in the relevant section (project conventions or similar):

```markdown
## Usability Standards

All UI development must follow `docs/platform-usability-standards.md`. This document defines the CSS variable system, contrast requirements, form element standards, and prohibited color patterns. AI agents generating or reviewing UI code MUST consult this document.
```

- [ ] **Step 3: Commit**

```bash
git add docs/platform-usability-standards.md AGENTS.md
git commit -m "docs(ux): add platform usability standards reference, update AGENTS.md"
```
