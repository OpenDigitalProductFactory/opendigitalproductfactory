---
title: No Hardcoded Colors
pageKind: principle
status: published
abstract: All UI uses CSS custom properties so light mode, dark mode, and branding work automatically.
principleTier: commandment
principleDirection: Bind every UI color to a theme token; never hardcode hex, Tailwind gray-*, or inline style colors.
principleDimensionVector: {"long_term_maintainability": 0.9, "reusability": 0.7, "schema_grounding": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts:
  - ui
principlePublic: true
principlePublicRationale: DPF's branding system is a product feature — adopters configure colors at install time and expect the UI to follow. Hardcoded colors break that contract.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

All UI binds colors to CSS custom properties so light mode, dark mode, and per-tenant branding all work automatically. No hardcoded hex (`#ff8800`), no Tailwind gray-* / white / black classes for text or surfaces, no inline `style={{ color: "..." }}`. The token table in `AGENTS.md §12` enumerates the canonical bindings; the variables are defined in `globals.css` and overridden at runtime by the tenant's branding configuration.

## Why

The branding system is a contract with every adopter: at install time they pick their org colors, and the platform's UI follows. That contract breaks the moment a component hardcodes a color — the component renders the wrong color for every tenant whose brand differs from the default. The compounding cost: as the codebase grows, every hardcoded color is a future bug report ("the dark mode is broken on the storefront inquiries page") and every fix is a hunt across dozens of files. Binding to tokens from day one eliminates that whole bug class.

## Applies To

In-platform coworkers building portal components, external coding agents authoring UI changes, and humans reviewing UI PRs. Symmetric. Applies to every visible surface: backgrounds, borders, text, accents, hover states, focus rings. The single documented exception is `text-white` on `bg-[var(--dpf-accent)]` buttons (because the accent color is the variable that determines contrast).

## How To Apply

Use the token table from `AGENTS.md §12`: `text-[var(--dpf-text)]` for body / heading text, `text-[var(--dpf-muted)]` for secondary text, `bg-[var(--dpf-surface-1)]` / `bg-[var(--dpf-surface-2)]` for surfaces, `border-[var(--dpf-border)]` for borders, `text-[var(--dpf-accent)]` / `bg-[var(--dpf-accent)]` for accent, `bg-[var(--dpf-bg)]` for page background. Inline styles use `var(--dpf-text)` etc. directly. `<option>` elements need explicit `bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]` because browsers ignore inherited styles there. Anything else — anywhere — is the failure mode the principle exists to prevent.

## Decision Dimensions

- `long_term_maintainability: 0.9` — hardcoded colors are the most common UI debt; binding to tokens is the cheapest prevention.
- `reusability: 0.7` — token-bound components compose across themes and tenants; hardcoded components do not.
- `schema_grounding: 0.5` — the token set IS the UI schema; aligning with it keeps components composable.

## Examples

- **Positive:** A new chip component uses `bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] border border-[var(--dpf-border)]`. Light mode, dark mode, and three tenant brands all render correctly with zero per-tenant CSS.
- **Counterexample:** A new admin page uses `bg-gray-100 text-gray-900` inherited from a Tailwind example. The dark-mode user sees light-gray-on-light-gray text. The tenant with a custom brand sees the default gray instead of their accent. Three bug reports later, the page is rewritten to use tokens.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
