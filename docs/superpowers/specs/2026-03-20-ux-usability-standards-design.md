# EP-UX-STANDARDS: Platform-Wide UI/UX Usability Standards

**Status:** Draft
**Date:** 2026-03-20
**Epic:** UI/UX Usability Standards
**Scope:** WCAG 2.2 AA enforcement across all UI surfaces — portal branding injection, hardcoded color remediation (full sweep), save-time contrast validation with auto-correct, form element usability standards, contrast assertion tests, usability documentation
**Dependencies:** EP-UX-001 (Light Mode UX Theme — implemented), EP-BRANDING-001 (Branding Workflow Redesign — implemented)

---

## Problem Statement

EP-UX-001 delivered the foundational theming infrastructure: dual token derivation (dark + light), `contrastRatio()` and `ensureContrast()` utilities, CSS variable system (`--dpf-*`), and WCAG AA-compliant OOTB presets. However, the platform still has significant gaps in consistent adoption:

- The portal layout is 100% hardcoded dark hex colors — no branding injection, no CSS variables
- Workspace components (calendar, activity feed), agent UI (FAB, message bubbles, panels), and storefront containers use hardcoded hex values that break in light mode
- The branding save flow performs no contrast validation — users can save non-compliant configurations
- Form elements lack standardized accessible states (focus indicators, placeholder contrast, disabled styling)
- `globals.css` input styling overrides theme variables with hardcoded colors
- No automated tests verify contrast compliance across token pairs
- No documented usability standards exist for developers or AI agents to reference

These gaps mean that despite having a robust theming engine, the platform does not consistently deliver accessible interfaces.

## Goals

1. Every UI surface (admin shell, portal, storefront, agent UI) uses CSS variables exclusively for token roles — no hardcoded hex for bg, text, surface, border, accent, or muted
2. Portal layout receives full branding injection matching the shell architecture
3. Branding save flow validates all configurable color pairs and auto-corrects violations, reporting corrections to the admin
4. All form elements platform-wide have accessible baseline states via `@layer components`
5. Automated Vitest tests verify WCAG AA compliance for all presets, both modes, and all critical color pairs
6. A living usability standards document serves as the source of truth for all UI development

## Non-Goals

- Playwright/screenshot-based visual regression tests (follow-up epic if needed)
- WCAG AAA compliance (AA is the target)
- `prefers-contrast` / high-contrast mode support
- Per-component theme overrides or scoped theming
- User-facing light/dark toggle (OS preference drives mode)

---

## Design

### 1. Portal Branding Injection

The portal layout (`(portal)/layout.tsx`) currently hardcodes ~7 hex colors as inline styles (`#0d0d18`, `#1a1a2e`, `#e0e0ff`, `#2a2a40`, `#8888a0`, `#7c8cf8`). No branding is fetched, no CSS variables are used.

**Change:** Adopt the same branding pipeline as the shell layout:

1. Fetch `BrandingConfig` for the organization scope (same Prisma query pattern as `(shell)/layout.tsx`)
2. Call `buildBrandingStyleTag()` to inject CSS variables into the page `<head>`
3. Replace all inline hex values with `var(--dpf-*)` references:
   - `#0d0d18` → `var(--dpf-bg)`
   - `#1a1a2e` → `var(--dpf-surface-1)`
   - `#e0e0ff` → `var(--dpf-text)`
   - `#2a2a40` → `var(--dpf-border)`
   - `#8888a0` → `var(--dpf-muted)`
   - `#7c8cf8` → `var(--dpf-accent)`
4. Pass both `logoUrl` and `logoUrlLight` for CSS-based logo switching
5. Portal auth pages (sign-in, registration) inherit the org brand automatically

The `(portal-auth)/` route group receives the same treatment if it has its own layout.

**Result:** Portal is architecturally identical to the shell — same branding pipeline, same CSS variables, same light/dark mode support via `prefers-color-scheme`.

### 2. Hardcoded Color Remediation (Full Sweep)

