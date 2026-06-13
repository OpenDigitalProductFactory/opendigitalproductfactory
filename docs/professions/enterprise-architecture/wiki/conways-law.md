---
title: Conway's Law
pageKind: principle
status: published
abstract: A system's design tends to mirror the communication structure of the organization that builds it. Architecture and org design must be reasoned about together; a target architecture that fights the org structure is a trade-off to surface explicitly.
principleTier: core
principleDirection: Design architecture and team/communication structure together; when they conflict, surface the mismatch as an explicit decision.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"long_term_maintainability": 0.6, "blast_radius": 0.5}
professionCompetencyLevel: expert
sources:
  - conway/law
  - nygard/adr
---

## The Law

Conway's Law: "Any organization that designs a system … will produce a design whose structure is a copy of the organization's communication structure." It originates in Conway's 1968 paper *"How Do Committees Invent?"* (Datamation, April 1968).

## Why It Matters for EA

System and module boundaries tend to **mirror team and communication boundaries**. This is not a curiosity — it is a design force:

- If you design an architecture whose boundaries cut across how teams actually communicate, the implementation will drift back toward the org structure.
- Therefore **architecture and organization design must be reasoned about together**, not in isolation.

## The Expert Move

When a target architecture conflicts with the current organization's communication structure, the expert response is to **surface the mismatch as an explicit trade-off** — either adapt the architecture, or deliberately reshape teams to fit the desired architecture ("inverse Conway maneuver"). Either way it is an architecturally significant decision.

## How To Apply

1. **Read the org chart as an architecture constraint.**
2. **Name the conflict.** Don't silently fight Conway's Law — record the tension.
3. **Decide explicitly** and capture it via [[professions/enterprise-architecture/record-decisions-as-adrs]].
4. Factor it into [[professions/enterprise-architecture/togaf-adm-phases]] (especially Vision and Business Architecture).

## See Also

- [[professions/enterprise-architecture/record-decisions-as-adrs]]
- [[professions/enterprise-architecture/togaf-adm-phases]]
