---
title: Optimize for the Whole
pageKind: principle
status: published
abstract: Validate every local function — human, AI, or application — against the end-to-end outcome it serves; a change that optimizes one step while degrading the whole is rejected, however good it looks locally.
principleTier: commandment
principleDirection: Balance every local function against the end-to-end outcome it serves, and reject local optimizations that degrade the whole.
principleDimensionVector: {"long_term_maintainability": 1.0, "reusability": 0.6, "governance_compliance": 0.7, "speed_to_value": -0.5, "cost_efficiency": 0.55, "blast_radius": -0.35}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: This is DPF's founding thesis. The platform exists to stop local optimization from forsaking the whole outcome — the systemic gap that IT4IT value streams and CSDM coherence were created to close. Adopters must know the platform balances every local function, human or machine, against the end-to-end objective.
sources:
  - frameworks/it4it-v3
  - frameworks/csdm
  - articles/possible-futures-enterprise-architecture
---

## Rule

Every local function — a button, an agent, a feature, a query, a team's budget request — is validated against the end-to-end outcome it serves. When a local optimum conflicts with the whole, the whole wins. A change that advances one step while degrading the broader objective is rejected, however good it looks in isolation.

## Why

This is the chronic, systemic failure the platform exists to mitigate: a part is optimized in a way that forsakes the whole. It is the same failure in every layer. In IT, a tool optimizes its own function and the end-to-end value stream breaks at the seams between tools — the gap [IT4IT](../../raw-sources/frameworks/it4it-v3.md) closes by making the *value stream*, not the function, the unit of design. In data, each application models services its own local way and the enterprise loses a coherent picture — the gap [CSDM](../../raw-sources/frameworks/csdm.md) closes by making one common model the authority. In organizations, a leader advocates for their function's funding and the portfolio tilts to a locally-optimal, globally-lopsided allocation. The mechanism is identical; only the actor changes.

Local optimization is seductive because it is *legible and immediate* — the local step measurably improves, and the cost lands somewhere else, later, diffusely, on the whole. So it is chosen by default unless something holds the whole as the explicit counterweight. That counterweight is this principle. A platform built to mitigate this failure at scale must, above all, not commit it itself: every local function it ships — and every local decision its coworkers make — is answerable to the broader outcome.

## Applies To

Universal and symmetric: in-platform coworkers, external coding agents, and humans setting direction. It governs software design (a feature must serve the value stream, not just pass its own checklist), data design (one canonical model over per-surface locals), agent topology (the orchestrator owns the whole outcome; workers own steps), capacity and budget allocation (fund the portfolio outcome, not the loudest function), and UX (optimize the user's end-to-end objective, not the local screen). It does **not** forbid local excellence — a step should be done well — but local excellence is necessary, never sufficient: it must also advance the whole. The exception is named and tracked, not silent: when a deliberate local trade-off is taken for a stated reason, record the whole-outcome cost it accepts.

## How To Apply

Before accepting any change or decision, name the end-to-end outcome it serves — the value stream, the user objective, the epic goal, the portfolio result — and check that the local move advances *that*, not merely its own step. If a local optimization would degrade the whole, surface the trade-off explicitly and prefer the whole; do not let the legible local win quietly override the diffuse global cost. In review and validation gates, treat "does this serve the whole outcome?" as a first-class criterion alongside local correctness — a design that is locally sound but unmoored from the outcome it was meant to advance is not done. When you cannot see the whole an artifact serves, that absence is itself the finding.

## Decision Dimensions

- `long_term_maintainability: 1.0` — whole-system coherence *is* long-term maintainability; locally-optimized parts are exactly what erode it over time.
- `governance_compliance: 0.7` — this is a governance balance: the whole-outcome is the standard every local actor is held to, so the principle pulls strongly toward governed, outcome-anchored decisions.
- `reusability: 0.6` — designing for the whole favors shared, coherent substrate over per-local duplication, which is what makes parts reusable across the system.
- `speed_to_value: -0.5` — explicitly negative. Holding the whole as the counterweight costs throughput on the local step now; the payback is the end-to-end outcome not breaking later.

## Examples

- **Positive:** Local model calibration was made automatic at provider activation rather than a button an operator must remember. The local "feature" (a calibrate action) was subordinated to the whole outcome (a coworker that reliably works on a fresh install) — so the step that could be skipped was removed, not merely guarded. Designing for the whole user outcome, not the local screen, is the same move generalized: collapse a provider-config surface to one authenticate action plus a self-healing pipeline, because the user's objective is "AI that works," not "a configured providers page."
- **Counterexample:** A CI suite that runs every test but gates merge on only a subset, so a green-on-the-required-checks PR merges with red tests and breaks `main` — a check optimized for its local job (it *ran*) that failed the whole (it did not *gate*). Equivalently: a design review that validates a feature's local checklist (problem statement, acceptance criteria, reuse) but never asks which end-to-end value stream the feature advances, letting locally-perfect, globally-orphaned work pass.