Every component with hardcoded hex colors for token roles is migrated to `var(--dpf-*)`. No component is deferred.

**Admin Shell:**
- `NavBar.tsx` — `hover:text-white` → `hover:text-[var(--dpf-text)]` (Header.tsx already remediated in EP-UX-001)
- `CalendarEventPopover.tsx` (`components/workspace/`) — 12+ inline hex values (`#1a1a2e`, `#2a2a40`, `#0d0d18`) → CSS variables
- `WorkspaceCalendar.tsx` — remaining hardcoded values: `textColor: "#fff"` on event objects and `rgba(124,140,248,...)` hover colors → `var(--dpf-text)`, `var(--dpf-accent)` (injected `<style>` block already partially remediated in EP-UX-001)
- `ActivityFeed` — hardcoded category colors (`#a78bfa`, `#38bdf8`, `#fb923c`, `#4ade80`, `#8888a0`) serve as category identifiers → map to `ThemeTokens.states` values or derive as accent-hue variants with opacity, ensuring 3:1 contrast on `palette.bg`

**Agent UI:**
- `AgentFAB`, `MessageBubble`, agent panels — all hardcoded dark hex → CSS variables
- These components use `--dpf-surface-1`, `--dpf-surface-2`, `--dpf-text`, `--dpf-accent`, `--dpf-border`

**Storefront:**
- Storefront layout container (`(storefront)/s/[slug]/layout.tsx`) — remove hardcoded inline `background: "#ffffff", color: "#111827"` (layout already calls `buildBrandingStyleTag()` for CSS variable injection; the inline styles override the injected variables and must be removed so the CSS variables take effect)
- `SignInForm.tsx` — full remediation: border `#d1d5db` → `var(--dpf-border)`, error text `#dc2626` → `var(--dpf-states-error, #dc2626)`, social button backgrounds/text (`#fff`, `#000`, `#374151`, `#6b7280`) → CSS variables
- Social buttons / linked identities — status badges, dividers → CSS variables

**Portal:**
- Covered by Section 1 above

**globals.css:**
- Input/select/textarea forced colors (`#111827` text, `#ffffff` bg) → `var(--dpf-text)`, `var(--dpf-surface-1)`

**Scope of remediation:** The components listed above are the known high-impact files identified via codebase audit. However, `text-white` alone appears in ~357 instances across ~94 files. During implementation, a full grep sweep for `text-white`, `text-black`, `bg-white`, `bg-black`, `#fff`, `#000`, and inline `color:` / `background:` with hex values identifies the complete list. Every file containing token-role hex violations is in scope — the enumerated list above is the starting point, not the boundary.

**Rule:** No component may use literal hex colors for any token role (bg, text, surface, border, accent, muted). Hex is allowed only for:
- Semantic status colors defined in `ThemeTokens.states` (which are themselves theme-derived)
- SVG brand marks and third-party logos
- Third-party component overrides where CSS variables cannot be injected

### 3. Save-Time Contrast Validation (Warn + Auto-Correct)

When a branding config is saved via `saveSimpleBrand()`, `saveActiveThemePreset()`, or `saveThemePreset()`, a validation pipeline runs after token derivation and before the database write.

**Validation pipeline:**

1. Generate dual tokens as today
2. For each mode (light and dark), check all configurable color pairs against WCAG AA minimums:

| Foreground | Background(s) | Min Ratio | Standard |
|---|---|---|---|
| `palette.text` | `palette.bg`, `palette.surface1`, `palette.surface2` | 4.5:1 | Text readability |
| `palette.muted` | `palette.bg`, `palette.surface1` | 4.5:1 | Secondary text |
| `palette.accent` | `palette.bg` | 4.5:1 | Interactive text/links |
| `palette.accent` | `palette.surface1` | 3:1 | UI components (WCAG 2.2 AA non-text) |
| `palette.border` | `palette.bg`, `palette.surface1` | 3:1 | Non-text UI elements |
| `states.focus` | `palette.bg`, `palette.surface1` | 3:1 | Focus indicators |
| `states.success` | `palette.bg` | 3:1 | Status indicators |
| `states.warning` | `palette.bg` | 3:1 | Status indicators |
| `states.error` | `palette.bg` | 3:1 | Status indicators |
| `states.info` | `palette.bg` | 3:1 | Status indicators |
| `palette.text` | `surfaces.panel` | 4.5:1 | Text on panels |
| `palette.text` | `surfaces.card` | 4.5:1 | Text on cards |
| `palette.text` | `surfaces.sidebar` | 4.5:1 | Text on sidebar |
| `palette.text` | `surfaces.modal` | 4.5:1 | Text on modals |

