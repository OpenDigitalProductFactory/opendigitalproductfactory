# Plan — Onboarding Intake P1: wire the risk envelope (autonomy keystone)

**Date:** 2026-06-20
**Epic:** EP-ONBOARDING-INTAKE · **BI:** BI-E0E977BC
**Spec:** [`docs/superpowers/specs/2026-06-20-onboarding-intake-derivation-design.md`](../specs/2026-06-20-onboarding-intake-derivation-design.md) §5.5
**Predecessor:** P0 (BI-527E5C40, PR #2213 merged) — the risk-posture home + envelope.
**Status:** Keystone implemented (this PR); operational knobs sequenced to P1.2.

## Goal

Make the risk posture stop being inert: project it into the platform's **autonomy** behaviour. P1's headline consumer is the decision-perspective evaluator — the live "trust dial" that gates how autonomously a coworker may act.

## Why keystone-first (scope decision)

The spec lists six consumers. Mapping the substrate (two parallel reads) showed they are not equal:

| Consumer | Current default | Risk to wire | Decision |
|----------|-----------------|--------------|----------|
| **Decision-perspective autonomyPolicy** (the live autonomy gate) | org WWWD profile seeded `{allowArbitration:false, maxRiskForArbitration:"low", minRec:0.55, minArb:0.9}` | LOW — single clean seed point (`seedOrgWwwdCorpus`), evaluator already reads it | **This PR (keystone)** |
| Self-upgrade window width | binary store-closed, no width knob | LOW, but adds a `SelfUpgradeConfig` field + margin logic | P1.2 |
| Capability auto-activate `recommended` | recommended = asked/opt-in (off) | LOW (`autoActivateRecommended` param through `resolveCapabilityActivation`) | P1.2 |
| Edge-node deploy default | `hidden` in base capability map | LOW (one override) | P1.2 |
| AgentGovernanceProfile defaults | no seed default (manual assignment) | LOW but low-yield (rarely auto-assigned) | P1.2 |
| Outbound-send confirmation strictness | hard kernel principle (`outbound-actions-require-explicit-go`) | **HIGH/DIFFUSE** — principle-layer, no org knob; wiring risks audit-trail ambiguity | **Deferred** (kernel-hardening pass; not wired) |

The autonomy gate is the consequential, highest-value piece and is the one that actually changes "how autonomous are the agents." It deserves focused, correct delivery (the worktree is source-only, so the change is verified in CI). The operational knobs are additive, independent, and safe to land incrementally.

## The keystone wiring

The org's own `DecisionPerspectiveProfile` (`kind="organization"`, seeded by `seedOrgWwwdCorpus` as `org-perspective-<orgId>`) carries an `autonomyPolicy` Json that `apps/web/lib/decision-perspective/evaluator.ts` reads to decide escalate vs recommend vs arbitrate. We derive that policy from the posture.

- `apps/web/lib/govern/risk-posture.ts` → `riskEnvelopeToAutonomyPolicy(envelope)`: pure map posture → `DecisionAutonomyPolicy`.
  - **balanced = the exact seed default** (`allowArbitration:false, maxRiskForArbitration:"low", minRec:0.55, minArb:0.9`) — pinned by a test; existing installs unchanged.
  - **conservative** tightens only: never arbitrate, higher confidence floors (0.65 / 0.95).
  - **progressive** loosens within bounds: arbitrate low+medium risk at high confidence (0.5 / 0.8). High/critical-risk decisions **always escalate** regardless (an unconditional rule in the evaluator), so no posture can make an agent reckless.
- `apps/web/lib/onboarding/apply-risk-envelope-to-profile.ts` → `applyRiskEnvelopeToOrgProfile({ organizationId })`: reads `BusinessContext.riskPosture`, maps it, `updateMany`s the org profile's `autonomyPolicy` (missing profile = 0-row no-op). Idempotent + fail-open.
- Wired at `finalizeSetupCompletion()` **after** `seedRiskPosture` (posture set) and `seedOrgWwwdCorpus` (profile created).
- Wired in the business-context API so an operator changing the posture re-projects the policy immediately (stays live, not just at setup).

## Safety properties

- **No regression:** balanced is the identity (test-pinned to the seed default).
- **Monotonic:** conservative ≤ balanced ≤ progressive in autonomy (test-asserted).
- **Bounded:** high/critical-risk always escalates regardless of posture (evaluator invariant, unchanged).
- **Fail-open:** the wiring never blocks onboarding completion or a posture edit.

## Verification

- Unit: `risk-posture.test.ts` (balanced-identity, monotonicity) + `apply-risk-envelope-to-profile.test.ts` (writes correct policy, fail-open). Source-only worktree → compile/build/test gates run in CI.

## P1.2 (follow-on BI)

Operational knobs — self-upgrade window width, capability `recommended` auto-activate, edge-deploy default, AgentGovernanceProfile seed default — each balanced=no-change. Outbound-send strictness stays **deferred** to a kernel-hardening pass (principle-layer org-override design), not wired here.
