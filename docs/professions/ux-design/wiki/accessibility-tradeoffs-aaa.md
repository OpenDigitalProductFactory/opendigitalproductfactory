---
title: Accessibility trade-offs and AAA targets
pageKind: principle
status: published
abstract: AAA conformance raises minimums (e.g. 7:1 contrast) but is generally not a blanket requirement — apply it selectively where audience and context warrant. Minimalist aesthetics must never drop below the AA floor.
principleTier: contextual
principleDirection: Default to AA; apply AAA selectively by audience/context; never let aesthetics breach the AA minimums.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.7, "human_cognitive_load": 0.5}
professionCompetencyLevel: expert
sources:
  - webaim/contrast
  - w3c/wcag22
  - nng/ten-heuristics
---

## Rule

Treat **AA as the default** and apply **AAA selectively**. AAA raises the bar — for example **7:1** contrast for normal text and **4.5:1** for large — but WCAG itself notes AAA is not recommended as a blanket policy for entire sites; apply it where the audience and context genuinely warrant it (e.g. content for low-vision users).

## The Expert Trade-off

This is the expert-tier page because it is about **balancing competing goods**:

- **Aesthetic/minimalist design vs perceivability** — minimalism (Heuristic 8) must not push text or controls below the AA floor. A beautiful low-contrast palette that fails 4.5:1 is a defect, not a style choice.
- **Designing complex interactions inclusively** — satisfying POUR simultaneously across keyboard, pointer, and assistive technology, where a richer interaction can conflict with operability.
- **Selective AAA** — choose where the extra rigor pays off rather than chasing AAA everywhere and exhausting design budget.

## How To Apply

1. **AA is the floor, always.** Never trade it for aesthetics — see [[professions/ux-design/color-contrast-minimums]].
2. **Target AAA deliberately** for high-need audiences/contexts; document the choice.
3. **Resolve interaction conflicts** in favor of operability ([[professions/ux-design/target-size-and-operable-interactions]]).

## See Also

- [[professions/ux-design/color-contrast-minimums]]
- [[professions/ux-design/target-size-and-operable-interactions]]
- [[professions/ux-design/design-accessibility-from-the-start-pour]]
