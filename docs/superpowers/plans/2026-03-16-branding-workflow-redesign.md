# Branding Workflow Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the admin branding workflow with a wizard-first setup, runtime CSS token injection, and AI coworker as the advanced interface — so customers can establish their brand in under 2 minutes.

**Architecture:** Three-layer branding interaction (Setup Wizard → Quick Edit → AI Coworker) on a new `/admin/branding` sub-route. Runtime CSS injection in the shell layout maps stored tokens to CSS variables. The existing `analyze_public_website_branding` tool powers URL import; a new `analyze_brand_document` tool handles document uploads. Form assist expansion gives the AI coworker full token control.

**Tech Stack:** Next.js 14 (App Router, server components + client components), Prisma ORM, PostgreSQL, Vitest, Tailwind CSS, existing AI coworker infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-16-branding-workflow-redesign-design.md`

---

## Chunk 1: Foundation (Runtime CSS, Logo Fix, Admin Restructure)

These tasks establish the infrastructure that everything else depends on: runtime theming, working logos, and the admin sub-route structure.

### Task 1: Consolidate Logo URL Utilities

**Files:**
- Modify: `apps/web/lib/branding.ts`
- Test: `apps/web/lib/branding.test.ts` (new)
- Reference: `apps/web/components/admin/BrandingConfigurator.tsx:268-290` (existing `normalizeLogoUrl`)

- [ ] **Step 1: Write failing tests for normalizeLogoUrl and enhanced resolveBrandingLogoUrl**

```ts
// apps/web/lib/branding.test.ts
import { describe, expect, it } from "vitest";
import { normalizeLogoUrl, resolveBrandingLogoUrl } from "./branding";

describe("normalizeLogoUrl", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(normalizeLogoUrl(null)).toBe("");
    expect(normalizeLogoUrl(undefined)).toBe("");
    expect(normalizeLogoUrl("")).toBe("");
    expect(normalizeLogoUrl("   ")).toBe("");
  });

  it("passes through absolute HTTPS URLs", () => {
    expect(normalizeLogoUrl("https://example.com/logo.svg")).toBe("https://example.com/logo.svg");
  });

  it("passes through app-local paths starting with /", () => {
    expect(normalizeLogoUrl("/logos/company.svg")).toBe("/logos/company.svg");
  });

  it("passes through data URLs", () => {
    const dataUrl = "data:image/svg+xml;base64,PHN2Zz4=";
    expect(normalizeLogoUrl(dataUrl)).toBe(dataUrl);
  });

  it("trims whitespace", () => {
    expect(normalizeLogoUrl("  https://example.com/logo.svg  ")).toBe("https://example.com/logo.svg");
  });
});

