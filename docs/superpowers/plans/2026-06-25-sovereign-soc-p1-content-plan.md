# Sovereign SOC — P1 content: detection pack + enrichment lookups

- **Date:** 2026-06-25
- **Spec:** [2026-06-24-sovereign-soc-siem-design.md](../specs/2026-06-24-sovereign-soc-siem-design.md) §4.2, §4.3, §7.1
- **Epic:** EP-SOVEREIGN-SOC — **BI-6D9496F1** (P1 follow-on)

## Goal

Make the detection engine produce results out of the box (it was correctly inert with no rules) and wire enrichment to live data.

## This pass (DONE)
- `apps/web/lib/security/detection-pack.ts` — `KERNEL_DETECTION_PACK` (3 explainable starter rules under `scopeKey="kernel"`, MITRE-tagged): Windows failed logon (T1110), threat-intel indicator match (T1071), internal authorization denied (T1078, self-monitoring). `ensureKernelDetectionPack` is **create-if-missing** — operator tuning of existing rules is never overwritten.
- Wired `ensureKernelDetectionPack` into `runCorrelationSweep` (gated by `seedPack`, default true) so the rules are always present without separate seed wiring.
- `apps/web/lib/security/enrichment-lookups.ts` — `buildPrismaEnrichmentLookups`: asset context ← `InventoryEntity` (by hostname), threat intel ← `ThreatIndicator` active-window index. Pass to `enrichSecurityEvent`; SOC coworkers use it when investigating a detection.
- Tests: `detection-pack.test.ts` (each rule fires on a sample event; benign events do not).

## Verified
web typecheck clean; detection-pack + sweep tests green.
