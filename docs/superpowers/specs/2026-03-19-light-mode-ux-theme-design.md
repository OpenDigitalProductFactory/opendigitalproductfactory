# EP-UX-001: Light Mode UX Theme

**Status:** Draft
**Date:** 2026-03-19
**Epic:** Light Mode UX Theme
**Scope:** Dual light/dark palette derivation, CSS-only theme switching via `prefers-color-scheme`, WCAG AA contrast enforcement, accessibility policy, branding preview updates
**Dependencies:** EP-BRANDING-001 (Branding Workflow Redesign — already implemented)

---

## Problem Statement

The platform is dark-mode only. All CSS variables, OOTB presets, and the `deriveThemeTokens()` algorithm generate a single dark palette. Users whose OS is set to light mode see a dark site regardless — a poor experience that also conflicts with accessibility standards requiring respect for user preferences.

The branding system already has forward-looking infrastructure:
- `BrandingConfig.logoUrlLight` exists in the schema (unused)
- The branding import classifies logos as "dark-bg" or "light-bg"
- The entire UI references CSS variables (`--dpf-*`) for most colors, though some components have hardcoded hex values that need remediation

What's missing: a light palette derivation algorithm, a `--dpf-text` token (body text color is currently hardcoded), CSS emission that responds to OS preference, contrast validation, hardcoded color remediation in affected components, and a formal accessibility policy governing color scheme choices.

## Goals

1. Both light and dark modes render correctly out of the box for any brand configuration
2. OS preference (`prefers-color-scheme`) drives mode selection — no toggle UI, no JS required
3. All generated palettes meet WCAG 2.2 AA contrast ratios (4.5:1 text, 3:1 UI components)
4. All 6 OOTB presets work in both modes automatically
5. Logo switches between `logoUrl` (dark mode) and `logoUrlLight` (light mode) via CSS
6. A platform-seeded accessibility policy documents the standards enforced
7. Branding preview shows both light and dark variants

## Non-Goals

- User-facing light/dark toggle (OS preference is the mechanism)
- `prefers-contrast` / high-contrast mode (noted in policy as future enhancement)
- Per-component theme overrides or scoped theming
- WCAG AAA compliance (AA is the target; AAA is aspirational)

---

## Design

### 1. Light Palette Derivation

Extend `deriveThemeTokens()` in `lib/branding-presets.ts` to return both variants:

```ts
type DualThemeTokens = {
  dark: ThemeTokens;
  light: ThemeTokens;
};

function deriveThemeTokens(accent: string, opts?): DualThemeTokens
```

**New token: `--dpf-text`** — A text color token is added to `ThemeTokens.palette`. Currently body text color is hardcoded as `#e2e2f0` in `globals.css`. This new token enables mode-aware text color.