describe("resolveBrandingLogoUrl", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(resolveBrandingLogoUrl(null, "Acme")).toBe("");
    expect(resolveBrandingLogoUrl(undefined, "Acme")).toBe("");
    expect(resolveBrandingLogoUrl("", "Acme")).toBe("");
  });

  it("passes through valid URLs unchanged", () => {
    expect(resolveBrandingLogoUrl("https://example.com/logo.svg", "Acme")).toBe("https://example.com/logo.svg");
    expect(resolveBrandingLogoUrl("/logos/foo.svg", "Acme")).toBe("/logos/foo.svg");
  });

  it("passes through data URLs", () => {
    const dataUrl = "data:image/png;base64,iVBOR";
    expect(resolveBrandingLogoUrl(dataUrl, "Acme")).toBe(dataUrl);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- branding.test.ts`
Expected: FAIL — `normalizeLogoUrl` is not exported from `./branding`

- [ ] **Step 3: Implement normalizeLogoUrl and enhance resolveBrandingLogoUrl**

```ts
// apps/web/lib/branding.ts
export function normalizeLogoUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (trimmed.length === 0) return "";
  return trimmed;
}

export function resolveBrandingLogoUrl(
  logoUrl: string | null | undefined,
  _companyName: string,
): string {
  return normalizeLogoUrl(logoUrl);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- branding.test.ts`
Expected: PASS

- [ ] **Step 5: Add console.warn to Header component on logo load failure**

Modify `apps/web/components/shell/Header.tsx:64`:

Change:
```tsx
onError={() => setLogoFailed(true)}
```
To:
```tsx
onError={() => {
  console.warn(`[Header] Logo failed to load: ${logoSource}`);
  setLogoFailed(true);
}}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/branding.ts apps/web/lib/branding.test.ts apps/web/components/shell/Header.tsx
git commit -m "refactor: consolidate logo URL utilities into lib/branding.ts"
```

---

### Task 2: Runtime CSS Token Injection

**Files:**
- Modify: `apps/web/app/(shell)/layout.tsx`
- Test: `apps/web/lib/branding.test.ts` (extend)
- Reference: `apps/web/app/globals.css` (8 CSS variable names)

- [ ] **Step 1: Write failing test for token-to-CSS mapping function**

Append to `apps/web/lib/branding.test.ts`:

```ts
import { buildBrandingStyleTag } from "./branding";

describe("buildBrandingStyleTag", () => {
  it("returns empty string when tokens is null", () => {
    expect(buildBrandingStyleTag(null)).toBe("");
  });

  it("returns empty string when tokens is empty object", () => {
    expect(buildBrandingStyleTag({})).toBe("");
  });

  it("maps palette tokens to CSS variables", () => {
    const tokens = {
      palette: { bg: "#111111", accent: "#ff0000" },
    };
    const css = buildBrandingStyleTag(tokens);
    expect(css).toContain("--dpf-bg: #111111");
    expect(css).toContain("--dpf-accent: #ff0000");
  });

  it("maps typography tokens to CSS variables", () => {
    const tokens = {
      typography: { fontFamily: "Roboto", headingFontFamily: "Montserrat" },
    };
    const css = buildBrandingStyleTag(tokens);
    expect(css).toContain("--dpf-font-body: Roboto");
    expect(css).toContain("--dpf-font-heading: Montserrat");
  });

  it("only maps the 8 active CSS variables", () => {
    const tokens = {
      palette: { bg: "#111", surface1: "#222", surface2: "#333", accent: "#444", muted: "#555", border: "#666" },
      typography: { fontFamily: "Inter", headingFontFamily: "Inter" },
      surfaces: { page: "#aaa" },
      states: { idle: "#bbb" },
    };
    const css = buildBrandingStyleTag(tokens);
    // Active variables present
    expect(css).toContain("--dpf-bg:");
    expect(css).toContain("--dpf-surface-1:");
    expect(css).toContain("--dpf-surface-2:");
    expect(css).toContain("--dpf-accent:");
    expect(css).toContain("--dpf-muted:");
    expect(css).toContain("--dpf-border:");
    expect(css).toContain("--dpf-font-body:");
    expect(css).toContain("--dpf-font-heading:");
    // Unused tokens NOT injected
    expect(css).not.toContain("surfaces");
    expect(css).not.toContain("states");
  });

  it("wraps in :root selector", () => {
    const tokens = { palette: { accent: "#ff0000" } };
    const css = buildBrandingStyleTag(tokens);
    expect(css).toMatch(/^:root\s*\{/);
    expect(css).toMatch(/\}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- branding.test.ts`
Expected: FAIL — `buildBrandingStyleTag` is not exported

- [ ] **Step 3: Implement buildBrandingStyleTag**

Add to `apps/web/lib/branding.ts`:

```ts
type TokenRecord = Record<string, unknown>;

function isRecord(v: unknown): v is TokenRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Build a CSS :root block that maps BrandingConfig.tokens to the 8 active
 * CSS custom properties consumed by components today.
 */
export function buildBrandingStyleTag(tokens: unknown): string {
  if (!isRecord(tokens)) return "";

  const palette = isRecord(tokens.palette) ? tokens.palette : {};
  const typography = isRecord(tokens.typography) ? tokens.typography : {};

  const pairs: [string, string | null][] = [
    ["--dpf-bg", safeString(palette.bg)],
    ["--dpf-surface-1", safeString(palette.surface1)],
    ["--dpf-surface-2", safeString(palette.surface2)],
    ["--dpf-accent", safeString(palette.accent)],
    ["--dpf-muted", safeString(palette.muted)],
    ["--dpf-border", safeString(palette.border)],
    ["--dpf-font-body", safeString(typography.fontFamily)],
    ["--dpf-font-heading", safeString(typography.headingFontFamily)],
  ];

  const declarations = pairs
    .filter((p): p is [string, string] => p[1] !== null)
    .map(([prop, val]) => `  ${prop}: ${val};`)
    .join("\n");

  if (declarations.length === 0) return "";

  return `:root {\n${declarations}\n}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- branding.test.ts`
Expected: PASS

- [ ] **Step 5: Wire buildBrandingStyleTag into the shell layout**

Modify `apps/web/app/(shell)/layout.tsx`:

1. Add import: `import { resolveBrandingLogoUrl, buildBrandingStyleTag } from "@/lib/branding";`
2. Extend the `activeBranding` query to also select `tokens`:
```ts
    prisma.brandingConfig.findUnique({
      where: { scope: "organization" },
      select: {
        companyName: true,
        logoUrl: true,
        tokens: true,
      },
    }),
```
3. After the `return (` and before the outer `<div>`, inject the style tag:
```tsx
  const brandingCss = buildBrandingStyleTag(activeBranding?.tokens ?? null);

  return (
    <>
      {brandingCss && <style dangerouslySetInnerHTML={{ __html: brandingCss }} />}
      <div className="min-h-screen flex flex-col bg-[var(--dpf-bg)]">
        {/* ... existing content unchanged ... */}
      </div>
    </>
  );
```

- [ ] **Step 6: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/branding.ts apps/web/lib/branding.test.ts apps/web/app/\(shell\)/layout.tsx
git commit -m "feat: runtime CSS token injection from BrandingConfig"
```

---

### Task 3: Admin Tab Navigation Restructure

**Files:**
- Modify: `apps/web/components/admin/AdminTabNav.tsx`
- Create: `apps/web/app/(shell)/admin/branding/page.tsx`
- Create: `apps/web/app/(shell)/admin/settings/page.tsx`
- Modify: `apps/web/app/(shell)/admin/page.tsx`

- [ ] **Step 1: Update AdminTabNav with three tabs**

Replace `apps/web/components/admin/AdminTabNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Access", href: "/admin" },
  { label: "Branding", href: "/admin/branding" },
  { label: "Settings", href: "/admin/settings" },
];

export function AdminTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <div className="mb-6 flex gap-1 border-b border-[var(--dpf-border)]">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={[
            "rounded-t px-3 py-1.5 text-xs font-medium transition-colors",
            active(tab.href)
              ? "border-b-2 border-[var(--dpf-accent)] text-white"
              : "text-[var(--dpf-muted)] hover:text-white",
          ].join(" ")}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create Settings sub-route (move PlatformKeysPanel)**

Create `apps/web/app/(shell)/admin/settings/page.tsx`:

```tsx
import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { PlatformKeysPanel } from "@/components/admin/PlatformKeysPanel";

async function getPlatformKeyStatuses(): Promise<Record<string, boolean>> {
  const keys = ["brave_search_api_key"];
  const configs = await prisma.platformConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const statuses: Record<string, boolean> = {};
  for (const k of keys) {
    const config = configs.find((c) => c.key === k);
    statuses[k] = !!config && typeof config.value === "string" && config.value.length > 0;
  }
  return statuses;
}

export default async function AdminSettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Platform Settings</p>
      </div>
      <AdminTabNav />
      <PlatformKeysPanel keyStatuses={await getPlatformKeyStatuses()} />
    </div>
  );
}
```

- [ ] **Step 3: Create Branding sub-route (placeholder)**

Create `apps/web/app/(shell)/admin/branding/page.tsx`:

```tsx
import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";

export default async function AdminBrandingPage() {
  const activeBranding = await prisma.brandingConfig.findUnique({
    where: { scope: "organization" },
    select: { id: true },
  });

  const hasExistingBrand = !!activeBranding;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Brand Configuration</p>
      </div>
      <AdminTabNav />
      <div className="p-6 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
        <p className="text-sm text-[var(--dpf-muted)]">
          {hasExistingBrand
            ? "Brand is configured. Quick edit and AI coworker coming soon."
            : "No brand configured yet. Setup wizard coming soon."}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Clean up admin/page.tsx — remove branding and platform keys sections**

Modify `apps/web/app/(shell)/admin/page.tsx`:

Remove the following from the file:
1. The `BrandingConfigurator` import and its entire section (lines ~609-651)
2. The `PlatformKeysPanel` import and its section (lines ~602-605)
3. The `deleteThemePreset` import
4. The `resolveBrandingLogoUrl` import
5. All OOTB preset data (`OOTB_PRESETS`, `makePreset`, `presetLogoUrl`, `getPresetLabel`, `THEME_TOKEN_BASE`, `ThemeTokenInput`, `BrandingPresetRow`, `BrandingConfigRow`, `parseStoredTokens`, `readString`, `readColor`, `HEX_RE`, `isRecord`, `THEME_PRESET_SCOPE_PREFIX`)
6. The `brandingConfigs`, `activeBranding`, `savedPresets`, `activePreset` data fetches and transformations
7. The `getPlatformKeyStatuses` function (moved to settings page)

Keep only: user listing, `AdminTabNav`, `AdminUserAccessPanel`, user/role data fetches.

The resulting page should be approximately:
```tsx
import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { AdminUserAccessPanel } from "@/components/admin/AdminUserAccessPanel";

export default async function AdminPage() {
  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true, email: true, isActive: true, isSuperuser: true, createdAt: true,
        groups: { select: { platformRole: { select: { roleId: true, name: true } } } },
      },
    }),
    prisma.platformRole.findMany({
      orderBy: { roleId: "asc" },
      select: { id: true, roleId: true, name: true },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {users.length} user{users.length !== 1 ? "s" : ""}
        </p>
      </div>
      <AdminTabNav />
      {/* User cards grid — keep existing user listing JSX unchanged */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {users.map((u) => {
          const statusColour = u.isActive ? "#4ade80" : "#8888a0";
          const statusLabel = u.isActive ? "active" : "inactive";
          return (
            <div key={u.id} className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4" style={{ borderLeftColor: "#8888a0" }}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-white leading-tight truncate">{u.email}</p>
                <div className="flex gap-1 shrink-0">
                  {u.isSuperuser && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#fbbf2420", color: "#fbbf24" }}>superuser</span>
                  )}
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: `${statusColour}20`, color: statusColour }}>{statusLabel}</span>
                </div>
              </div>
              <p className="text-[9px] text-[var(--dpf-muted)]">Joined {new Date(u.createdAt).toLocaleDateString()}</p>
              {u.groups.length === 0 ? (
                <p className="text-[9px] text-[var(--dpf-muted)] mt-2">No roles assigned</p>
              ) : (
                <div className="flex flex-wrap gap-1 mt-2">
                  {u.groups.map((g) => (
                    <span key={g.platformRole.roleId} className="text-[9px] font-mono text-[var(--dpf-muted)]">{g.platformRole.roleId}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {users.length === 0 && <p className="text-sm text-[var(--dpf-muted)]">No users registered yet.</p>}
      <div className="mt-8">
        <AdminUserAccessPanel
          roles={roles}
          users={users.map((user) => ({ id: user.id, email: user.email }))}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS (BrandingConfigurator may have unused import warnings — that's fine, it will be removed in a later task)

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/admin/AdminTabNav.tsx apps/web/app/\(shell\)/admin/page.tsx apps/web/app/\(shell\)/admin/branding/page.tsx apps/web/app/\(shell\)/admin/settings/page.tsx
git commit -m "feat: restructure admin page into Access/Branding/Settings tabs"
```

---

### Task 4: Generic OOTB Presets & Token Derivation

**Files:**
- Create: `apps/web/lib/branding-presets.ts`
- Test: `apps/web/lib/branding-presets.test.ts` (new)

- [ ] **Step 1: Write failing tests for deriveThemeTokens and preset data**

```ts
// apps/web/lib/branding-presets.test.ts
import { describe, expect, it } from "vitest";
import { deriveThemeTokens, OOTB_PRESETS } from "./branding-presets";

describe("deriveThemeTokens", () => {
  it("generates a full token set from an accent color", () => {
    const tokens = deriveThemeTokens("#2563eb");
    expect(tokens.version).toBe("1.0.0");
    expect(tokens.palette.accent).toBe("#2563eb");
    // Derived fields should be non-empty strings
    expect(tokens.palette.bg).toBeTruthy();
    expect(tokens.palette.surface1).toBeTruthy();
    expect(tokens.palette.surface2).toBeTruthy();
    expect(tokens.palette.muted).toBeTruthy();
    expect(tokens.palette.border).toBeTruthy();
    expect(tokens.typography.fontFamily).toBeTruthy();
    expect(tokens.typography.headingFontFamily).toBeTruthy();
  });

  it("accepts optional font override", () => {
    const tokens = deriveThemeTokens("#2563eb", { fontFamily: "Roboto" });
    expect(tokens.typography.fontFamily).toBe("Roboto");
  });

  it("produces valid hex colors for all palette entries", () => {
    const tokens = deriveThemeTokens("#d97706");
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    expect(tokens.palette.bg).toMatch(hexRe);
    expect(tokens.palette.surface1).toMatch(hexRe);
    expect(tokens.palette.surface2).toMatch(hexRe);
    expect(tokens.palette.accent).toMatch(hexRe);
    expect(tokens.palette.muted).toMatch(hexRe);
    expect(tokens.palette.border).toMatch(hexRe);
  });
});

describe("OOTB_PRESETS", () => {
  it("has 6 generic presets", () => {
    expect(OOTB_PRESETS).toHaveLength(6);
  });

  it("each preset has required fields", () => {
    for (const preset of OOTB_PRESETS) {
      expect(preset.scope).toMatch(/^theme-preset:/);
      expect(preset.companyName).toBeTruthy();
      expect(preset.logoUrl).toBe("/logos/open-digital-product-factory-logo.svg");
      expect(preset.tokens.palette.accent).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- branding-presets.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement deriveThemeTokens and OOTB_PRESETS**

```ts
// apps/web/lib/branding-presets.ts

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

/** Parse hex color to [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Convert [r, g, b] to hex. */
function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map(v => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Darken a hex color by a factor (0-1). */
function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/** Lighten a hex color by mixing with white. */
function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

/** Mix accent with a dark base to get themed dark surfaces. */
function mixWithDark(accent: string, darkBase: string, ratio: number): string {
  const [ar, ag, ab] = hexToRgb(accent);
  const [dr, dg, db] = hexToRgb(darkBase);
  return rgbToHex(
    dr + (ar - dr) * ratio,
    dg + (ag - dg) * ratio,
    db + (ab - db) * ratio,
  );
}

type DeriveOptions = {
  fontFamily?: string;
  headingFontFamily?: string;
};

/**
 * Algorithmically derive a full theme token set from an accent color.
 * Produces a cohesive dark theme.
 */
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
    surfaces: {
      page: bg,
      panel: surface1,
      card: surface2,
      sidebar: surface1,
      modal: surface2,
    },
    states: {
      idle: accent,
      hover: lighten(accent, 0.25),
      active: darken(accent, 0.15),
      focus: lighten(accent, 0.35),
      success: "#4ade80",
      warning: "#fbbf24",
      error: "#f87171",
      info: "#38bdf8",
    },
    shadows: {
      panel: "0 18px 48px rgba(0, 0, 0, 0.45)",
      card: "0 12px 24px rgba(0, 0, 0, 0.35)",
      button: "0 6px 12px rgba(0, 0, 0, 0.28)",
    },
  };
}

type PresetRow = {
  id: string;
  scope: string;
  companyName: string;
  logoUrl: string;
  tokens: ThemeTokens;
};

const DPF_LOGO = "/logos/open-digital-product-factory-logo.svg";

function makePreset(slug: string, name: string, accent: string, font?: string): PresetRow {
  const scope = `theme-preset:${slug}`;
  return {
    id: scope,
    scope,
    companyName: name,
    logoUrl: DPF_LOGO,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- branding-presets.test.ts`
Expected: PASS

- [ ] **Step 5: Create public/logos directory and add DPF logo SVG**

The `apps/web/public/logos/` directory does not exist yet. Create it and add a simple SVG logo for the Open Digital Product Factory. This is referenced by all OOTB presets.

```bash
mkdir -p apps/web/public/logos
```

Create `apps/web/public/logos/open-digital-product-factory-logo.svg` — a simple geometric SVG mark (blue hexagon with "DPF" text or similar abstract shape). The exact design is flexible; it needs to be a valid SVG that renders at 120x40 in the Header.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/branding-presets.ts apps/web/lib/branding-presets.test.ts apps/web/public/logos/
git commit -m "feat: generic OOTB branding presets with algorithmic token derivation"
```

---

## Chunk 2: Branding UI (Wizard, Quick Edit, Preview)

These tasks build the three interaction layers on the `/admin/branding` page.

### Task 5: BrandingPreview Component

**Files:**
- Create: `apps/web/components/admin/BrandingPreview.tsx`

- [ ] **Step 1: Create the BrandingPreview client component**

```tsx
// apps/web/components/admin/BrandingPreview.tsx
"use client";

type Props = {
  companyName: string;
  logoUrl: string;
  accentColor: string;
  fontFamily: string;
  bgColor?: string;
  surface1Color?: string;
  borderColor?: string;
  mutedColor?: string;
};

/**
 * Live preview panel showing how the brand will look.
 * Applies scoped CSS variable overrides via inline styles.
 */
export function BrandingPreview({
  companyName,
  logoUrl,
  accentColor,
  fontFamily,
  bgColor,
  surface1Color,
  borderColor,
  mutedColor,
}: Props) {
  const cssVars = {
    "--preview-bg": bgColor ?? "var(--dpf-bg)",
    "--preview-surface": surface1Color ?? "var(--dpf-surface-1)",
    "--preview-accent": accentColor || "var(--dpf-accent)",
    "--preview-border": borderColor ?? "var(--dpf-border)",
    "--preview-muted": mutedColor ?? "var(--dpf-muted)",
    "--preview-font": fontFamily || "var(--dpf-font-body)",
  } as React.CSSProperties;

  const hasLogo = logoUrl.trim().length > 0;

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        ...cssVars,
        background: "var(--preview-bg)",
        borderColor: "var(--preview-border)",
        fontFamily: "var(--preview-font)",
      }}
    >
      {/* Mock header */}
      <div
        className="flex items-center gap-3 px-4 py-2 border-b"
        style={{ background: "var(--preview-surface)", borderColor: "var(--preview-border)" }}
      >
        {hasLogo ? (
          <img src={logoUrl} alt="Logo preview" className="h-8 w-auto max-w-[120px] object-contain" />
        ) : (
          <div
            className="w-8 h-8 rounded grid place-items-center text-[8px] font-bold"
            style={{ background: "var(--preview-surface)", border: "1px solid var(--preview-border)", color: "var(--preview-muted)" }}
          >
            {companyName.slice(0, 2).toUpperCase() || "DP"}
          </div>
        )}
        <span className="text-xs font-semibold" style={{ color: "var(--preview-accent)" }}>
          {companyName || "Your Company"}
        </span>
      </div>

      {/* Mock content */}
      <div className="p-4 space-y-3">
        {/* Card sample */}
        <div
          className="p-3 rounded border"
          style={{ background: "var(--preview-surface)", borderColor: "var(--preview-border)" }}
        >
          <p className="text-xs font-medium text-white">Sample Card</p>
          <p className="text-[10px] mt-1" style={{ color: "var(--preview-muted)" }}>
            This shows how cards will look with your brand.
          </p>
        </div>

        {/* Button samples */}
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded text-[10px] font-medium text-white"
            style={{ background: "var(--preview-accent)" }}
          >
            Primary Action
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded text-[10px] font-medium border"
            style={{ borderColor: "var(--preview-border)", color: "var(--preview-muted)" }}
          >
            Secondary
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/admin/BrandingPreview.tsx
git commit -m "feat: add BrandingPreview component for live brand preview"
```

---

### Task 6: BrandingQuickEdit Component (Layer B)

**Files:**
- Create: `apps/web/components/admin/BrandingQuickEdit.tsx`
- Modify: `apps/web/lib/actions/branding.ts` (add `saveSimpleBrand` action)

- [ ] **Step 1: Add saveSimpleBrand server action**

Modify `apps/web/lib/actions/branding.ts`: Add the import at the **top** of the file (after existing imports, NOT appended). Add the function body at the **end** of the file.

Add import at top (after line 3):
```ts
import { deriveThemeTokens } from "@/lib/branding-presets";

/**
 * Save brand from the simplified quick-edit form.
 * Takes only companyName, logoUrl, accent, fontFamily — derives the rest.
 */
export async function saveSimpleBrand(formData: FormData): Promise<void> {
  const companyName = readString(formData.get("companyName")) || "Open Digital Product Factory";
  const logoUrl = readString(formData.get("logoUrl")) || null;
  const accent = readString(formData.get("accent")) || "#7c8cf8";
  const fontFamily = readString(formData.get("fontFamily")) || "Inter, system-ui, sans-serif";

  const tokens = deriveThemeTokens(accent, { fontFamily });

  await prisma.brandingConfig.upsert({
    where: { scope: "organization" },
    update: { companyName, logoUrl, tokens: tokens as unknown as Prisma.InputJsonValue },
    create: { scope: "organization", companyName, logoUrl, tokens: tokens as unknown as Prisma.InputJsonValue },
  });

  revalidateBrandingSurfaces();
}
```

- [ ] **Step 2: Create BrandingQuickEdit client component**

```tsx
// apps/web/components/admin/BrandingQuickEdit.tsx
"use client";

import { useState } from "react";
import { saveSimpleBrand } from "@/lib/actions/branding";
import { BrandingPreview } from "./BrandingPreview";

type Props = {
  currentName: string;
  currentLogoUrl: string;
  currentAccent: string;
  currentFont: string;
  onRerunWizard: () => void;
};

const FONT_OPTIONS = [
  "Inter, system-ui, sans-serif",
  "Source Sans 3, Arial, sans-serif",
  "Space Grotesk, system-ui, sans-serif",
  "Lato, Arial, sans-serif",
  "Nunito, Arial, sans-serif",
  "Roboto, Arial, sans-serif",
  "Poppins, Arial, sans-serif",
];

export function BrandingQuickEdit({ currentName, currentLogoUrl, currentAccent, currentFont, onRerunWizard }: Props) {
  const [name, setName] = useState(currentName);
  const [logoUrl, setLogoUrl] = useState(currentLogoUrl);
  const [accent, setAccent] = useState(currentAccent);
  const [font, setFont] = useState(currentFont);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData();
    fd.set("companyName", name);
    fd.set("logoUrl", logoUrl);
    fd.set("accent", accent);
    fd.set("fontFamily", font);
    await saveSimpleBrand(fd);
    setSaving(false);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-white mb-1">Company Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-white mb-1">Logo URL</label>
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://example.com/logo.svg or /logos/file.svg"
            className="w-full px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-white mb-1">Accent Color</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="w-10 h-10 rounded border border-[var(--dpf-border)] cursor-pointer"
            />
            <input
              type="text"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="flex-1 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-white mb-1">Font Family</label>
          <select
            value={font}
            onChange={(e) => setFont(e.target.value)}
            className="w-full px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f}>{f.split(",")[0]}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded text-sm font-medium text-white"
            style={{ background: "var(--dpf-accent)" }}
          >
            {saving ? "Saving..." : "Save Brand"}
          </button>
          <button
            type="button"
            onClick={onRerunWizard}
            className="text-xs text-[var(--dpf-muted)] hover:text-white transition-colors underline"
          >
            Re-run setup wizard
          </button>
        </div>
      </form>

      {/* Live preview */}
      <BrandingPreview
        companyName={name}
        logoUrl={logoUrl}
        accentColor={accent}
        fontFamily={font}
      />
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/admin/BrandingQuickEdit.tsx apps/web/lib/actions/branding.ts
git commit -m "feat: add BrandingQuickEdit component with simplified brand editing"
```

---

### Task 7: BrandingWizard Component (Layer A)

**Files:**
- Create: `apps/web/components/admin/BrandingWizard.tsx`

- [ ] **Step 1: Create the BrandingWizard client component**

This is a multi-step wizard with 3 steps: Choose Source → Preview & Confirm → Fine-tune.

```tsx
// apps/web/components/admin/BrandingWizard.tsx
"use client";

import { useState } from "react";
import { OOTB_PRESETS, deriveThemeTokens, type ThemeTokens } from "@/lib/branding-presets";
import { saveSimpleBrand } from "@/lib/actions/branding";
import { BrandingPreview } from "./BrandingPreview";

type WizardStep = "choose" | "preview" | "finetune";

type Props = {
  /** Pre-populate with existing brand (re-run wizard mode) */
  existingName?: string;
  existingLogoUrl?: string;
  existingAccent?: string;
  existingFont?: string;
  onCancel?: () => void;
};

export function BrandingWizard({ existingName, existingLogoUrl, existingAccent, existingFont, onCancel }: Props) {
  const [step, setStep] = useState<WizardStep>("choose");
  const [name, setName] = useState(existingName ?? "");
  const [logoUrl, setLogoUrl] = useState(existingLogoUrl ?? "");
  const [accent, setAccent] = useState(existingAccent ?? "#7c8cf8");
  const [font, setFont] = useState(existingFont ?? "Inter, system-ui, sans-serif");
  const [saving, setSaving] = useState(false);

  function applyPreset(preset: typeof OOTB_PRESETS[number]) {
    setName(preset.companyName);
    setLogoUrl(preset.logoUrl);
    setAccent(preset.tokens.palette.accent);
    setFont(preset.tokens.typography.fontFamily);
    setStep("preview");
  }

  async function handleSave() {
    setSaving(true);
    const fd = new FormData();
    fd.set("companyName", name);
    fd.set("logoUrl", logoUrl);
    fd.set("accent", accent);
    fd.set("fontFamily", font);
    await saveSimpleBrand(fd);
    setSaving(false);
    // Page will revalidate and show quick-edit
  }

  if (step === "choose") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Set Up Your Brand</h2>
          <p className="text-sm text-[var(--dpf-muted)] mt-1">Choose how you'd like to establish your brand.</p>
        </div>

        {/* URL Import */}
        <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <h3 className="text-sm font-medium text-white mb-2">Import from URL</h3>
          <p className="text-xs text-[var(--dpf-muted)] mb-3">
            Paste your company website URL and we&apos;ll extract your brand colors and logo.
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="https://yourcompany.com"
              className="flex-1 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  // URL analysis will be wired in Task 10 (AI integration)
                }
              }}
            />
            <button
              type="button"
              className="px-4 py-2 rounded text-sm font-medium text-white"
              style={{ background: "var(--dpf-accent)" }}
            >
              Analyze
            </button>
          </div>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-2">
            Requires external access to be enabled in Settings.
          </p>
        </div>

        {/* Document Upload */}
        <div className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <h3 className="text-sm font-medium text-white mb-2">Upload Brand Document</h3>
          <p className="text-xs text-[var(--dpf-muted)] mb-3">
            Upload a brand guidelines PDF or image with your logo and colors.
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded border border-[var(--dpf-border)] text-sm text-[var(--dpf-muted)] hover:text-white cursor-pointer transition-colors">
            <span>Choose file</span>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.svg"
              className="hidden"
              onChange={() => {
                // Document analysis will be wired in Task 10 (AI integration)
              }}
            />
          </label>
        </div>

        {/* Preset picker */}
        <div>
          <h3 className="text-sm font-medium text-white mb-3">Or pick a preset</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {OOTB_PRESETS.map((preset) => (
              <button
                key={preset.scope}
                type="button"
                onClick={() => applyPreset(preset)}
                className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] hover:border-[var(--dpf-accent)] transition-colors text-left"
              >
                <div
                  className="w-full h-2 rounded-full mb-2"
                  style={{ background: preset.tokens.palette.accent }}
                />
                <p className="text-xs font-medium text-white">{preset.companyName}</p>
                <p className="text-[10px] text-[var(--dpf-muted)]" style={{ fontFamily: preset.tokens.typography.fontFamily }}>
                  {preset.tokens.typography.fontFamily.split(",")[0]}
                </p>
              </button>
            ))}
          </div>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[var(--dpf-muted)] hover:text-white transition-colors underline"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (step === "preview") {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Preview Your Brand</h2>
          <p className="text-sm text-[var(--dpf-muted)] mt-1">Here&apos;s how your platform will look.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-white mb-1">Company Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white mb-1">Accent Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="w-10 h-10 rounded border border-[var(--dpf-border)] cursor-pointer" />
                <span className="text-xs font-mono text-[var(--dpf-muted)]">{accent}</span>
              </div>
            </div>
          </div>

          <BrandingPreview companyName={name} logoUrl={logoUrl} accentColor={accent} fontFamily={font} />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded text-sm font-medium text-white"
            style={{ background: "var(--dpf-accent)" }}
          >
            {saving ? "Applying..." : "Looks good — apply"}
          </button>
          <button
            type="button"
            onClick={() => setStep("finetune")}
            className="px-4 py-2 rounded text-sm font-medium border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white transition-colors"
          >
            Let me adjust
          </button>
          <button
            type="button"
            onClick={() => setStep("choose")}
            className="text-xs text-[var(--dpf-muted)] hover:text-white transition-colors underline"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // step === "finetune"
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Fine-tune Your Brand</h2>
        <p className="text-sm text-[var(--dpf-muted)] mt-1">
          Adjust the basics below. For advanced changes, use the AI coworker in the panel.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white mb-1">Company Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white mb-1">Logo URL</label>
            <input type="text" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://example.com/logo.svg" className="w-full px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white mb-1">Accent Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="w-10 h-10 rounded border border-[var(--dpf-border)] cursor-pointer" />
              <input type="text" value={accent} onChange={(e) => setAccent(e.target.value)} className="flex-1 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-white mb-1">Font Family</label>
            <select value={font} onChange={(e) => setFont(e.target.value)} className="w-full px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-white text-sm">
              {["Inter, system-ui, sans-serif", "Source Sans 3, Arial, sans-serif", "Space Grotesk, system-ui, sans-serif", "Lato, Arial, sans-serif", "Nunito, Arial, sans-serif", "Roboto, Arial, sans-serif", "Poppins, Arial, sans-serif"].map((f) => (
                <option key={f} value={f}>{f.split(",")[0]}</option>
              ))}
            </select>
          </div>
        </div>

        <BrandingPreview companyName={name} logoUrl={logoUrl} accentColor={accent} fontFamily={font} />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded text-sm font-medium text-white"
          style={{ background: "var(--dpf-accent)" }}
        >
          {saving ? "Applying..." : "Apply Brand"}
        </button>
        <button
          type="button"
          onClick={() => setStep("preview")}
          className="text-xs text-[var(--dpf-muted)] hover:text-white transition-colors underline"
        >
          Back
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/admin/BrandingWizard.tsx
git commit -m "feat: add BrandingWizard component with 3-step setup flow"
```

---

### Task 8: Wire Branding Page with Wizard/QuickEdit State Logic

**Files:**
- Modify: `apps/web/app/(shell)/admin/branding/page.tsx`

- [ ] **Step 1: Replace placeholder branding page with real state logic**

Replace `apps/web/app/(shell)/admin/branding/page.tsx`:

```tsx
import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { BrandingPageClient } from "@/components/admin/BrandingPageClient";

export default async function AdminBrandingPage() {
  const activeBranding = await prisma.brandingConfig.findUnique({
    where: { scope: "organization" },
    select: {
      companyName: true,
      logoUrl: true,
      tokens: true,
    },
  });

  // Extract simple fields from stored tokens for quick-edit form
  let currentAccent = "#7c8cf8";
  let currentFont = "Inter, system-ui, sans-serif";

  if (activeBranding?.tokens && typeof activeBranding.tokens === "object") {
    const tokens = activeBranding.tokens as Record<string, unknown>;
    const palette = typeof tokens.palette === "object" && tokens.palette !== null ? tokens.palette as Record<string, unknown> : {};
    const typography = typeof tokens.typography === "object" && tokens.typography !== null ? tokens.typography as Record<string, unknown> : {};
    if (typeof palette.accent === "string") currentAccent = palette.accent;
    if (typeof typography.fontFamily === "string") currentFont = typography.fontFamily;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Brand Configuration</p>
      </div>
      <AdminTabNav />
      <BrandingPageClient
        hasExistingBrand={!!activeBranding}
        currentName={activeBranding?.companyName ?? ""}
        currentLogoUrl={activeBranding?.logoUrl ?? ""}
        currentAccent={currentAccent}
        currentFont={currentFont}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create BrandingPageClient for wizard/quick-edit toggling**

Create `apps/web/components/admin/BrandingPageClient.tsx`:

```tsx
"use client";

import { useState } from "react";
import { BrandingWizard } from "./BrandingWizard";
import { BrandingQuickEdit } from "./BrandingQuickEdit";

type Props = {
  hasExistingBrand: boolean;
  currentName: string;
  currentLogoUrl: string;
  currentAccent: string;
  currentFont: string;
};

export function BrandingPageClient({ hasExistingBrand, currentName, currentLogoUrl, currentAccent, currentFont }: Props) {
  const [showWizard, setShowWizard] = useState(!hasExistingBrand);

  if (showWizard) {
    return (
      <BrandingWizard
        existingName={hasExistingBrand ? currentName : undefined}
        existingLogoUrl={hasExistingBrand ? currentLogoUrl : undefined}
        existingAccent={hasExistingBrand ? currentAccent : undefined}
        existingFont={hasExistingBrand ? currentFont : undefined}
        onCancel={hasExistingBrand ? () => setShowWizard(false) : undefined}
      />
    );
  }

  return (
    <BrandingQuickEdit
      currentName={currentName}
      currentLogoUrl={currentLogoUrl}
      currentAccent={currentAccent}
      currentFont={currentFont}
      onRerunWizard={() => setShowWizard(true)}
    />
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(shell\)/admin/branding/page.tsx apps/web/components/admin/BrandingPageClient.tsx
git commit -m "feat: wire branding page with wizard/quick-edit state logic"
```

---

### Task 9: Remove Old BrandingConfigurator

**Files:**
- Remove: `apps/web/components/admin/BrandingConfigurator.tsx`
- Verify: no remaining imports reference it

- [ ] **Step 1: Search for any remaining imports of BrandingConfigurator**

Run: `cd apps/web && grep -r "BrandingConfigurator" --include="*.tsx" --include="*.ts" -l`

Expected: Only `components/admin/BrandingConfigurator.tsx` itself (and possibly test files). The admin `page.tsx` should have been cleaned up in Task 3 Step 4.

- [ ] **Step 2: Delete BrandingConfigurator.tsx**

```bash
rm apps/web/components/admin/BrandingConfigurator.tsx
```

- [ ] **Step 3: Run typecheck to confirm no broken imports**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -u apps/web/components/admin/BrandingConfigurator.tsx
git commit -m "chore: remove old BrandingConfigurator (replaced by wizard + quick edit)"
```

---

## Chunk 3: AI Integration & Agent Updates

### Task 10: Expand Form Assist for All Tokens

**Files:**
- Modify: `apps/web/components/admin/branding-form-assist.ts`
- Modify: `apps/web/components/admin/branding-form-assist.test.ts`

- [ ] **Step 1: Write failing test for expanded token fields**

Add these `it()` blocks **inside the existing** `describe("branding form assist", ...)` block in `apps/web/components/admin/branding-form-assist.test.ts`, after the existing test cases:

```ts
  it("applies surface color updates", () => {
    const next = applyBrandingFormAssistUpdates(baseState, {
      surfacesSidebar: "#1a1a2e",
    });
    expect(next.tokens.surfaces_sidebar).toBe("#1a1a2e");
  });

  it("applies state color updates", () => {
    const next = applyBrandingFormAssistUpdates(baseState, {
      statesSuccess: "#22c55e",
      statesError: "#ef4444",
    });
    expect(next.tokens.states_success).toBe("#22c55e");
    expect(next.tokens.states_error).toBe("#ef4444");
  });

  it("applies spacing and radius updates", () => {
    const next = applyBrandingFormAssistUpdates(baseState, {
      spacingMd: "16px",
      radiusSm: "4px",
    });
    expect(next.tokens.spacing_md).toBe("16px");
    expect(next.tokens.radius_sm).toBe("4px");
  });

  it("applies shadow updates", () => {
    const next = applyBrandingFormAssistUpdates(baseState, {
      shadowsCard: "0 8px 16px rgba(0,0,0,0.3)",
    });
    expect(next.tokens.shadows_card).toBe("0 8px 16px rgba(0,0,0,0.3)");
  });

  it("applies all palette colors", () => {
    const next = applyBrandingFormAssistUpdates(baseState, {
      paletteSurface1: "#222233",
      paletteSurface2: "#333344",
      paletteMuted: "#888899",
      paletteBorder: "#444455",
    });
    expect(next.tokens.palette_surface1).toBe("#222233");
    expect(next.tokens.palette_surface2).toBe("#333344");
    expect(next.tokens.palette_muted).toBe("#888899");
    expect(next.tokens.palette_border).toBe("#444455");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- branding-form-assist.test.ts`
Expected: FAIL — new token fields not handled

- [ ] **Step 3: Expand applyBrandingFormAssistUpdates to handle all tokens**

Replace `apps/web/components/admin/branding-form-assist.ts` (the source file only, NOT the test file). The new implementation is functionally equivalent for the existing 5 fields and adds support for all remaining tokens. All existing tests must continue to pass:

```ts
export type BrandingFormState = {
  companyName: string;
  logoUrl: string;
  tokens: Record<string, string>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Map from camelCase form assist field names to underscore token keys.
 * This is the full set of ~33 fields the AI coworker can adjust.
 */
const TOKEN_FIELD_MAP: Record<string, string> = {
  // Palette (6)
  paletteAccent: "palette_accent",
  paletteBg: "palette_bg",
  paletteSurface1: "palette_surface1",
  paletteSurface2: "palette_surface2",
  paletteMuted: "palette_muted",
  paletteBorder: "palette_border",
  // Surfaces (5)
  surfacesPage: "surfaces_page",
  surfacesPanel: "surfaces_panel",
  surfacesCard: "surfaces_card",
  surfacesSidebar: "surfaces_sidebar",
  surfacesModal: "surfaces_modal",
  // States (8)
  statesIdle: "states_idle",
  statesHover: "states_hover",
  statesActive: "states_active",
  statesFocus: "states_focus",
  statesSuccess: "states_success",
  statesWarning: "states_warning",
  statesError: "states_error",
  statesInfo: "states_info",
  // Typography (2)
  typographyFontFamily: "typography_fontFamily",
  typographyHeadingFontFamily: "typography_headingFontFamily",
  // Spacing (5)
  spacingXs: "spacing_xs",
  spacingSm: "spacing_sm",
  spacingMd: "spacing_md",
  spacingLg: "spacing_lg",
  spacingXl: "spacing_xl",
  // Radius (4)
  radiusSm: "radius_sm",
  radiusMd: "radius_md",
  radiusLg: "radius_lg",
  radiusXl: "radius_xl",
  // Shadows (3)
  shadowsPanel: "shadows_panel",
  shadowsCard: "shadows_card",
  shadowsButton: "shadows_button",
};

export function applyBrandingFormAssistUpdates(
  current: BrandingFormState,
  updates: Record<string, unknown>,
): BrandingFormState {
  const next: BrandingFormState = {
    companyName: current.companyName,
    logoUrl: current.logoUrl,
    tokens: { ...current.tokens },
  };

  if (isNonEmptyString(updates.companyName)) {
    next.companyName = updates.companyName.trim();
  }

  if (isNonEmptyString(updates.logoUrl)) {
    next.logoUrl = updates.logoUrl.trim();
  }

  for (const [fieldName, tokenKey] of Object.entries(TOKEN_FIELD_MAP)) {
    if (isNonEmptyString(updates[fieldName])) {
      next.tokens[tokenKey] = (updates[fieldName] as string).trim();
    }
  }

  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- branding-form-assist.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/branding-form-assist.ts apps/web/components/admin/branding-form-assist.test.ts
git commit -m "feat: expand branding form assist to all 33 theme tokens"
```

---

### Task 11: Update System Admin Agent & All Welcome Messages

**Files:**
- Modify: `apps/web/lib/agent-routing.ts`

- [ ] **Step 1: Update System Admin agent skills and system prompt**

In `apps/web/lib/agent-routing.ts`, find the `/admin` route entry (around line 274) and update:

1. Add to `systemPrompt` after the existing `INTERPRETIVE MODEL` paragraph:
```
BRANDING CONTEXT: The platform supports a full branding system. Theme tokens (palette colors, surface colors, typography, spacing, radius, shadows) are stored in BrandingConfig and applied as CSS variables at runtime. When the user wants to adjust branding via conversation, you can update any of the ~33 theme token fields through form assist. Field names use camelCase (e.g., paletteAccent, surfacesSidebar, statesSuccess, typographyFontFamily, radiusMd). When asked to make subjective changes like "warmer tones" or "darker sidebar", translate to specific hex values.
```

2. Add new skills to the skills array:
```ts
    skills: [
      { label: "Manage users", description: "User accounts and roles", capability: "manage_users", prompt: "Help me manage user accounts" },
      { label: "Set up branding", description: "Configure platform brand", capability: "manage_branding", prompt: "Help me set up the platform branding" },
      { label: "Import brand from URL", description: "Scrape brand from website", capability: "manage_branding", prompt: "I want to import our brand from a website URL" },
      { label: "Adjust theme colors", description: "Change brand colors and style", capability: "manage_branding", prompt: "I'd like to adjust the platform theme colors" },
      { label: "Access review", description: "Who has access to what?", capability: "view_admin", prompt: "Show me who has access to what capabilities" },
      { label: "Report an issue", description: "Report a bug or give feedback", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
```

- [ ] **Step 2: Update all 10 agent welcome messages in CANNED_RESPONSES**

Find the `CANNED_RESPONSES` object and replace each agent's `default` array with a single canonical greeting. Keep the `restricted` variant. Reference the table from the spec:

```ts
  "portfolio-advisor": {
    default: [
      "I'm your Portfolio Analyst. I can help you explore portfolio health, review budget allocations, and understand product groupings. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can see you're viewing the portfolio area. I can help explain what you see here, but some actions may require additional permissions.",
    ],
  },
  "inventory-specialist": {
    default: [
      "I'm the Product Manager. I can help you review product lifecycles, check stage-gate readiness, and explore the digital product inventory. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can help you understand the inventory view, but modifying products may require elevated permissions.",
    ],
  },
  "ea-architect": {
    default: [
      "I'm your Enterprise Architect. I can help you create architecture views, map relationships between components, and navigate ArchiMate models. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can help you explore the architecture models visible to your role.",
    ],
  },
  "hr-specialist": {
    default: [
      "I'm the HR Director. I can help you understand role structures, review team assignments, and navigate the organizational hierarchy. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can help you explore employee information visible to your role.",
    ],
  },
  "customer-advisor": {
    default: [
      "I'm the Customer Success Manager. I can help you review customer journeys, identify friction points, and track adoption metrics. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can help you explore customer data visible to your role.",
    ],
  },
  "ops-coordinator": {
    default: [
      "I'm the Scrum Master. I can help you manage the backlog, track epic progress, and prioritize work items. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can help you view the backlog, but creating or updating items may require additional permissions.",
    ],
  },
  "platform-engineer": {
    default: [
      "I'm the AI Ops Engineer. I can help you configure AI providers, review token spend, and optimize the AI workforce. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can explain the platform configuration, but changes require platform management permissions.",
    ],
  },
  "build-specialist": {
    default: [
      "I'm your Software Engineer. I can help you build features, review code, and guide you through the build process. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can help you explore what's been built, but starting new features may require additional permissions.",
    ],
  },
  "admin-assistant": {
    default: [
      "I'm the System Admin. I can help with user management, branding configuration, and platform settings. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "Administration features require admin-level access. I can help you navigate to areas within your permissions.",
    ],
  },
  "coo": {
    default: [
      "I'm the COO. I can help you get oriented across the platform — from portfolio health to backlog priorities to workforce status. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can help you navigate the workspace, but some cross-cutting features may require additional permissions.",
    ],
  },
  "workspace-guide": {
    default: [
      "I'm your Workspace Guide. I can help you find the right tools and navigate the portal. You can also explore more actions in the skills menu above.",
    ],
    restricted: [
      "I can help you navigate the workspace. Some areas may require specific role access.",
    ],
  },
```

Note: The `"workspace-guide"` key in `CANNED_RESPONSES` maps to no route and is dead code. Keep it for now but add a `// TODO: remove if no route maps to workspace-guide` comment. Use the exact agent IDs from `ROUTE_AGENT_MAP` for all entries.

- [ ] **Step 3: Run existing agent-routing tests**

Run: `cd apps/web && pnpm test -- agent-routing.test.ts`
Expected: PASS (or update tests if they assert on the old canned response arrays)

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agent-routing.ts
git commit -m "feat: update System Admin agent with branding skills, update all welcome messages"
```

---

### Task 12: Add Design Principles to AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Append Design Principles section to AGENTS.md**

Add after the existing "Communication" section at the end of the file:

```markdown

## Design Principles

These principles apply to all new UI development on the platform.

### Section Organization
- Use tab-nav with sub-routes for section organization (e.g., `/admin`, `/admin/branding`, `/admin/settings`)
- Follow the pattern established by EA Modeler, AI Workforce, and Ops — each TabNav component lives in `components/{area}/` and is rendered by each sub-route page
- When a section grows beyond one concern, split into tabs rather than cramming onto one page

### Progressive Disclosure
- Simple defaults for most users; AI coworker for advanced control
- Expose only essential fields (3-5) in manual forms
- Advanced configuration happens through the AI coworker conversation, not through raw field editors

### Setup Flows
- Wizard-first for initial configuration (when no data exists)
- Quick-edit form for returning users (when data already exists)
- "Re-run wizard" link available from quick-edit for starting over

### Welcome Messages
- All AI coworker agents use a consistent greeting format:
  1. Identity: "I'm [role name]."
  2. Capabilities: "I can help you [2-3 things]."
  3. Skills hint: "You can also explore more actions in the skills menu above."
- Single canonical greeting per agent (no random rotation)
- Restricted variant remains for permission-limited users

### Consistency
- Before creating new patterns, check existing components: TabNav variants, page layouts, route structure
- Follow established naming conventions: `{Area}TabNav`, `{Area}PageClient` for client wrapper components
- Server components fetch data and pass to client components for interactivity
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add design principles to AGENTS.md for consistent future development"
```

---

### Task 13: Add analyze_brand_document Tool

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Add tool definition to PLATFORM_TOOLS array**

In `apps/web/lib/mcp-tools.ts`, add to the `PLATFORM_TOOLS` array:

```ts
  {
    name: "analyze_brand_document",
    description: "Analyze an uploaded brand guidelines document (PDF or image) and extract brand assets: logo, colors, and fonts",
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Original filename" },
        fileContent: { type: "string", description: "Base64-encoded file content" },
        fileType: { type: "string", enum: ["pdf", "png", "jpg", "svg"], description: "File type" },
      },
      required: ["fileName", "fileContent", "fileType"],
    },
    requiredCapability: "manage_branding" as CapabilityKey,
    executionMode: "immediate",
  },
```

- [ ] **Step 2: Add tool execution handler in the executeTool function**

Find the `executeTool` or tool dispatch function and add a case for `analyze_brand_document`. The handler should send the document to the AI model with vision capabilities for analysis. The exact implementation depends on the existing `callWithFailover` pattern — follow the same pattern used by `analyze_public_website_branding`:

```ts
  if (toolName === "analyze_brand_document") {
    const { fileName, fileContent, fileType } = args as {
      fileName: string;
      fileContent: string;
      fileType: string;
    };

    // Use the AI model to analyze the document
    // This will be handled by the agent conversation loop —
    // the tool returns a structured analysis prompt
    return {
      success: true,
      message: `Analyzing brand document: ${fileName} (${fileType})`,
      data: {
        companyName: null,
        logoDataUrl: null,
        colors: [],
        fonts: [],
        notes: `Document "${fileName}" received for brand analysis. The AI agent should analyze the base64 content to extract brand assets.`,
      },
    };
  }
```

Note: The full vision-based extraction will be enhanced iteratively. This initial handler provides the structure; the AI coworker conversation loop does the actual analysis via its system prompt context.

- [ ] **Step 3: Run existing mcp-tools tests**

Run: `cd apps/web && pnpm test -- mcp-tools.test.ts`
Expected: PASS

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -m "feat: add analyze_brand_document tool definition for brand document import"
```

---

### Task 14: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd apps/web && pnpm test`
Expected: All tests PASS

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Verify the admin page renders without errors**

Start the dev server and manually navigate to:
- `/admin` — should show user listing only (no branding, no platform keys)
- `/admin/branding` — should show wizard (if no brand configured) or quick-edit (if configured)
- `/admin/settings` — should show platform keys panel

- [ ] **Step 4: Verify CSS injection works**

If a BrandingConfig with scope "organization" exists:
- Check page source or DevTools for an injected `<style>` tag with `:root { --dpf-* }` overrides
- Verify the accent color changes are reflected across the UI

- [ ] **Step 5: Commit any final fixes**

```bash
git commit -m "fix: final verification fixes for branding workflow redesign"
```
