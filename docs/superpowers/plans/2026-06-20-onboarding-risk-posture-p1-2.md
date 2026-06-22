# Plan — Onboarding Intake P1.2: capability auto-activate (first envelope knob)

**Date:** 2026-06-20
**Epic:** EP-ONBOARDING-INTAKE · **BI:** BI-E93A3437
**Spec:** [`docs/superpowers/specs/2026-06-20-onboarding-intake-derivation-design.md`](../specs/2026-06-20-onboarding-intake-derivation-design.md) §5.5
**Predecessor:** P1 keystone (BI-E0E977BC, PR #2248) — the autonomy-gate wiring + the read-time `RiskEnvelope`.
**Status:** capability-auto-activate shipped (this PR); other knobs sequenced below.

## Goal

Wire the read side of the risk envelope into the operational defaults, each with **balanced = no change** so existing installs are untouched. This slice ships the cleanest, highest-leverage knob — **capability auto-activate** — plus the shared read helper, and fixes a correctness bug found while mapping.

## Correctness fix (found during mapping)

The P0 envelope set `balanced.capabilityAutoActivate = true`, but **today `recommended` capabilities are asked at setup and default OFF** (`capability-activation.ts` `resolveCapabilityActivation`). Wiring that as-is would have flipped every balanced (default) install to auto-enable recommended capabilities — a silent regression. Fix: `balanced.capabilityAutoActivate = false`; **only `progressive` auto-activates**. This restores the balanced=no-change contract (test-pinned). `conservative` was already false.

## Change set (this PR)

| File | Change |
|------|--------|
| `apps/web/lib/govern/risk-posture.ts` | `balanced.capabilityAutoActivate` → `false` (correctness). |
| `apps/web/lib/govern/org-risk-envelope.ts` | **new** `resolveOrgRiskEnvelope(organizationId?)` — reads `BusinessContext.riskPosture` (single-org-per-install), fail-open to balanced. The read side of the posture. |
| `packages/storefront-templates/src/capability-activation.ts` | `resolveCapabilityActivation` / `resolveOrgCapabilityActivations` gain `autoActivateRecommended` (default `false` = no-change). An un-decided `recommended` defaults ON only when set; an explicit `disabled` still wins. New `source` value `posture-default`. |
| `apps/web/lib/storefront/capability-activation.ts` | `getEffectiveCapabilityActivations` resolves the org envelope and passes `envelope.capabilityAutoActivate`. This is the **single fold** the setup wizard, admin toggle, and route/UI gating all share — one injection point, no threading. |

## Why this injection point

`getEffectiveCapabilityActivations` is the documented single source of truth for "is this capability on for this org?" — every consumer flows through it. Resolving the envelope there means the posture default is consistent everywhere with no per-call-site threading. Fail-open: an unreadable/unset posture → balanced → today's behavior (the existing test exercises this).

## Safety

- **No regression:** balanced (and the fail-open default) → `capabilityAutoActivate=false` → recommended stays ask-at-setup (test-pinned).
- **Explicit choice wins:** an org `disabled` is never overridden by the posture default.
- **Scope:** only `recommended` auto-activates (not `optional`/`required`); only `progressive` posture.

## Sequenced (remaining P1.2 knobs — not this PR)

- **Self-upgrade window width** (`selfUpgradeWindow`): modulate `isUpgradeWindowOpen` (`apps/web/lib/self-upgrade/window.ts`, prisma-free → caller resolves + passes). Non-trivial margin math + existing tests → its own slice.
- **Edge-deploy default** (`edgeDeployDefault`): posture override appended at the `deriveCapabilityApplicability` callsite. Niche (estate-ops archetypes only).
- **AgentGovernanceProfile seed default**: low-yield (no seed default exists today; manual assignment).

## Deferred (separate)

Outbound-send confirmation strictness — a hard kernel principle (`outbound-actions-require-explicit-go`) with no org knob; needs a principle org-override / tool-policy design, not wired here.

## Verification

Unit: `risk-posture.test.ts` (balanced=false pinned), `capability-activation.test.ts` (package: auto-activate + explicit-disable-wins), `apps/web/lib/storefront/capability-activation.test.ts` (progressive auto-on, balanced no-change). Source-only worktree → compile/build gates run in CI.
