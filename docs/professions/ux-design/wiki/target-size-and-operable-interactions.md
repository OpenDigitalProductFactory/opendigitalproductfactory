---
title: Target size and operable interactions (WCAG 2.5.8)
pageKind: principle
status: published
abstract: Pointer targets should be at least 24×24 CSS pixels (WCAG 2.2 AA, 2.5.8), with exceptions for adequately-spaced, inline, or user-agent-sized targets. Interactions must be operable beyond the pointer, including by keyboard.
principleTier: core
principleDirection: Size pointer targets at least 24x24 CSS px (or space them adequately) and keep all interactions keyboard-operable.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.8, "human_cognitive_load": 0.5}
professionCompetencyLevel: practitioner
sources:
  - w3c/wcag22
---

## Rule

Per WCAG 2.2 success criterion **2.5.8 (Target Size — Minimum, Level AA)**, the target for pointer inputs should be **at least 24 by 24 CSS pixels**, with defined exceptions:

- **Spacing** — a smaller target is acceptable when it has adequate spacing around it.
- **Inline** — targets within a sentence (e.g. links in text) are excluded.
- **User-agent / essential** — targets sized by the user agent, or where a particular size is essential, are excepted.

More broadly, the **Operable** principle requires interface components and navigation to be operable — including by keyboard, not pointer alone.

## Why

Small, tightly-packed targets are hard to hit for users with motor impairments, tremor, or touch input, causing errors and accidental activation. The 24px floor (plus spacing) gives a reliable hit area; keyboard operability ensures pointer-free use.

## How To Apply

1. **Size or space.** Make interactive targets ≥24×24 CSS px, or guarantee adequate spacing.
2. **Keyboard parity.** Everything tappable is also keyboard-operable (pairs with [[professions/ux-design/design-accessibility-from-the-start-pour]]).
3. **Pair with contrast** — a target must be both big enough and visible enough ([[professions/ux-design/color-contrast-minimums]]).

## See Also

- [[professions/ux-design/color-contrast-minimums]]
- [[professions/ux-design/design-accessibility-from-the-start-pour]]
- [[professions/ux-design/accessibility-tradeoffs-aaa]]
