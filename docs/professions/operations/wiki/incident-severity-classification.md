---
title: Classify incident severity before acting
pageKind: principle
status: published
abstract: Classify an incident's severity (SEV1 critical, SEV2 major, SEV3 minor) by business impact before responding, so a pre-defined workflow starts without improvisation. Severity (impact) is distinct from priority (urgency).
principleTier: core
principleDirection: Assign a severity by business impact at the start of every incident; tie each level to a predefined response.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"blast_radius": 0.7, "public_safety": 0.5}
professionCompetencyLevel: foundational
sources:
  - betterstack/severity-levels
---

## Rule

At the **start** of an incident, classify its **severity** by business impact. Severity drives which pre-defined response runs, so triage decisions are not improvised under pressure.

## Severity Levels

- **SEV1 (critical)** — service down for all customers, or a major security breach / data loss.
- **SEV2 (major)** — service down for a subset of customers, or significant loss of core functionality.
- **SEV3 (minor)** — an inconvenience that does not affect major system functions.

## Severity Is Not Priority

**Severity measures impact; priority measures urgency / what to fix first.** They are distinct: a SEV2 affecting a paying enterprise customer may be worked before a SEV1 on a deprecated system. Record both — the same severity-vs-priority distinction the QA profession draws for defects.

## How To Apply

1. **Classify first.** Assign a SEV level before mobilizing — it determines the response.
2. **Tie severity to a workflow** so "no improvisation is necessary" — see [[professions/operations/runbook-driven-resolution]].
3. **Feed the lifecycle** — severity shapes the [[professions/operations/incident-response-lifecycle]].

## See Also

- [[professions/operations/incident-response-lifecycle]]
- [[professions/operations/runbook-driven-resolution]]
