# Auto-identify calibration + proactive self-diagnosis

**Backlog item:** BI-DEC1C7BF
**Date:** 2026-08-11
**Follows:** #4198 (fingerprint-layer wiring). Extends the AI identity-inference
engine (`packages/db/src/catalog-identity-inference.ts`, EP-ASSET-INTELLIGENCE
spec §4.2/§8); no new contract, table, or enum.

## Problem (measured on a live install)

The AI identity fallback correctly identifies real network devices with no
hand-written rules (Whirlpool appliance 0.96, Reolink camera 0.96, Nest 0.94,
Ubiquiti 0.95, TP-Link 0.91), but the hardcoded `autoApplyThreshold` of 0.97 sits
above the cheap/local-model confidence band (0.90–0.96). `IdentityResolutionLog`
held 55 `ai_resolved` rows; **0 were applied** — the estate stayed blank. A hidden
miscalibration no operator could diagnose, and one the AI coworkers should catch
themselves (operator feedback).

## Design grounding

- Searched substrate: the engine already writes a non-authoritative
  `identityStatus='ai_resolved'`, guards `human_confirmed`, and gates rule
  PROMOTION separately via `shadowPromotionThreshold`. So lowering the *apply*
  bar is safe and does not weaken rule authority.
- Decision: calibrate the existing engine + add a self-diagnostic; do not add a
  new identification pathway.

## Changes

1. Default `autoApplyThreshold` 0.97 → 0.90; add `IDENTITY_INFERENCE_AUTO_APPLY_THRESHOLD`
   env override (to RAISE it for high-precision-model installs). Rule promotion
   stays gated by `shadowPromotionThreshold` (≥3 identical).
2. Exclude DPF-internal (`isDockerOriginEntityKey`) entities from the AI candidate
   scan so inference budget targets real estate (`dpfInternalSkipped`).
3. `diagnoseIdentityInference()` — detects "resolved many, applied ~none" and
   surfaces an operator-facing advisory on the ScheduledJob + logs + run outcome,
   so the platform surfaces the miscalibration instead of discarding results silently.

## Verification

- 23 db-engine tests (incl. new: 0.90 applies, 0.85 withheld, docker-internal
  skipped, diagnostic fires/silent), 8 runner tests, db typecheck, all 37 guards,
  full sandbox local-CI gate — green.

## Out of scope → follow-up

- Fuller proactive loop: inventory-specialist coworker reads the advisory and
  auto-mitigates (tune threshold / humanized alert), per tell-don't-act.

## Backlog coverage
- Decision: atomic
- Parent: BI-DEC1C7BF
- Receipt: cmsp5dgn103ne01s51t3w6xnw
- Rationale: The three changes are one calibration fix — the scan exclusion and the diagnostic both read the same run the lowered gate governs; shipping the gate change without the diagnostic re-buries the failure mode, and shipping the diagnostic without the gate change leaves the estate blank. None is independently shippable.
- Dependencies: none
