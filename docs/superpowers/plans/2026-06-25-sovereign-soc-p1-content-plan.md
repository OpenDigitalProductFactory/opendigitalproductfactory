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

## Pack breadth — v1.1.0 (DONE, follow-on)
The 1.0.0 starter trio proved the mechanism; 1.1.0 expands toward a competitive
out-of-the-box baseline. **Every new rule matches a field a reference normalizer
actually emits** — no rule invents a source or field that does not exist (broader
source coverage, e.g. EDR/identity, rides EP-EDGE-TOPOLOGY's collector track and
this pack consumes those normalizers as they land). 7 rules added (pack 3 → 10):

| Rule | Real field matched | ATT&CK | Severity |
|---|---|---|---|
| Windows audit log cleared | `windows.security` · `normalized.windowsEventId == 1102` | T1070.001 | high |
| Windows account created | `windowsEventId == 4720` | T1136.001 | medium |
| Windows privileged-group change | `windowsEventId ∈ {4728,4732,4756}` (anyOf) | T1098 | medium |
| AWS CloudTrail logging tampered | `aws.cloudtrail` · `normalized.api.operation ∈ {StopLogging,DeleteTrail,UpdateTrail}` | T1562.008 | high |
| AWS MFA device removed | `api.operation ∈ {DeactivateMFADevice,DeleteVirtualMFADevice}` | T1556 | high |
| AWS access key created | `api.operation == CreateAccessKey` | T1098 | medium |
| Third-party high-severity finding | `cef` · `severityId ≥ 4` (upstream IDS/IPS/EDR relay) | — | high |

- Version bumped `1.0.0 → 1.1.0`; `ensureKernelDetectionPack` stays create-if-missing
  so existing/operator-tuned rows are untouched (additive seed, not a re-assert).
- The EA security-posture extractor projects one `part_usage` per rule and its
  parity test counts `KERNEL_DETECTION_PACK.length` dynamically — the 7 new rules
  flow into the architecture graph automatically, no fixture churn.

## Verified
web typecheck clean; detection-pack 19/19 + detection + sweep + EA security-posture
+ reconcile-sysml-projections green (131 across the security/EA set).