3. Any failing pair → `ensureContrast()` nudges the foreground color to compliance
4. Collect all adjustments into a `corrections[]` array:
   ```ts
   type Correction = {
     mode: "light" | "dark";
     foreground: string;      // e.g. "palette.muted"
     background: string;      // e.g. "palette.bg"
     original: string;        // original hex
     corrected: string;       // corrected hex
     originalRatio: number;   // e.g. 2.3
     correctedRatio: number;  // e.g. 4.6
   };
   ```
5. Save the corrected tokens to the database
6. Return `corrections[]` to the caller

**`palette.text` in advanced editor:** `buildThemeTokens()` currently omits `palette_text` from form data. Add it so the advanced preset editor can configure text color. The simple brand flow (`saveSimpleBrand()`) continues to derive text automatically.

**Return type change:** All three save functions change from `Promise<void>` to `Promise<{ corrections: Correction[] }>`. Callers (`BrandingWizard.tsx`, `BrandingQuickEdit.tsx`) must be updated to capture the return value and display corrections. The `Correction` type is exported from `branding-presets.ts` alongside `validateTokenContrast()`.

**Advanced editor validation:** `saveThemePreset()` and `saveActiveThemePreset()` accept raw form tokens for the dark palette but auto-derive light. The validation pipeline runs on both modes regardless of origin. When raw form tokens fail contrast checks, `ensureContrast()` auto-corrects them — the same behavior as derived tokens. The corrections banner transparently shows the admin what was adjusted, so they can revise their manual choices if desired.

**`validateTokenContrast()` function:** Extracted into `branding-presets.ts` as a public export. Wraps `ensureContrast()` (which remains internal) and returns `{ correctedTokens: ThemeTokens, corrections: Correction[] }`. All three save functions call it for each mode before the database write.

**UI feedback:** The branding wizard/quick-edit shows a dismissible banner after save listing any corrections: *"Your muted text was adjusted from #AAAAAA to #737373 in light mode to meet accessibility standards (was 2.3:1, now 4.6:1)."* No blocking, no modal — transparent information. `BrandingWizard.tsx` and `BrandingQuickEdit.tsx` also receive their own hardcoded color remediation as part of Section 2 (they currently use `text-white` for button text).

**No corrections needed:** No banner. Silent success.

### 4. Form Element Usability Standards (`@layer components`)

A `@layer components` block in `globals.css` establishes baseline usability for all form elements platform-wide. The layer sits above `base` but below Tailwind `utilities`, so intentional overrides via utility classes still work, but the accessible baseline is always present.

**Standards enforced:**

| Rule | Implementation |
|---|---|
| Focus indicator | `outline: 2px solid var(--dpf-accent); outline-offset: 2px` — 3:1 contrast guaranteed via save-time validation |
| Placeholder text | `color: var(--dpf-muted)` — 4.5:1 contrast guaranteed via save-time validation |
| Background | `background: var(--dpf-surface-1)` |
| Text color | `color: var(--dpf-text)` |
| Border | `border-color: var(--dpf-border)` — 3:1 guaranteed |
| Disabled state | `opacity: 0.5; cursor: not-allowed` — visually distinct without relying on color alone |
| Selected/active | `border-color: var(--dpf-accent)` — distinct from default state |

