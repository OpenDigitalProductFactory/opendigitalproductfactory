---
title: Human-in-the-Loop at Phase Boundaries
pageKind: principle
status: published
abstract: Approve transitions at phase boundaries, not individual tool calls.
principleTier: commandment
principleDirection: Approve transitions at phase boundaries, not individual tool calls.
principleDimensionVector: {"governance_compliance": 1.0, "human_cognitive_load": -0.6, "speed_to_value": 0.5, "legibility_of_consequence": 0.7, "customer_consent_state": 0.65}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Documents DPF's HITL governance posture for adopters and contributors — anyone running the platform needs to know where approvals are required and where the agent operates autonomously.
sources:
  - frameworks/it4it-v3
---

## Rule

Human approval gates exist at **phase boundaries** — ideate → plan, plan → build, review → ship — not at individual tool calls within a phase. Within a phase, the agent operates autonomously using its scoped tools.

## Why

Per-call approval breaks the agent's reasoning flow and burns the operator's time on micro-decisions. Phase boundaries give the human meaningful, infrequent decision points where the agent has produced reviewable evidence (a plan, a build, a verification report) and the human can act on substance instead of rubber-stamping every step. This matches the IT4IT value-stream gate model: governance happens at the transition, autonomy happens inside the stream.

The exception is proposal-mode tools: any action that affects production (deploying, registering products, modifying user data) presents a card for explicit approval regardless of phase, because the blast radius is too high for autonomous execution.

## Applies To

Every population governed by DPF — in-platform coworkers, external coding agents working on the codebase, and the humans operating the platform. The contract is symmetric: agents respect the gate, humans honor the autonomy inside it. Does NOT apply to first-time bootstrap flows where the human has not yet defined phase boundaries (those run under different setup-mode rules) or to read-only operations (queries, inspections) which never gate.

## How To Apply

Implementers gate phase transitions deterministically — a build cannot move from `review` to `ship` until the design-review-required and tests-pass checks have passed and the human has approved the summary. Inside a phase, do not insert per-call confirmation prompts; trust the scoped tool grants and let the agent run. For production-affecting actions inside a phase, route through proposal-mode tools so the human sees a card before the side effect executes. Phase exit produces durable evidence (a plan document, a verification report, a contribution ledger) so the approval is grounded in artifacts the human can audit later.

## Decision Dimensions

- `governance_compliance: 1.0` — phase-boundary gates ARE the governance substrate; this principle is what makes that substrate operationally meaningful.
- `human_cognitive_load: -0.6` — strongly favors the option that reduces interruption load on the operator. Per-call approval has the opposite sign on this axis; this principle exists precisely to bend the system away from that pattern.
- `speed_to_value: +0.5` — autonomous operation within a phase materially shortens the cycle. The principle does not maximize raw speed (governance and cognitive-load axes still win at the boundary), but it removes the throughput tax of per-call review.

## Examples

- **Positive:** A coworker building a feature receives plan approval at the phase boundary, then runs 40 tool calls inside the build phase (edits, tests, lints, commits) without any prompts; at the ship boundary, the human reviews the summary and verification evidence and approves.
- **Counterexample:** A workflow that asks the user "should I run the tests?" or "want me to continue?" between every action inside a phase. This burns the operator's attention on micro-decisions and signals the agent doesn't trust its scoped tool grants — the wrong place to put a gate.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
