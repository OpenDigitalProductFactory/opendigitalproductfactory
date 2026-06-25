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

## P1c — scheduling + persistence (DONE)
- `apps/web/lib/queue/functions/siem-correlation-sweep.ts` — `siemCorrelationSweep` Inngest cron (`ops/siem-correlation-sweep`, every 15m, quiescence-gated), modeled on `log-signature-scanner`. Two steps: (1) `runInternalSecurityProjection` flows the platform's own audit telemetry into `SecurityEvent`; (2) `runCorrelationSweep` loads enabled `DetectionRule`s + the active `ThreatIndicator` index, scans the recent `SecurityEvent` window via `evaluateRulesForEvent`, and upserts `Detection` rows on `detectionKey` (replay refreshes `lastSeenAt`, leaves operator-owned `status`/`firstSeenAt` intact).
- Registered in `scheduledFunctions` + `SCHEDULED_JOB_CATALOG`; the catalog↔registry parity guard passes.
- `runCorrelationSweep` unit-tested with a mocked Prisma client (fires on match, inert on no-match).

## Remaining P1 content (fast follow)
- A seed kernel detection pack (failed-logon burst, IOC hit, destructive cloud API call) with ATT&CK tags — the sweep is inert until rules exist (correct/safe default).
- Real enrichment lookups: `InventoryEntity` asset context + `ThreatIndicator` IOC match feeding `enrichSecurityEvent` (the injectable interface is in place).

## Then P2 (BI-5A9A5E03)
SOC coworker roster + `SecurityCase` (Detections group into cases) + security MCP tools/grants + security principles. This is where Detections become an analyst worklist.