**Select/option styling:**
- `<option>` elements get explicit `background: var(--dpf-surface-1); color: var(--dpf-text)` — prevents browser-default styling conflicts in dark mode
- Selected option highlight uses `var(--dpf-accent)` at 15% opacity for background

**Layer placement:** The form element styles are placed inside `@layer components { ... }` in `globals.css`, positioned between the existing `@tailwind base` and `@tailwind utilities` directives. Tailwind already manages its own layer ordering via these directives — the explicit `@layer components` block participates in the same cascade. No separate `@layer` declaration line is needed; the block implicitly joins Tailwind's `components` layer.

**Regression prevention:** Because these styles apply at the CSS layer level to element selectors (`input`, `select`, `textarea`), any future form element automatically inherits the standards. Regression requires explicit `!important` or inline styles — both are code-reviewable violations of the documented standards.

### 5. Contrast Assertion Tests

Vitest-based unit tests that programmatically verify every theme token pair meets WCAG AA. These run on every PR with no browser dependency.

**Test structure:**

```
describe("WCAG AA compliance")
  for each OOTB preset (6 presets × 2 modes = 12 token sets):
    - palette.text on palette.bg ≥ 4.5:1
    - palette.text on palette.surface1 ≥ 4.5:1
    - palette.text on palette.surface2 ≥ 4.5:1
    - palette.muted on palette.bg ≥ 4.5:1
    - palette.muted on palette.surface1 ≥ 4.5:1
    - palette.accent on palette.bg ≥ 4.5:1
    - palette.accent on palette.surface1 ≥ 3:1
    - palette.border on palette.bg ≥ 3:1
    - states.focus on palette.bg ≥ 3:1
    - palette.text on surfaces.panel ≥ 4.5:1
    - palette.text on surfaces.card ≥ 4.5:1
    - palette.text on surfaces.sidebar ≥ 4.5:1
    - palette.text on surfaces.modal ≥ 4.5:1
    - states.success/warning/error/info on palette.bg ≥ 3:1

  for edge-case accents:
    - very light yellow (#FFE74C) → deriveThemeTokens() passes all checks
    - very dark blue (#0a0a3a) → deriveThemeTokens() passes all checks
    - pure white (#FFFFFF) → ensureContrast() corrects appropriately
    - pure black (#000000) → ensureContrast() corrects appropriately

  for save-time validation:
    - deliberately non-compliant custom tokens → corrections[] populated with correct entries
    - already-compliant tokens → corrections[] empty
```

**Location:** Extends the existing `apps/web/lib/branding-presets.test.ts`. Many of the preset-level contrast checks already exist — the new tests add expanded pair coverage (surfaces, states), edge-case accents, and save-time validation logic.

### 6. Usability Standards Documentation

A living reference document at `docs/platform-usability-standards.md` — the source of truth for all UI development, referenced by developers and AI agents when generating or reviewing UI code.

**Contents:**

1. **Color System** — CSS variable inventory (`--dpf-bg`, `--dpf-surface-1`, `--dpf-surface-2`, `--dpf-text`, `--dpf-accent`, `--dpf-muted`, `--dpf-border`), purpose of each token, when to use which
2. **Contrast Requirements** — minimum ratios per element type (text 4.5:1, UI components 3:1), where enforcement happens (derivation time via `ensureContrast()`, save time via validation pipeline)
3. **Form Elements** — required states (default, focus, active, disabled), the `@layer components` baseline, when overrides are acceptable
4. **Prohibited Patterns** — no literal hex in component styles for token roles, no `text-white`/`text-black`, no inline style objects with hardcoded colors
5. **Allowed Hex Usage** — theme-derived `states.*` colors referenced from tokens, SVG brand marks, third-party logos
6. **Component Checklist** — quick reference: "does my component use `var(--dpf-*)` for all backgrounds, text, borders, and accents?"
7. **Standards Referenced** — WCAG 2.2 AA, EN 301 549, Section 508, CSS Media Queries Level 5

**AGENTS.md update:** Add a pointer so AI agents consult this document when generating or reviewing UI code.

