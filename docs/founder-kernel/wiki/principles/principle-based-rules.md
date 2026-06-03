---
title: Principle-Based Rules Over Enumeration
pageKind: principle
status: published
abstract: Prefer one durable principle to an enumerated list of cases. Principles scale across the changing universe of nouns; lists lag and require maintenance.
principleTier: core
principleDirection: When drafting rules for AI coworkers or platform doctrine, write the principle that generalizes. Add specific examples only to prevent a known rationalization pattern — never as the rule itself.
principleDimensionVector: {"long_term_maintainability": 0.9, "reusability": 0.8, "human_cognitive_load": 0.4, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: DPF's posture on rule authoring is that principles outlast the enumerated lists they replace. Adopters and contributors should expect this style across kernel pages, coworker prompts, and platform doctrine.
sources: []
---

## Rule

When drafting rules for AI coworkers (or any platform doctrine), prefer a single principle that scales over an enumerated list of nouns or cases. The rule is the principle; the examples are illustrations that prevent specific rationalization patterns, not the rule itself.

## Why

The universe of possibilities on the platform keeps expanding — UI, financial, customer, employee, inventory, compliance, archetype-specific surfaces, new integrations. Enumerated lists always lag reality: every new noun forces a rule update, and every update is a coordination point that can be missed. A principle like "every claim must be grounded in referential evidence" covers every current and future domain without edits. The rewrite of rule 12 in `identity-block.prompt.md` on 2026-04-17 is the canonical case: after an AI Ops Engineer coworker fabricated UI controls that didn't exist ("Set as default" button), the fix was to swap the enumerated list of forbidden behaviors for a principle about referential grounding. The new wording generalized across every UI surface, financial claim, employee status assertion, and inventory count — the old list would have needed updates for each.

## Applies To

In-platform coworkers authoring prompts and rule docs, external coding agents updating doctrine, and humans writing kernel pages. Symmetric. Applies to coworker prompts, kernel principles, governance policies, MCP-tool descriptions, and any other rule-shaped document.

## How To Apply

- When proposing a coworker rule change, first draft the principle. Test it by asking "does this generalize across the domains we know about today, and across domains we'll have next year?" If yes, the principle is the rule.
- Only add specific examples if they are needed to prevent a known rationalization pattern (e.g. "training knowledge is not referential evidence" prevents the "but the model says it knows" rationalization). The example is the guardrail; the principle is the rule.
- Avoid enumerating nouns the rule applies to. Trust the principle to generalize. An enumeration of "UI elements, financial records, employee statuses, inventory counts" telegraphs that the rule will break on the next noun, and trains future authors to keep extending the list.
- When reviewing a rule that already enumerates, propose the principle replacement — even if the existing list is currently complete, the next addition to the platform will make it incomplete silently.
- For meta-rules about rule authoring itself (this one), the same standard applies: prefer the principle "rules should be principles" over "rules should not enumerate UI elements, should not enumerate financial fields, should not enumerate…".

## Decision Dimensions

- `long_term_maintainability: 0.9` — the principle pays compounding dividends as the platform's surface grows; the enumerated list accumulates compounding maintenance cost.
- `reusability: 0.8` — a principle written once applies across coworker prompts, kernel pages, and external developer docs; an enumerated list has to be re-curated for each surface.
- `human_cognitive_load: 0.4` — principles are slightly harder to read than a checklist on first encounter, but they cover ten times the ground; net win for the reader who has to apply them to a new domain.
- `speed_to_value: -0.2` — slight negative. Writing the principle takes more thought than dashing off a list of nouns. The investment is recovered the first time a new noun would have forced a list update.

## Examples

- **Positive:** Rule 12 in `identity-block.prompt.md` after the 2026-04-17 rewrite — "every claim must be grounded in referential evidence" with a single guardrail clarifying that training knowledge does not count as referential. Covers UI controls, financial figures, employee statuses, inventory counts, and the next domain we add.
- **Counterexample:** The original rule 12 was an enumeration of forbidden fabrications: "Do not invent UI controls, do not invent financial values, do not invent employee statuses…" Each item required maintenance, and the rule failed on the AI Ops Engineer case because "I told the operator there was a Set as default button" didn't match any enumerated item literally — only the principle would have caught it.

## See Also

- `consult-specs-first` (core) — the principle-vs-enumeration choice often turns on a spec; consulting it surfaces whether a principle is already documented.
- `tools-must-be-self-documenting` (core) — tool descriptions are a special case of rule authoring; same preference applies.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
