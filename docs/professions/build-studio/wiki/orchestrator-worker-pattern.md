---
title: Orchestrator-Worker Pattern
pageKind: principle
status: published
abstract: A coordinator routes work to specialists; specialists do not route to each other.
principleTier: core
principleDirection: Route through an orchestrator; let specialists do specialist work.
principleDimensionVector: {"governance_compliance": 0.7, "long_term_maintainability": 0.5, "reusability": 0.6}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Documents DPF's multi-agent topology so adopters understand why coworkers don't hand off directly.
sources:
  - frameworks/it4it-v3
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Multi-step workflows use a hierarchical orchestrator-worker pattern. The orchestrator (Build Studio for product builds, or the route-aware MCP dispatcher for ad-hoc work) routes each phase to the appropriate specialist agent. Specialists do not hand off directly to each other — every transition mediates through the orchestrator.

## Why

Simple phases (ideate, plan, review, ship) are deterministic workflows where smaller models perform well; complex phases (build, with multi-step tool reasoning) need frontier models. Routing decisions belong in the cheap-model orchestrator; reasoning depth belongs in the expensive-model worker. Direct peer-to-peer handoffs hide governance checkpoints, complicate error recovery, and burn tokens on transition logic that belongs in one place. The pattern matches the value-stream gate model described by the IT4IT Reference Architecture: the orchestrator IS the gate.

## Applies To

In-platform coworkers, external coding agents, and any multi-step workflow with more than one role. Single-role workflows operate without an orchestrator because there is no peer to route to.

## How To Apply

When designing a new multi-agent workflow, ask: who is the orchestrator and where does it live? If two specialist agents want to call each other directly, the orchestrator is missing — promote one of them to coordinator or add a dispatcher layer. Token-budget rule of thumb: orchestrator on Haiku-tier (cheap routing), worker on Sonnet-tier (deep reasoning) where the build phase requires it.

## Decision Dimensions

- `governance_compliance: 0.7` — the orchestrator is the natural place to enforce phase gates, scoped tool grants, and approval boundaries.
- `long_term_maintainability: 0.5` — a clear orchestrator-worker topology ages well; peer-to-peer chains rot fast as agents are added or removed.
- `reusability: 0.6` — workers built to be summoned by an orchestrator can be reused across orchestrators; workers entangled in peer-to-peer chains cannot.

## Examples

- **Positive:** Build Studio dispatches `plan` to the Architect, `build` to the Software Engineer, `review` to QA, `ship` to Operations. Each agent returns its phase output to the orchestrator; the orchestrator decides the next dispatch.
- **Counterexample:** A workflow where the Software Engineer agent directly invokes the QA agent with raw conversation history attached. The orchestrator can't gate the transition, the QA agent inherits unrelated context, and token cost balloons.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
