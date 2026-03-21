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
