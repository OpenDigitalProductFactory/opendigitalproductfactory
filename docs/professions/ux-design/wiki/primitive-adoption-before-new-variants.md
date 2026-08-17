---
title: Primitive adoption before new variants
pageKind: principle
status: published
abstract: Reach for the canonical UI primitive — and extend it when it falls short — before hand-rolling a variant. A screen built from adopted primitives inherits consistency, theming, and accessibility for free; every hand-rolled variant re-decides all three and drifts on each. When a needed primitive does not exist, shipping it with its adoption ratchet is UX work, not a detour from it.
principleTier: core
principleDirection: Compose surfaces from the canonical design-system primitives and extend the primitive when it falls short; treat a hand-rolled variant of an existing primitive as a design defect, not a style choice.
principleDimensionVector: {"long_term_maintainability": 0.8, "human_cognitive_load": -0.7, "reusability": 0.9, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: false
principlePublicRationale: ""
sources:
  - nng/ten-heuristics
  - w3c/wcag22
---

## Rule

When a surface needs a control or pattern, the order is fixed: **use** the canonical primitive; if it falls short, **extend** the primitive so every consumer benefits; only when the pattern is genuinely novel, **create** a new primitive — with its spec and adoption ratchet, so it is the last variant rather than the next one. Hand-rolling a local variant of an existing primitive (a bespoke badge, a local status→color map, an inline card string, a raw `<button>` with copied classes) is a design defect even when it looks identical today, because it will not look identical after the next theme, token, or accessibility change.

## Why

Consistency-and-standards is a first-order usability heuristic: users should never wonder whether two things that look different mean the same thing. A design system delivers it only through adoption — the 2026-08-16 architecture pass measured what voluntary adoption produces on this platform: the same card markup string repeated 727 times across 426 files, 296 copies of the accent-button string, 1,321 raw `<button>` sites, ~48 local status-color maps and ~10 bespoke badges bypassing `StatusBadge`, nine dialog implementations, and `text-white` (346 occurrences) as the largest theme violation — traceable to a missing `--dpf-on-accent` token, i.e., to a primitive gap that each screen then patched locally. Every one of those local decisions is also an unreviewed accessibility decision: contrast, focus, target size, and dark-theme behavior are exactly what the canonical primitive centralizes.

## How to apply

In critique and review, flag hand-rolled variants of existing primitives as defects and name the primitive that should replace them. When the primitive is missing something (a token, a size, a state), file and fix the gap **in the primitive** — the `--dpf-on-accent` case shows how a token gap manufactures hundreds of violations downstream. When scoring design options, weigh primitive-composed options higher on `reusability` and lower on `ux-design/perceptual_clutter` (adopted primitives keep spacing/alignment coherent by construction). Respect the platform's UX budgets: primitives are also how word-count and density ceilings stay enforceable.

## Decision dimensions

- `reusability: 0.9` — the primitive is the reuse; the variant is its negation.
- `human_cognitive_load: -0.7` — negative: consistent controls remove per-screen relearning.
- `long_term_maintainability: 0.8` — theme/token/a11y changes propagate through primitives, not through 727 copies.
- `speed_to_value: -0.2` — extending a primitive is slower than copying a class string, once.

## Related

- [[professions/ux-design/ten-usability-heuristics-summary]] — consistency-and-standards is the heuristic this operationalizes.
- [[professions/ux-design/design-accessibility-from-the-start-pour]] — primitives are where POUR properties are enforced once.