**Dark mode** (existing logic, plus `--dpf-text`):
- Backgrounds: very dark desaturated (#0f0f1a range)
- Text (`--dpf-text`): light (#e2e2f0)
- Surfaces: dark grays (#1a1a2e, #161625)
- Accent at full saturation
- Muted: cool gray (#8888a0)
- Shadows: higher opacity (0.35–0.45 alpha) appropriate for dark surfaces

**Light mode** (new, algorithmically derived from same accent):
- Page background: #fafafa
- Surface 1 (cards, panels): #ffffff
- Surface 2 (secondary surfaces): #f4f4f6
- Text (`--dpf-text`): #1a1a2e
- Muted text: mid-gray, guaranteed >= 4.5:1 against white
- Borders: #d4d4dc
- Accent: same hue as dark mode, darkened if needed to meet 4.5:1 against white background
- States (hover, active, focus, success, warning, error, info): derived with appropriate contrast for light backgrounds
- Shadows: lower opacity (0.08–0.15 alpha) for subtle elevation on light surfaces

**Derivation approach:** The light palette mirrors the dark palette's structure but inverts the luminance relationship. Backgrounds are high-luminance, text is low-luminance. The accent color's hue and saturation are preserved; only lightness is adjusted via HSL (not RGB scaling) to meet contrast requirements while preserving perceptual hue. Surface hierarchy is maintained through subtle luminance steps (white > near-white > light gray) rather than the dark mode's dark gray steps. Shadow opacity is reduced to match light-mode design conventions.

### 2. CSS Variable Emission

`buildBrandingStyleTag()` in `lib/branding.ts` currently emits a single `:root` block. Change to emit dual blocks:

```css
:root {
  /* Light mode tokens — default */
  --dpf-bg: #fafafa;
  --dpf-surface-1: #ffffff;
  --dpf-surface-2: #f4f4f6;
  --dpf-text: #1a1a2e;
  --dpf-accent: #2563eb;
  --dpf-muted: #6b7280;
  --dpf-border: #d4d4dc;
  --dpf-font-body: Inter, system-ui, sans-serif;
  --dpf-font-heading: Inter, system-ui, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Dark mode tokens — override */
    --dpf-bg: #0f0f1a;
    --dpf-surface-1: #1a1a2e;
    --dpf-surface-2: #161625;
    --dpf-text: #e2e2f0;
    --dpf-accent: #7c8cf8;
    --dpf-muted: #8888a0;
    --dpf-border: #2a2a40;
    --dpf-font-body: Inter, system-ui, sans-serif;
    --dpf-font-heading: Inter, system-ui, sans-serif;
  }
}
```

**Key properties:**
- Light is the web-standard default; dark overrides via media query
- Browsers without `prefers-color-scheme` support (~4%) get light mode (safe baseline)
- No JavaScript required — pure CSS, instant switching, works before hydration
- `--dpf-text` is a new token — `globals.css` body rule changes from `color: #e2e2f0` to `color: var(--dpf-text)`
- Fonts and spacing tokens are shared across both modes (no mode-specific typography)

**`globals.css` update:** The hardcoded `:root` defaults follow the same light-first + dark media query pattern, serving as the fallback when no `BrandingConfig` exists in the database.

### 3. Contrast Validation

Add a `contrastRatio(color1: string, color2: string): number` utility to `lib/branding-presets.ts` using the WCAG relative luminance formula:

```
L = 0.2126 * R + 0.7152 * G + 0.0722 * B  (where R, G, B are linearized)
contrast = (L1 + 0.05) / (L2 + 0.05)       (L1 = lighter)
```

**Validation rules applied during `deriveThemeTokens()`:**

| Pair | Minimum Ratio | Standard |
|------|---------------|----------|
| Text on page background | 4.5:1 | WCAG 2.2 AA |
| Text on surface-1 | 4.5:1 | WCAG 2.2 AA |
| Muted text on page background | 4.5:1 | WCAG 2.2 AA |
| Accent on page background | 4.5:1 | WCAG 2.2 AA (interactive text) |
| Accent on surface-1 | 3:1 | WCAG 2.2 AA (UI components) |
| Border on page background | 3:1 | WCAG 2.2 AA (non-text) |

**Enforcement:** After deriving each palette (light and dark), every critical pair is checked. If a pair fails, the foreground color is nudged — darkened for light mode, lightened for dark mode — in small increments until the ratio passes. This runs at `saveSimpleBrand()` time (server action), so stored tokens are guaranteed compliant.

**Dev warning:** If nudging changes a color by more than 10% lightness from the original derivation, log a console warning in development mode. This helps admins understand when their accent color is borderline for one mode.

### 4. Schema Change

The `BrandingConfig.tokens` JSON field currently stores a flat `ThemeTokens` object. Change to store:

```ts
{
  dark: ThemeTokens;
  light: ThemeTokens;
}
```

**Migration:** A one-time migration script (run as part of the deployment seed step, not inside `buildBrandingStyleTag()`) detects flat `ThemeTokens` in existing `BrandingConfig` records, treats them as the dark variant, derives the light variant using `deriveThemeTokens()` with the stored accent color, and writes the dual-format tokens back to the database. `buildBrandingStyleTag()` remains a stateless CSS-generation function with no database writes. If it encounters flat tokens (e.g., migration hasn't run yet), it falls back to generating the light variant on the fly for rendering only — it does not persist.

### 5. OOTB Preset Updates

All 6 existing presets regenerated with both variants:

| Preset | Accent | Notes |
|--------|--------|-------|
| Corporate Blue | `#2563eb` | Darkened to ~#1d4ed8 in light mode for contrast |
| Warm Earth | `#d97706` | May need significant darkening in light mode |
| Modern Dark | `#8b5cf6` | Works well in both modes |
| Clean Minimal | `#6b7280` | Neutral — minimal adjustment needed |
| Ocean Teal | `#0d9488` | Good contrast natively |
| Forest Green | `#16a34a` | Good contrast natively |

The contrast validation (Section 3) handles any needed adjustments automatically. No manual per-preset tuning required.

### 6. Branding Preview Updates

`BrandingPreview.tsx` currently shows a single preview panel. Update to show a **side-by-side** light and dark preview so the admin can see both variants when configuring the brand.

**Layout:** Two preview panels, labeled "Light" and "Dark", each showing the same sample content (header, card, button, text) with their respective token sets applied via scoped inline CSS variable overrides.

The `BrandingWizard.tsx` Step 2 (Preview & confirm) and `BrandingQuickEdit.tsx` live preview both use this updated component.

### 7. Logo Switching

The `logoUrl` field stores the dark-background logo (light/white logo). The `logoUrlLight` field stores the light-background logo (dark logo). The branding import already classifies these.

**Approach:** The Header component currently renders `<img src={logoSource}>` where `logoSource` is a React prop from the server. A CSS variable cannot drive an `<img src>` attribute. Instead:

- The server-side `(shell)/layout.tsx` passes **both** `logoUrl` and `logoUrlLight` to the Header component (currently only `logoUrl` is fetched — add `logoUrlLight` to the Prisma select)
- The Header component renders **two** `<img>` tags (one per variant), each wrapped in a container that uses CSS `display: none` / `display: block` toggled via `prefers-color-scheme` media query classes
- Tailwind's `dark:` variant or a small CSS utility class handles the visibility toggle

```css
.logo-light { display: block; }
.logo-dark { display: none; }
@media (prefers-color-scheme: dark) {
  .logo-light { display: none; }
  .logo-dark { display: block; }
}
```

**Fallback:** If only one logo variant exists, render a single `<img>` with no visibility toggle.

### 8. Hardcoded Color Remediation

Several components use hardcoded hex colors that will break in light mode. These must be updated to use CSS variables:

**Components requiring changes:**
- `globals.css` — body `color: #e2e2f0` → `color: var(--dpf-text)`
- `components/admin/BrandingPreview.tsx` — hardcoded `color: "#fff"` throughout → use preview-scoped text color variable; hardcoded dark defaults (`#0f0f1a`, `#15151f`) → accept both token sets as props
- `components/workspace/WorkspaceCalendar.tsx` — injected `<style>` block uses hardcoded `#e0e0ff`, `#7c8cf8` → replace with `var(--dpf-text)`, `var(--dpf-accent)`
- `components/calendar/CalendarSyncPanel.tsx` — `text-white` Tailwind class → `text-[var(--dpf-text)]`
- `components/shell/Header.tsx` — `hover:text-white` → `hover:text-[var(--dpf-text)]`

**Scope:** Only components with hardcoded colors that conflict with light mode are changed. Components already using `var(--dpf-*)` or Tailwind theme colors need no changes. A codebase grep for hardcoded `#fff`, `#e2e2f0`, `#e0e0ff`, `text-white` in component files identifies the full list during implementation.

### 9. Accessibility Policy

A new policy is seeded during platform setup via the existing policy management system (EP-POL-001).

**Policy metadata:**
- Title: "UX Accessibility — Color & Theme Standards"
- Category: "it"
- Lifecycle status: "published"
- Version: 1
- Review frequency: "annual"

**Policy content:**

> **1. Minimum Standard: WCAG 2.2 AA**
> All platform-generated color palettes must meet WCAG 2.2 Level AA contrast ratios. Normal text requires 4.5:1 contrast against its background. Large text (18pt+ or 14pt bold) and UI components require 3:1. This is enforced algorithmically at palette generation time.
>
> **2. OS Preference Respected**
> The platform respects the user's operating system color scheme preference via the CSS `prefers-color-scheme` media query. No manual toggle is provided. Light mode is the default for clients that do not report a preference.
>
> **3. Color Never Conveys Meaning Alone**
> Per WCAG 1.4.1, color must not be the sole means of conveying information. All color-coded elements (status badges, alerts, chart segments) must include supplementary indicators: icons, labels, patterns, or positional cues.
>
> **4. Both Modes Are First-Class**
> Every UI component must render correctly in both light and dark modes. Components that reference theme tokens via CSS variables (`--dpf-*`) satisfy this automatically. Custom colors or hardcoded hex values are prohibited in component styles.
>
> **5. Algorithmic Enforcement**
> Contrast validation runs at palette generation time, not as a manual review step. The `deriveThemeTokens()` function guarantees all critical color pairs meet the minimum ratios before tokens are stored.
>
> **6. Future Enhancements (Not Yet Implemented)**
> - `prefers-contrast` media query for high-contrast mode
> - `prefers-reduced-motion` for animation preferences
> - WCAG AAA compliance (7:1 text, 4.5:1 large text)
>
> **7. Standards Referenced**
> - WCAG 2.2 (W3C Recommendation)
> - EN 301 549 (European ICT Accessibility Standard)
> - Section 508 (US Federal Accessibility)
> - CSS Media Queries Level 5 (`prefers-color-scheme`)
> - Material Design 3 Dark Theme Guidelines (surface luminance)

**Requirements attached to policy:**
- Type: "acknowledgment", Frequency: "once", Applicability: "All developers"
- Description: "Acknowledge that you have read and will follow the color and theme accessibility standards when building UI components."

---

## Data Model

**Modified:**
- `BrandingConfig.tokens` — JSON field changes from `ThemeTokens` to `{ dark: ThemeTokens, light: ThemeTokens }`

**No new tables.** The accessibility policy uses the existing `Policy`, `PolicyRequirement`, and `PolicyAcknowledgment` models.

## Files Affected

**Modified files:**
- `lib/branding-presets.ts` — `deriveThemeTokens()` returns `DualThemeTokens`; add `--dpf-text` to `ThemeTokens.palette`; add `contrastRatio()` utility and validation loop; HSL-based color nudging; mode-specific shadow opacity; update all 6 OOTB presets
- `lib/branding.ts` — `buildBrandingStyleTag()` emits light-first `:root` + dark `@media` block; stateless fallback for flat tokens; accepts `logoUrl` + `logoUrlLight`
- `app/globals.css` — update hardcoded defaults to light-first with dark media query; body `color` uses `var(--dpf-text)`; add `.logo-light`/`.logo-dark` utility classes
- `lib/actions/branding.ts` — `saveSimpleBrand()`, `saveActiveThemePreset()`, and `saveThemePreset()` all store dual token sets; contrast validation before save
- `app/(shell)/layout.tsx` — add `logoUrlLight` to Prisma select; pass both logo URLs to Header
- `components/shell/Header.tsx` — dual `<img>` tags with CSS visibility toggle for logo switching; replace `hover:text-white`
- `components/admin/BrandingPreview.tsx` — accept both token sets as props; replace hardcoded `#fff` text; side-by-side light/dark preview
- `components/admin/BrandingWizard.tsx` — preview step uses updated dual preview
- `components/admin/BrandingQuickEdit.tsx` — live preview uses updated dual preview
- `components/workspace/WorkspaceCalendar.tsx` — replace hardcoded hex colors in injected `<style>` with CSS variable references
- `components/calendar/CalendarSyncPanel.tsx` — replace `text-white` with theme-aware class
- Additional components identified by hardcoded color grep during implementation

**New files:**
- None anticipated. All changes fit within existing files.

**Seed data / migration:**
- Migration script upgrades flat `BrandingConfig.tokens` to `{ dark, light }` format
- Policy seed script adds "UX Accessibility — Color & Theme Standards" policy with one acknowledgment requirement

## Testing Strategy

- Verify `deriveThemeTokens()` produces valid light and dark token sets for all 6 presets
- Verify all critical color pairs pass WCAG AA contrast ratios in both modes
- Verify `contrastRatio()` utility returns correct values against known test vectors (e.g., white on white = 1:1, black on white = 21:1)
- Verify HSL-based nudging corrects failing pairs without distorting hue
- Verify `buildBrandingStyleTag()` emits correct CSS with media query structure
- Verify `buildBrandingStyleTag()` gracefully falls back when given flat (pre-migration) tokens
- Verify `globals.css` defaults render correctly in both modes
- Verify logo switches between variants based on color scheme (dual `<img>` visibility)
- Verify branding preview shows both modes side-by-side
- Verify migration script upgrades flat token records to dual format
- Verify `saveActiveThemePreset()` and `saveThemePreset()` produce dual tokens
- Verify policy is seeded on fresh platform setup
- Grep-based audit: confirm no remaining hardcoded `#e2e2f0`, `#e0e0ff`, or `color: "#fff"` in component files
- Visual smoke test: load the platform in both OS modes and verify readability

## Demo Story

Customer downloads the platform and runs the branding wizard — pastes their company URL, system extracts their brand. The admin preview shows both light and dark variants side-by-side. Save. Users with a light OS preference see the site in light mode with the dark logo; users with a dark OS preference see the dark theme with the light logo. Zero configuration beyond the brand setup. The accessibility policy is already published, documenting why the platform makes these choices.
