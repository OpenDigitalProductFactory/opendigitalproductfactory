# Dark-Theme Development Guidelines

Reference for developers and AI agents building UI components on the platform. These rules ensure every surface respects the user's chosen brand and works correctly in both dark and light modes.

## Surface Hierarchy

The platform uses a layered surface model. Each layer is slightly lighter than the one beneath it to create visual depth without using shadows.

```
Layer 0: --dpf-bg          Page background (darkest)
Layer 1: --dpf-surface-1   Cards, panels, form inputs
Layer 2: --dpf-surface-2   Nested surfaces, dropdown menus, tooltips (lightest)
```

**Rules:**
- Never place surface-1 content on a surface-1 background — use surface-2 or bg
- Dropdown `<option>` elements need explicit `bg-[var(--dpf-surface-2)]` for cross-browser consistency
- Modal overlays use bg with opacity for the backdrop, surface-1 for the dialog body

## Text & Contrast

| Role | Variable | Min Contrast | Notes |
|------|----------|-------------|-------|
| Primary text | `--dpf-text` | 4.5:1 on bg, surface-1, surface-2 | Body copy, headings, labels |
| Muted text | `--dpf-muted` | 4.5:1 on bg, surface-1 | Secondary info, timestamps, placeholders |
| Interactive | `--dpf-accent` | 4.5:1 on bg, surface-1 | Links, buttons, active states |

**Validation:** The branding system's `ensureContrast()` automatically nudges derived colors to meet minimums. You don't need to calculate ratios manually — but if you override tokens, verify with a contrast checker.

**Common mistake:** Using Tailwind's `text-gray-400` or similar utility classes. These produce different results in light vs dark mode and bypass the branding system. Always use `text-[var(--dpf-muted)]` instead.

## Border Contrast

Borders must meet WCAG 2.2 AA for UI components: **3:1 ratio** against the adjacent background.

```tsx
// Correct
<div className="border border-[var(--dpf-border)]">

// Wrong — hardcoded color bypasses branding
<div className="border border-gray-700">
```

## Focus Indicators

Focus styles are provided by `@layer components` in `globals.css`. Do not override them.

```css
/* Already provided — DO NOT redefine */
*:focus-visible {
  outline: 2px solid var(--dpf-accent);
  outline-offset: 2px;
}
```

If a component needs a custom focus style (rare), it must still use `--dpf-accent` and maintain 3:1 contrast.

## Disabled States

Disabled elements use `opacity: 0.5` with `cursor: not-allowed`. This is applied globally via `@layer components`. Do not add custom disabled styling unless the component has a specific interaction pattern (e.g., a disabled button that shows a tooltip explaining why).

## Font Sizing

| Element | Minimum Size | Tailwind Class |
|---------|-------------|---------------|
| Body text | 14px | `text-sm` (14px) or `text-base` (16px) |
| Form labels | 12px | `text-xs` (12px) |
| Form inputs, buttons | 13px | `text-[13px]` or `text-sm` |
| Small metadata | 11px | `text-[11px]` |
| **Hard floor** | **10px** | Never go below this |

## Prohibited Patterns

These will break in light mode, user-configured branding, or both:

```tsx
// NEVER
<div className="text-white bg-[#1a1a2e] border-gray-700">
<p style={{ color: "#e0e0e0" }}>

// ALWAYS
<div className="text-[var(--dpf-text)] bg-[var(--dpf-bg)] border-[var(--dpf-border)]">
<p style={{ color: "var(--dpf-text)" }}>
```

**One exception:** `text-white` on `bg-[var(--dpf-accent)]` buttons — white text on a colored button background is intentional and always readable.

## Validation Checklist

Before submitting any UI component:

- [ ] All backgrounds use `var(--dpf-bg)`, `var(--dpf-surface-1)`, or `var(--dpf-surface-2)`
- [ ] All text uses `var(--dpf-text)` or `var(--dpf-muted)`
- [ ] All borders use `var(--dpf-border)`
- [ ] All interactive elements use `var(--dpf-accent)`
- [ ] No `text-white`, `text-black`, `bg-white`, `bg-black` Tailwind classes (except button exception)
- [ ] No inline hex colors for any token role
- [ ] No text smaller than 10px
- [ ] Form labels at least 12px
- [ ] `<option>` elements have explicit surface-2 background
- [ ] Component renders in both dark and light mode (toggle OS preference)
- [ ] Focus indicators visible and use accent color

## How to Verify Contrast

1. **Browser DevTools:** Inspect element > Computed > color/background-color > contrast ratio shown
2. **axe DevTools extension:** Run accessibility audit, filter for "color-contrast" violations
3. **Platform tool:** Use `evaluate_page` coworker tool which runs axe-core via Playwright
4. **Manual:** Use WebAIM Contrast Checker (webaim.org/resources/contrastchecker)

## Standards Referenced

- WCAG 2.2 Level AA (W3C Recommendation)
- EN 301 549 (European ICT Accessibility Standard)
- `docs/platform-usability-standards.md` (canonical token reference)
- `AGENTS.md` Theme-Aware Styling section (agent guardrails)
