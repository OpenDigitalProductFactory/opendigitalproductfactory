# Sovereign SOC — P1 detection engine: implementation plan

- **Date:** 2026-06-24
- **Spec:** [docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md](2026-06-24-sovereign-soc-siem-design.md) §4.3, §6.2–6.5, §7.1
- **Epic:** EP-SOVEREIGN-SOC — **BI-6D9496F1**
- **Builds on:** P0 (`SecurityEvent` spine, committed `96006b31e`)

## Goal

Turn normalized `SecurityEvent`s into `Detection`s via versioned, per-tenant-tunable `DetectionRule` content + threat intel, with deterministic explainable rules before any ML (§7.1).

## This pass (P1a + P1b — engine core, committed together)

### Data models (P1a)
- `DetectionRule` / `Detection` / `ThreatIndicator` — `packages/db/prisma/schema.prisma` (§6.2/6.3/6.5). Migration `20260624130000_add_detection_models`. `DetectionRule.scopeKey` carries the kernel-pack-vs-tenant-overlay distinction; `Detection.detectionKey` gives replay idempotency; both `Detection` and (later) retention use a `createdAt` index. `ThreatIndicator` indexed value-first for the observable-match path.

### Pure evaluator + matcher (P1b)
- `apps/web/lib/security/threat-intel.ts` — `buildIndicatorIndex` (validity-filtered value index) + `matchIndicatorValues` (deduped observable match).
- `apps/web/lib/security/detection.ts` — the `DetectionPredicate` DSL (`classUid` / `sourceKind` / `minSeverityId` / `equals` dotted-path / `matchThreatIndicator` / `allOf` / `anyOf`), `matchPredicate`, `ruleAppliesToScope` (kernel applies everywhere; overlay only its scope), and `evaluateRulesForEvent` → `DetectionCandidate[]` (severity→risk with an IOC boost, ATT&CK technique carry-through). Pure of Prisma; the sweep injects rows + the indicator index.
- Tests: `apps/web/lib/security/detection.test.ts` (10 cases — index expiry, predicate operators, scope gating, firing/non-firing, IOC boost).

**Verified:** db/web typecheck clean; detection 10/10 (plus the P0 suites still green).

## Next pass (P1c — scheduling + persistence)
- `siem/correlation-sweep` Inngest scheduled function modeled on `apps/web/lib/queue/functions/log-signature-scanner.ts`: load enabled `DetectionRule`s + the active `ThreatIndicator` index, scan the recent `SecurityEvent` window, run `evaluateRulesForEvent`, upsert `Detection` rows on `detectionKey` (replay-idempotent), advance a cursor.
- Register in `SCHEDULED_JOB_CATALOG` + the catalog parity test.
- Wire `runInternalSecurityProjection` (P0) to a scheduled trigger so internal audit events actually flow into `SecurityEvent` before the sweep runs.
- Real enrichment lookups: `InventoryEntity` asset context + `ThreatIndicator` IOC match feeding `enrichSecurityEvent`.
- A seed kernel detection pack (a handful of starter rules: failed-logon burst, IOC hit, destructive cloud API call) + ATT&CK technique tags.

## Then P2 (BI-5A9A5E03)
SOC coworker roster + `SecurityCase` (Detections group into cases) + security MCP tools/grants + security principles. This is where Detections become an analyst worklist.
