---
title: Capability-gap detection to governed backlog suggestion
pageKind: principle
status: published
abstract: A detected capability gap triggers a build-vs-buy judgment, not an automatic adoption. Buy for non-differentiating needs, build where the capability is the edge, weigh total cost over time — and always output a governed backlog suggestion, never a unilateral integration.
principleTier: core
principleDirection: Convert a detected gap into a build-vs-buy judgment and a governed backlog suggestion; the scout proposes, governance disposes.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"cost_efficiency": 0.6, "vendor_lock_in": 0.5, "speed_to_value": 0.4}
professionCompetencyLevel: expert
sources:
  - productschool/build-vs-buy
  - owasp/component-analysis
---

## Rule

A detected capability gap triggers a **build-vs-buy judgment**, not an automatic adoption — and its output is always a **governed backlog suggestion**, never a unilateral integration. The scout proposes; governance disposes.

## The Build-vs-Buy Judgment

The decision spans cost/TCO, time-to-market, capability fit, in-house expertise, and strategic control:

- **Buy for non-differentiating needs** — "buy for non-core functions and build where learning compounds."
- **Build where it is the edge** — ask "does this software define your competitive edge?"
- **Weigh true cost over time** — "smart teams look beyond the first invoice to the total cost of flexibility."
- **Price in supply-chain cost** — adopting an external tool imports its risk surface, and every new component adds ongoing maintenance cost; factor vetting into the buy side.

## Output: A Governed Suggestion

The scout never integrates unilaterally. The output is a **candidate for review** that enters the governed backlog — consistent with DPF's "governed backlog suggestion" model and the Tool Evaluation Pipeline. Governance, not the scout, decides adoption.

## How To Apply

1. **Frame the gap** as build-vs-buy, not "found a tool, adopt it."
2. **Require vetting** ([[professions/external-intelligence/vet-before-adopting-external-tools]]) before any buy recommendation.
3. **File a governed suggestion** with provenance and health evidence from [[professions/external-intelligence/external-tool-catalog-reconnaissance]].

## See Also

- [[professions/external-intelligence/vet-before-adopting-external-tools]]
- [[professions/external-intelligence/mcp-what-it-is]]
