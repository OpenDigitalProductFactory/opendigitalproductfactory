---
title: Extend the canonical model; never fork it
pageKind: principle
status: published
abstract: Every concept in an estate has exactly one canonical home — one model, one writer, one place the truth is defined. A change that needs more from a concept extends that home additively. A change that stands up a second table, second enum, or second writer for the same concept creates a parallel authority, which is the defect architecture review exists to catch.
principleTier: core
principleDirection: Extend the existing canonical model and its single writer; never introduce a second authority for a concept that already has one.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"long_term_maintainability": 1.0, "reusability": 0.8, "schema_grounding": 0.7, "blast_radius": -0.5}
professionCompetencyLevel: expert
sources:
  - opengroup/togaf
  - opengroup/archimate-3-2
  - iso/42010
  - dpf/agents-rulebook
---

## Rule

A concept has **one canonical home**: one model that defines it, one writer that mutates it, one module the rest of the estate imports it from.

- Needs another attribute? **Extend** the canonical model.
- Needs another view of it? **Project** from the canonical model.
- Needs different behaviour in one context? **Overlay** the canonical definition — cite it and override the specific values.
- Needs a second table, a second enum, a second writer, or a second spec for the same concept? That is a **fork**, and it is the finding.

Placement follows the same rule: a change lands in the concept's existing home, not in a new one near the caller that happens to need it.

## Why

TOGAF answers this at the governance layer: the Architecture Repository and the ADM's continuous requirements-management core exist so that one enterprise architecture is developed and governed, rather than a set of locally-optimal architectures that each look correct in isolation. ArchiMate answers it at the modeling layer: it is deliberately *one* model relating Business, Application, and Technology through service-orientation, with views as projections over that single model — not as independent models that happen to agree today.

The failure mode is not that a fork is wrong on the day it lands. It is usually correct on that day — that is what makes it pass review. The failure is that two authorities for one concept **diverge silently**. Each acquires its own writers and its own consumers; each is updated for its own reasons; and the moment they disagree, every consumer downstream of the wrong one is wrong, with no error raised anywhere. ISO/IEC/IEEE 42010's separation of the architecture from its descriptions is the same insight: many descriptions, one architecture. Two architectures pretending to be one is the pathology.

Removal cost compounds. Deleting a forked authority means finding and re-pointing every writer and reader it accumulated, then reconciling the data the two produced while they disagreed. Extending the canonical model costs a column.

## How To Apply

1. **Find the home before you write.** Run the sweep in [[professions/enterprise-architecture/verify-the-substrate-before-proposing-new]]; the home is what it returns.
2. **Extend additively.** New optional attribute, new enum member, new relation — see [[professions/enterprise-architecture/evolve-schema-additively]] for doing it deploy-safely.
3. **Prefer overlay to fork for variation.** When one context needs different values, keep the canonical definition and record the delta against it. Cite-and-override preserves a single lineage; copy-and-edit destroys it.
4. **Keep one writer.** Read paths may be many; the mutation path must be one, so an invariant has one place to live.
5. **Extend the navigation, route, and enum registries in place** rather than adding a parallel one beside them — a second registry is a fork of the registry concept.
6. **When a fork is genuinely unavoidable**, record it as an ADR with its removal condition — see [[professions/enterprise-architecture/record-decisions-as-adrs]]. An undocumented fork is indistinguishable from an accident.

## See Also

- [[professions/enterprise-architecture/verify-the-substrate-before-proposing-new]]
- [[professions/enterprise-architecture/name-and-type-the-contract-canonically]]
- [[professions/enterprise-architecture/evolve-schema-additively]]
- [[professions/enterprise-architecture/archimate-three-layers]]
