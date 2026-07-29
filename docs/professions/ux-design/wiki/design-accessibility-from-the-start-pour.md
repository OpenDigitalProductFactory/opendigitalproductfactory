---
title: Design for accessibility from the start (POUR)
pageKind: principle
status: published
abstract: Accessibility is built in from project inception, not retrofitted. All UI must satisfy the four POUR principles — Perceivable, Operable, Understandable, Robust — and depends on multiple components working together.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Design to POUR from the first wireframe; never defer accessibility to a late retrofit.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "human_cognitive_load": 0.5}
professionCompetencyLevel: foundational
sources:
  - w3c/wcag22
  - w3c/wai-intro
---

## Rule

Design for accessibility **from the start**. All UI must satisfy the four **POUR** principles:

- **Perceivable** — "information and user interface components must be presentable to users in ways they can perceive."
- **Operable** — navigation and interface components must be operable, including by keyboard, not pointer alone.
- **Understandable** — information and operation must be understandable.
- **Robust** — content must remain compatible with assistive technologies.

## Why

The W3C WAI is explicit that accessibility is **most efficient when incorporated from project inception**, not retrofitted — late fixes are costly and incomplete. Accessibility also depends on **multiple components working together** (the content, browsers, assistive technologies, and authoring tools), so it must be a design constraint, not a final QA pass.

## How To Apply

1. **Start with POUR.** Treat the four principles as design constraints from the first wireframe.
2. **Bake in the measurables** — contrast ([[professions/ux-design/color-contrast-minimums]]) and target size ([[professions/ux-design/target-size-and-operable-interactions]]).
3. **Design for assistive tech**, keyboard, and varied abilities — see [[professions/ux-design/what-is-accessibility-wai]].

## See Also

- [[professions/ux-design/what-is-accessibility-wai]]
- [[professions/ux-design/color-contrast-minimums]]
- [[professions/ux-design/target-size-and-operable-interactions]]
