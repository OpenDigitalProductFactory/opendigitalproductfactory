# Sovereign SOC — EA security-posture extractor (no-drift)

- **Date:** 2026-06-25
- **Spec:** [2026-06-24-sovereign-soc-siem-design.md](../specs/2026-06-24-sovereign-soc-siem-design.md) §7 (cross-cutting)
- **Epic:** EP-SOVEREIGN-SOC — **BI-79B599BF** · composes EP-PARITY-ENGINE / EP-ARCH-GRAPH-LIVE

## Goal

Project the security domain into the one architecture graph so the SOC is a first-class, navigable surface that **cannot drift** from the implementation — the gap the arch-review flagged.

## This pass (DONE)
- `apps/web/lib/ea/security-posture-extract.ts` — `buildSecurityPostureModel()` (pure), modeled on `scheduled-job-extract.ts`. Emits: package `security:pkg`; a `part_definition` per plane (normalization / detection / cases / response / roster); a `part_usage` per kernel detection rule (`KERNEL_DETECTION_PACK`) and per AGT-SOC-* coworker; cross-layer `traces` edges from each plane to its `prisma:model:*` node (SecurityEvent / Detection / DetectionRule / ThreatIndicator / SecurityCase). `softRemovePrefix: "security:"` so stale nodes prune.
- `apps/web/lib/ea/reconcile-security-posture.ts` — the thin IO shell (`applySysmlModel(buildSecurityPostureModel(), {db})`).
- Registered into the orchestrator `reconcile-sysml-projections.ts` (+ the `architecture-parity-steward` domain label) so it runs every parity pass.
- Tests: `security-posture-extract.test.ts` (package/plane/usage counts, traces, contains, soft-remove); updated orchestrator + steward tests.

## Verified
web typecheck clean; EA extractor + orchestrator + steward tests 8/8.
