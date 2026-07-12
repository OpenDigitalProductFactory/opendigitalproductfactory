# Activate Build Studio cost flags behind evidence

- **BI:** BI-9E0595E7 · **Epic:** EP-27FD96BC
- **Kernel:** activation altitude routed via `principle_decide` 2026-07-11 → **platformconfig-operator-gated** (composite 9.241 over 9.033 default-on-env; near-tie, decided by consistency with the existing `getBuildGoldenTrianglePosture` config pattern and confirmed zero async-ripple — all four call sites are already async and the pure `build-process-matrix.ts` does not read these flags).

## Problem

Two Build Studio cost/quality levers were shipped **inert** behind default-off env vars so they'd merge byte-identical:
- `isModelTierRoutingEnabled()` — routes large/xlarge builds to the robust (frontier) engine.
- `isQualityFirstRightsizingEnabled()` — compiles the operator's golden-triangle posture (a PlatformConfig row **pinned to Quality**) floored by deliverable sensitivity into a model tier.

The whole machinery is built and wired; only the flags are off. So the operator's Quality posture has no effect and every build routes purely by size. This BI activates them behind the evidence the machinery already reads.

## Approach

Make both flags **operator-governed and ON by default**, mirroring `getBuildGoldenTrianglePosture`:
- New pure `resolveActivationFlag(env, config, defaultOn=true)` — precedence: explicit env (`0/false`→off, `1/true`→on) is the emergency kill-switch/override; else the PlatformConfig row (`false`→off); else default ON. Fail-open to the default so a config-read blip never silently regresses substantive builds back to local.
- `isModelTierRoutingEnabled()` / `isQualityFirstRightsizingEnabled()` become async, reading new PlatformConfig keys `BUILD_MODEL_TIER_ROUTING` / `BUILD_QUALITY_FIRST_RIGHTSIZING`.
- Await at the four call sites (build-pipeline, ideate-on-approval, plan-on-approval, ship-on-review-approval) — all already async.

Safety: model-tier routing still falls back to local when no robust engine is configured, so a local-only install is unaffected; a HIGH-sensitivity deliverable can only escalate, never discount below its sensitivity floor.

## Verification
- Unit (`build-studio-cost-flags.test.ts`): the precedence table — default-on, env kill-switch wins, config disable, fail-open on malformed config, explicit-baseline override.
- Regression: the ideate-on-approval mock updated to async; existing suite green.
- Behavioral: with the default (no env, no config row) a substantive build on an install with a robust engine routes to the robust tier; setting the `BUILD_MODEL_TIER_ROUTING` config row (or env `=0`) returns it to size-based routing.
