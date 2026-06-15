---
title: Choose the right documentation mode — don't mix them
pageKind: principle
status: published
abstract: Before writing, decide which user need a page serves and commit to that Diataxis mode. Reference describes only; how-to guides give action only; explanation stays apart from practice. Mixing modes is the root of many documentation failures.
principleTier: core
principleDirection: Write each page in exactly one Diataxis mode for one user need; never blend tutorial, how-to, reference, and explanation in one page.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"human_cognitive_load": 0.7, "long_term_maintainability": 0.5}
professionCompetencyLevel: practitioner
sources:
  - diataxis/framework
  - diataxis/reference
  - diataxis/how-to-guides
  - diataxis/explanation
---

## Rule

The four Diataxis modes serve **different user needs**. Before writing, decide which need the page serves and **commit to that mode** — do not blend learning, task, information, and understanding material in one page.

## Why

Each mode has a discipline, and mixing them serves none of the needs well:

- **Reference** should "describe and only describe" — keep instruction and explanation out of it.
- **How-to guides** should give "action and only action" — not teach mechanics a competent user already has.
- **Explanation** belongs apart from active practice — the material you might read away from the keyboard.

Conflating tutorials with how-to guides is, per Diataxis, "at the root of many difficulties that afflict documentation." A page trying to teach, instruct, list facts, and explain at once overwhelms the reader and is hard to maintain.

## How To Apply

1. **Name the need first.** Is the reader learning, doing, looking up, or understanding?
2. **Pick one mode** ([[professions/documentation-content/diataxis-four-modes]]) and hold its discipline.
3. **Split, don't blend.** If you need two modes, write two pages and link them.

## See Also

- [[professions/documentation-content/diataxis-four-modes]]
- [[professions/documentation-content/tutorials-vs-how-to-guides]]
