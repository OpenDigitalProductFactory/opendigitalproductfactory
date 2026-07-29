---
title: Verify the substrate before proposing anything new
pageKind: principle
status: published
abstract: Before accepting or proposing a new table, enum, capability, route, or spec, sweep what already exists — the baseline architecture, the code, the live backlog, the main branch. In a dense estate the concept usually already exists under another name, and "we need a new X" is the most common reviewable claim that turns out to be false.
principleTier: core
principleDirection: Sweep the existing baseline for the concept before recording a need for a new one; never accept a new-X claim that no baseline sweep was run against.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"evidence_density": 0.9, "reusability": 0.8, "long_term_maintainability": 0.6, "speed_to_value": -0.2}
professionCompetencyLevel: practitioner
sources:
  - opengroup/togaf
  - iso/42010
  - dpf/agents-rulebook
---

## Rule

**No new-X claim without a baseline sweep.** Before a design or plan may assert that some new table, enum, capability, model, route, service, or spec is needed, the existing estate must have been searched for it: the code, the architecture description, the live backlog, and the current main branch.

The finding is recorded either way — "swept, nothing covers this" is as much a review artifact as "swept, this already exists as Y".

## Why

TOGAF's ADM makes this ordering structural: each architecture-domain phase (B Business, C Information Systems, D Technology) develops the **Baseline** architecture before the Target, precisely so that the gap between them is measured rather than assumed. A target proposed without a baseline is not a gap analysis; it is a guess.

ISO/IEC/IEEE 42010 supplies the reason the guess is systematically wrong. The architecture description is the *record of what exists* and the concerns it addresses. An estate accumulates concepts faster than any single contributor reads them, so the honest prior in a mature system is that a plausibly-needed concept is already there — under a name the proposer did not think to search for.

The cost is asymmetric, which is why this rule pays for its small delay. A sweep that finds nothing costs minutes. A sweep skipped costs a duplicate spine: two tables that mean the same thing, drifting apart, each with its own writers, each half-right — and the second one is far more expensive to remove than it would have been to never add.

## How To Apply

1. **Search by concept, not by your name for it.** The existing model rarely uses the word you would have chosen. Search the vocabulary of the domain, the synonyms, and the abbreviation.
2. **Sweep four surfaces**: source, the architecture description / specs, the live backlog (someone may be building it right now), and the current main branch (it may have landed since your branch point).
3. **Record the sweep in the design.** State what you searched and what you found. This is the evidence the reviewer grades; an unrecorded sweep is indistinguishable from no sweep.
4. **When it exists, extend it** — see [[professions/enterprise-architecture/extend-canonical-models-never-fork]]. When it genuinely does not, say so explicitly, so the reviewer is grading a claim rather than an omission.
5. **A structural match is not a semantic match.** Two models with the same columns can mean different things. Confirm the *concern* each one addresses before merging them conceptually.

## See Also

- [[professions/enterprise-architecture/extend-canonical-models-never-fork]]
- [[professions/enterprise-architecture/architecture-review-verdict-thresholds]]
- [[professions/enterprise-architecture/togaf-adm-phases]]
