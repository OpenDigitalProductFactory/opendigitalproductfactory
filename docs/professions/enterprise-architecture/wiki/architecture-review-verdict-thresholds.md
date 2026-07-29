---
title: Architecture review verdict thresholds
pageKind: principle
status: published
abstract: An architecture review returns a verdict, not a question. Aligned-with-minor-adjustments is a pass — recommend proceeding and carry each adjustment as a named required change. Reserve revise-before-building for findings that would entrench a defect, and escalate to a human only when the review itself cannot be settled from the architecture description.
principleTier: core
principleDirection: Return a verdict at the severity the findings justify; only a defect-entrenching finding blocks the build, and unresolved-by-the-reviewer is the only reason to escalate.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"legibility_of_consequence": 0.7, "speed_to_value": 0.6, "governance_compliance": 0.5, "human_cognitive_load": -0.7, "operator_effort": -0.6}
professionCompetencyLevel: expert
sources:
  - iso/42010
  - opengroup/togaf
  - nygard/adr
  - dpf/agents-rulebook
---

## Rule

An architecture review exists to **decide**, and its verdict must be graded to the worst finding it made — no higher.

| Worst finding | Verdict | What travels with it |
| --- | --- | --- |
| None, or wording/clarity only | **Proceed** | Optional notes |
| Minor — real, fixable inside the current design, does not change the design's shape | **Proceed** | Each adjustment named as a **required change**, with the file or contract it lands in |
| Major — would entrench a defect if built as written (a parallel authority beside a canonical model, a contract change to a governed spine, an unenforceable invariant) | **Revise before building** | The specific defect and the smallest change that removes it |
| The reviewer cannot settle the question from the architecture description at all | **Escalate** | The concern, the stakeholder it belongs to, and what evidence would settle it |

**Aligned with minor adjustments is a pass.** The adjustments ride along as required changes; they do not convert the verdict into an open question for a human.

## Why

ISO/IEC/IEEE 42010 frames an architecture description as the thing that addresses identified **stakeholder concerns**. A review is therefore a check that the concerns in scope are addressed — a bounded judgment against a known set — not an open-ended invitation to find more. TOGAF's ADM places compliance review inside Phase G *Implementation Governance*, where the point is to keep delivery moving in conformance, not to halt it.

Escalating a minor finding is not caution; it is a transfer of work. It converts a decision the reviewer was competent to make into human queue time, and — because the finding was minor — the human almost always returns the same answer the reviewer already held. Do that at scale and the review surface stops being a governance asset and becomes a tax on delivery, which is precisely the failure Phase G governance is meant to prevent.

The named-required-change form is what makes a pass safe. Nygard's point about ADRs applies to review output too: record the **rationale**, not just the outcome. "Proceed, and these three things must change" is auditable and actionable; "looks fine" is neither.

## How To Apply

1. **Grade every finding before you pick a verdict.** Minor vs major is the whole decision. Ask: if this shipped as written, would it entrench a defect that a later change cannot cheaply undo? Only "yes" is major.
2. **Name each adjustment concretely.** Which model, which route, which enum, which migration. An adjustment the author cannot locate is a question wearing a verdict's clothes.
3. **Check the three standing major triggers first**: a new parallel authority beside an existing canonical model (see [[professions/enterprise-architecture/extend-canonical-models-never-fork]]), a contract change to a governed spine, and an invariant the database cannot actually enforce (see [[professions/enterprise-architecture/evolve-schema-additively]]).
4. **Escalate only for an unsettled concern.** Not for risk, and not for size. A high-consequence decision you can settle from the description is still a verdict.
5. **Record the verdict as an ADR** when the review changed the design's direction — see [[professions/enterprise-architecture/record-decisions-as-adrs]].

## See Also

- [[professions/enterprise-architecture/verify-the-substrate-before-proposing-new]]
- [[professions/enterprise-architecture/extend-canonical-models-never-fork]]
- [[professions/enterprise-architecture/minimal-proven-associations]]
- [[professions/enterprise-architecture/togaf-adm-phases]]
