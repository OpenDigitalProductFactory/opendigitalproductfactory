---
title: Universal Work Formula
pageKind: principle
status: published
abstract: All work runs one invariant formula; only context, temporal, and participant axes vary. The outcome is a result of the formula, never a reason to fork it.
principleTier: core
principleDirection: Express work once as the invariant formula (frame → propose → collaborate → review → govern → verify → carry-over) with a WorkUnit contract every carrier satisfies; put per-work-type difference in a source-registry entry along the context/temporal/participant axes, never in forked code.
principleDimensionVector: {"long_term_maintainability": 1.0, "reusability": 0.8, "schema_grounding": 0.6, "governance_compliance": 0.5, "blast_radius": -0.4, "human_cognitive_load": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: A coding change, a sales opportunity, an approval, and a field-service job run the same governed lifecycle in DPF; adopters need to know the platform models work once and varies it by data, not by parallel code paths.
---

## The formula is invariant

Every unit of work in DPF — a coding change, a sales opportunity, an approval, a field-service job, a debate — runs one lifecycle:

```
frame → propose → collaborate → review → govern → verify → carry-over / close
```

The mechanisms that realize it are shared and exist **once**:

- **Process** — the state machine and allowed transitions (`WorkCaseState`, `supportedTransitions`, the action verbs).
- **Collaboration** — participants under one `Principal` abstraction with RACI-shaped roles (accountable / contributor / reviewer / observer / coordinator).
- **Review** — a first-class role and transition, not a coding-only step.
- **Governance** — decision scope (WWMD/WWWD/WSID), receipt policy, sanctioned mutators, the human-in-the-loop envelope.
- **Verify & carry-over** — the sealed outcome packet (raw chat is not durable), stop conditions, and carry-over of unresolved work.

## Only three axes vary

A work type differs from another **only** along:

| Axis | What varies | Where it lives |
|---|---|---|
| **Context** | domain, outcome definition, which records are evidence | `WorkCaseSourceRegistryEntry` (`domainCategory`, `defaultDecisionScope`, required outcome categories) |
| **Temporal** | finite vs standing; short vs long; cadence | `roomProjection.mode` + cycle boundaries |
| **Participant** | who is admitted and in what mix (person / agent / system / external) | membership + outcome-scoped rights |

## The review altitude check

A difference between two work types that is **not** {context, temporal, participant} is duplication and must be removed; a difference that **is** one of those three is a registry entry, not code. When reviewing a new work type or a new projector/status/lifecycle, ask: **"Is this a variation-axis registry entry, or a forked formula?"** A forked formula fails the check.

The `WorkUnit` contract (`apps/web/lib/work-management/work-unit.ts`) is the single shape every durable carrier (Workroom, WorkItem, TaskRun) adapts into, so the formula is enforced, not merely intended.

Design of record: `docs/superpowers/specs/2026-08-12-work-model-convergence-addendum-common-work-formula-design.md`. Kernel ledger DI-BF10BF48EED5 (contract-and-gate approach).
