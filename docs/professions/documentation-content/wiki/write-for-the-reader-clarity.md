---
title: Write for the reader — clarity first
pageKind: principle
status: published
abstract: Documentation is written for the reader, not to impress. Be conversational, write for a global audience, use second person and active voice, and put conditions before instructions. Prioritize clarity and consistency even over any single guideline.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Write clearly for the reader — second person, active voice, conditions before instructions, global audience — never to impress.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"human_cognitive_load": 0.8}
professionCompetencyLevel: foundational
sources:
  - google/dev-style
---

## Rule

Write for the **reader**, not to impress. Clarity is the goal of every documentation page.

## The Practices

From the Google developer documentation style guide:

- **Be conversational and friendly** without being frivolous.
- **Write for a global audience** — assume diverse readers, languages, and abilities; write accessibly.
- **Use second person** ("you," not "we") and **active voice** so it is clear who performs each action.
- **Put conditions before instructions, not after** — readers must know whether a step applies *before* they act.
- **Prioritize clarity and consistency** for your readers even when it means deviating from a specific guideline.

## Why

Documentation exists to transfer understanding with minimum reader effort. Passive voice, jargon, and conditions-after-the-fact all increase cognitive load and cause errors (a reader completes a step that did not apply to them). Writing for a global audience also widens reach and supports accessibility.

## How To Apply

1. **Second person, active voice** by default.
2. **Condition first:** "If you use X, do Y" — not "Do Y, if you use X."
3. **Cut to impress nobody** — remove words that add length but not clarity.
4. Combine with the right mode — see [[professions/documentation-content/choose-the-right-documentation-mode]].

## See Also

- [[professions/documentation-content/choose-the-right-documentation-mode]]
- [[professions/documentation-content/diataxis-four-modes]]
