---
title: Color contrast minimums (WCAG 1.4.3)
pageKind: principle
status: published
abstract: Normal text must meet a contrast ratio of at least 4.5:1 against its background; large text may use 3:1 (WCAG 2.2 AA). Enhanced AAA raises these to 7:1 and 4.5:1.
principleTier: core
principleDirection: Meet at least 4.5:1 contrast for normal text and 3:1 for large text; never ship text below the AA minimum.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.9, "human_cognitive_load": 0.5}
professionCompetencyLevel: foundational
sources:
  - w3c/wcag22
  - webaim/contrast
---

## Rule

Text must meet WCAG 2.2 success criterion **1.4.3 (Contrast Minimum, Level AA)**:

- **Normal text:** contrast ratio of **at least 4.5:1** against its background.
- **Large text:** a reduced minimum of **3:1**. Large is defined as 18pt+ (≈24px) or 14pt+ bold (≈18.67px).
- **Exempt:** logotypes and inactive/disabled UI components.

For **enhanced (AAA)** conformance the minimums rise to **7:1** for normal text and **4.5:1** for large text.

## Why

Insufficient contrast makes text unreadable for users with low vision, color vision deficiency, or in bright-light/low-quality-display conditions. The ratio is normative in the open WCAG standard; WebAIM's contrast guidance explains and tooling it. Contrast is one of the most frequently failed — and most easily measured — accessibility criteria.

## How To Apply

1. **Measure, don't eyeball.** Use a contrast checker on every text/background pair.
2. **Bake into design tokens.** Encode AA-passing pairs so the palette can't produce a failing combination.
3. **Don't sacrifice it for minimalism** — see the trade-off note in [[professions/ux-design/accessibility-tradeoffs-aaa]].
4. This is part of designing to [[professions/ux-design/design-accessibility-from-the-start-pour]].

## See Also

- [[professions/ux-design/design-accessibility-from-the-start-pour]]
- [[professions/ux-design/target-size-and-operable-interactions]]
- [[professions/ux-design/accessibility-tradeoffs-aaa]]
