---
title: Record architecturally significant decisions as ADRs
pageKind: principle
status: published
abstract: When a design choice is architecturally significant, record it as an Architecture Decision Record capturing its rationale — not just the outcome — so future contributors can judge whether it still holds. The accumulated ADRs form the decision log.
principleTier: core
principleDirection: Emit an ADR with rationale for every architecturally significant decision; never leave such decisions undocumented.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"evidence_density": 0.8, "long_term_maintainability": 0.7}
professionCompetencyLevel: foundational
sources:
  - nygard/adr
  - adr/github
---

## Rule

When a design choice is **architecturally significant**, record it as an **Architecture Decision Record (ADR)** — capturing the **rationale**, not just the outcome. The accumulated ADRs form the project's **decision log**.

## Why

As Nygard put it, one of the hardest things to track over a project's life is the **motivation** behind decisions. A new contributor who cannot see why a choice was made will either preserve it blindly or overturn it ignorantly. An Architectural Decision is "a justified design choice that addresses a functional or non-functional requirement that is architecturally significant" — recording the forces and trade-offs lets future readers judge whether the decision still holds.

## How To Apply

1. **Trigger on significance.** If a choice is hard to reverse, affects structure, or constrains future options, write an ADR.
2. **Record the why.** Context and consequences matter more than the decision sentence — use the [[professions/enterprise-architecture/architecture-decision-record]] structure.
3. **Never delete; supersede.** A reversed decision changes status, preserving history.
4. Org/communication-structure decisions are significant too — see [[professions/enterprise-architecture/conways-law]].

## See Also

- [[professions/enterprise-architecture/architecture-decision-record]]
- [[professions/enterprise-architecture/conways-law]]