---

## Data Model

**No schema changes.** The `BrandingConfig.tokens` JSON field already stores `DualThemeTokens` (implemented in EP-UX-001). The only data-level change is adding `palette_text` to `buildThemeTokens()` form data reading.

## Files Affected

**Modified files (enumerated — full sweep via grep identifies additional files):**
- `apps/web/app/(portal)/layout.tsx` — branding injection, CSS variable adoption
- `apps/web/app/(portal-auth)/` — branding injection if separate layout exists
- `apps/web/app/(storefront)/s/[slug]/layout.tsx` — remove hardcoded inline styles (layout already calls `buildBrandingStyleTag()`)
- `apps/web/app/globals.css` — `@layer components` form element styles, remove hardcoded input colors; position `@layer` declaration relative to existing `@tailwind` directives
- `apps/web/lib/actions/branding.ts` — add `palette_text` to `buildThemeTokens()`, add contrast validation pipeline to all save functions, change return type to `Promise<{ corrections: Correction[] }>`
- `apps/web/lib/branding-presets.ts` — export `validateTokenContrast()` function wrapping `ensureContrast()`, export `Correction` type
- `apps/web/lib/branding-presets.test.ts` — expanded WCAG AA tests (all pairs, edge cases, save-time validation)
- `apps/web/components/shell/NavBar.tsx` — `hover:text-white` → `hover:text-[var(--dpf-text)]` (Header.tsx already remediated)
- `apps/web/components/workspace/WorkspaceCalendar.tsx` — remaining hardcoded: `textColor: "#fff"`, rgba accent hover colors
- `apps/web/components/workspace/CalendarEventPopover.tsx` — inline hex → CSS variables
- `apps/web/components/workspace/ActivityFeed` — hardcoded category colors → theme-aware
- Agent UI components (AgentFAB, MessageBubble, panels) — hardcoded hex → CSS variables
- `apps/web/components/storefront/SignInForm.tsx` — full remediation (border, error text, social button bg/text, muted text)
- Social buttons / linked identities components — status badges, dividers → CSS variables
- `apps/web/components/admin/BrandingWizard.tsx` — display corrections banner after save, remediate own `text-white` violations
- `apps/web/components/admin/BrandingQuickEdit.tsx` — display corrections banner after save, remediate own `text-white` violations
- All additional files identified by grep sweep for `text-white`, `text-black`, `bg-white`, `bg-black`, and inline hex patterns
- `AGENTS.md` — add pointer to usability standards document

**New files:**
- `docs/platform-usability-standards.md` — living usability standards reference

## Testing Strategy

- **Unit tests (Vitest):** All 6 presets × 2 modes × all critical color pairs pass WCAG AA minimums
- **Edge-case tests:** Extreme accent colors (very light, very dark, white, black) produce compliant tokens via auto-correction
- **Save-time validation tests:** Non-compliant custom tokens produce correct `corrections[]` entries; compliant tokens produce empty `corrections[]`
- **`contrastRatio()` verification:** Known test vectors (black/white = 21:1, white/white = 1:1, #767676/white ≥ 4.5:1)
- **Form element tests:** Verify `@layer components` styles apply to unstyled form elements (can be tested via CSS assertion or visual smoke test)
- **Grep audit:** CI or manual grep confirms no remaining hardcoded hex for token roles in component files (excluding allowed patterns)

## Demo Story

An admin configures their brand in the wizard — picks an accent color that's borderline for light mode. Save succeeds, and a subtle banner reports: "Your accent was adjusted from #FFE74C to #B8A200 in light mode to meet accessibility standards." The admin navigates to the portal — it reflects their brand in both light and dark mode, matching the admin shell. They open a form — inputs have clear focus rings, readable placeholders, and distinct disabled states. A new developer joins and writes a component — the `@layer components` baseline ensures their form elements are accessible without any extra work. The usability standards doc is their reference. The CI pipeline runs contrast assertion tests and catches any preset regression before merge.
