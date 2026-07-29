---
title: Every defect needs reproduction steps and expected vs actual
pageKind: principle
status: published
abstract: A defect that cannot be reproduced cannot be diagnosed, fixed, or confirmed resolved. Every defect record must capture reproduction steps, expected vs actual behavior, and severity and priority.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: File no defect without reliable reproduction steps and an explicit expected-vs-actual statement.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"evidence_density": 0.9, "human_cognitive_load": 0.6}
professionCompetencyLevel: foundational
sources:
  - wikipedia/software-bug
  - wikipedia/bug-tracking
---

## Rule

Every defect record must capture **reliable reproduction steps**, an explicit **expected vs actual** behavior statement, and **severity and priority**. A defect that cannot be reproduced cannot be trusted, triaged, or confirmed fixed.

## Why

"The first step in locating a bug is to reproduce it reliably" — without reproduction a programmer cannot find the cause and therefore cannot fix it. A bug-tracking record exists to convey the erroneous program behavior, and must include details on how to reproduce the bug alongside its severity. State expected vs actual explicitly so the gap is unambiguous.

A bug that cannot be reproduced also cannot be verified as resolved — there is no way to confirm the fix worked.

## How To Apply

1. **Reproduce first.** Establish reliable steps before filing; if it is intermittent, capture frequency and conditions.
2. **Expected vs actual.** State what should happen and what does happen — the delta is the bug.
3. **Severity and priority.** Record both per [[professions/qa-engineer/severity-vs-priority]] so triage can manage impact and scheduling.
4. **Confirm via re-run.** A fix is "done" only when the reproduction no longer triggers the defect — this is validation, see [[professions/qa-engineer/verification-vs-validation]].

## See Also

- [[professions/qa-engineer/severity-vs-priority]]
- [[professions/qa-engineer/verification-vs-validation]]
