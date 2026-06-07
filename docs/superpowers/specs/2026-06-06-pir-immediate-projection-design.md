# PlatformIssueReport — Immediate (Event-Driven) Backlog Projection

| Field | Value |
| ----- | ----- |
| Status | Draft |
| Date | 2026-06-06 |
| Epic | `EP-INTAKE-UNIFY` — Phase 4 |
| Backlog item | BI-EDFBE081 |
| Supersedes-in-part | [Unified backlog + workType (2026-05-30)](2026-05-30-unified-backlog-worktype-design.md) §4.10 "synchronous PIR→BI projection" (Phase 2, deferred there). This is that work, done event-driven rather than in-request. |
| Related substrate | [`apps/web/lib/quality/platform-issue-reports.ts`](../../../apps/web/lib/quality/platform-issue-reports.ts); [`apps/web/lib/queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts); [`apps/web/lib/operate/issue-report-triage.ts`](../../../apps/web/lib/operate/issue-report-triage.ts); [`apps/web/lib/queue/inngest-client.ts`](../../../apps/web/lib/queue/inngest-client.ts); [`apps/web/lib/queue/functions/index.ts`](../../../apps/web/lib/queue/functions/index.ts); [`apps/web/app/(shell)/admin/issue-reports/page.tsx`](../../../apps/web/app/(shell)/admin/issue-reports/page.tsx) |
| Scope | Project an OPEN `PlatformIssueReport` into the backlog within seconds of creation via a durable Inngest event, instead of waiting up to 15 minutes for the triage cron. Extract the cron's prisma-deps wiring into a reusable `runIssueReportTriage({ reportId? })` runner shared by both paths. Keep the 15-minute cron as a safety-net sweep (catches any report whose event was dropped or arrived during quiescence) and as the home of spike detection. Reframe the Admin issue-reports copy. |
| Out of scope | Retiring the cron entirely (kept as safety-net + spike — the historical-baseline spike check genuinely needs a schedule). Routing PIR projection through the shared `ingestBacklogItem` front door (the PIR path keeps its specialized title-dedup + LLM triage; front-door convergence is a separate fast-follow). Folding `/admin/issue-reports` into a `/ops` filtered view (Phase 6 UI). The support-flow lifecycle (`support_triage` and downstream) — untouched. |

---

## 1. Problem

`PlatformIssueReport` already reaches the backlog — but only on a 15-minute cron tick ([`queue/functions/issue-report-triage.ts`](../../../apps/web/lib/queue/functions/issue-report-triage.ts), `cron("*/15 * * * *")`). So a reported bug can sit invisible for up to 15 minutes before it appears as a `BacklogItem`. The other intake queues (improvements, capability needs, signals) now project the instant they're detected; PIR is the laggard. This is the synchronous projection the 2026-05-30 spec named and deferred.

## 2. Current Repo Truth (verified)

| Area | Behavior | Implication |
| ---- | -------- | ----------- |
| PIR creation | Single writer `createPlatformIssueReport` ([`platform-issue-reports.ts:100`](../../../apps/web/lib/quality/platform-issue-reports.ts)); status defaults to `open` unless a caller sets it (support flow sets `support_triage`). | Emit the projection event here, only when the effective status is `open`. |
| Cron projection | `triageIssueReports` ([`operate/issue-report-triage.ts`](../../../apps/web/lib/operate/issue-report-triage.ts)) — pure, deps-injected; the cron wires prisma deps inline and selects `status=open` (take 100). Builds `BI-PIR-*` items, `workType="bug"`, `source="automated-detection"`, body embeds `Source report: PIR-XXXXX`; dedups by title (+ optional LLM); on success sets PIR `open → triaged_local`. | Extract the deps wiring into a runner parameterized by an optional `reportId`. Identical behavior for the batch case. |
| Promotion path | [`governed-backlog-tee-up.ts`](../../../apps/web/lib/governed-backlog-tee-up.ts) parses `PIR-[A-Z0-9]+` out of the BI body to fetch fix context. | The body marker MUST be preserved — the runner already produces it; unchanged. |
| Dependents on the tick | Verified: nothing waits for the cron heartbeat. Admin stats + posture cards read PIR **status** (now set the moment the event handler runs); promotion reads the **BI** + body marker; reflection/regression/coworker code do not read triage output or `triaged_local`. | Event-driven projection (or the cron) sets `triaged_local` either way — no reader breaks. |
| Spike detection | `checkForSpike` needs a 7-day hourly baseline. | Stays in the cron (a per-report event has no baseline). |

## 3. Design

### 3.1 Reusable runner
Extract the cron's inline triage wiring into `runIssueReportTriage(opts?: { reportId?: string })` ([`apps/web/lib/operate/issue-report-triage-runner.ts`](../../../apps/web/lib/operate/issue-report-triage-runner.ts)): wires prisma deps + optional LLM and calls `triageIssueReports`. `getOpenReports` filters `status=open` plus `reportId` when supplied (`take` 1 vs 100). Behavior for the batch (no `reportId`) is byte-identical to today.

### 3.2 Emit on creation
After `createPlatformIssueReport` inserts the row, if the effective status is `open`, send a durable Inngest event `quality/issue-report.created` with `{ reportId }`. Best-effort (wrapped, non-fatal): a send failure never fails PIR creation, and the cron safety-net still sweeps the report on the next tick. Support-flow reports (status ≠ `open`) are not emitted.

### 3.3 Event handler
New `issueReportProjectOnCreate` ([`apps/web/lib/queue/functions/issue-report-project.ts`](../../../apps/web/lib/queue/functions/issue-report-project.ts)) on `quality/issue-report.created` → `runIssueReportTriage({ reportId })`. Idempotent: if the cron (or a prior event) already projected the report, it is no longer `status=open`, so `getOpenReports` returns nothing and the handler is a no-op. Honors the quiescence gate like the cron.

### 3.4 Cron stays — as safety-net + spike
The cron keeps running every 15 minutes, now calling the same runner for the batch, plus `checkForSpike` and the job-run record. Its role is reframed (header comment): the fast path is the per-report event; the cron is the guarantee + the spike detector.

### 3.5 Admin copy
[`/admin/issue-reports`](../../../apps/web/app/(shell)/admin/issue-reports/page.tsx): change "projects to a backlog item … on the next 15-minute triage tick" → projects "immediately (a 15-minute sweep is the safety net)".

## 4. Why event-driven, not in-request
The cron uses an LLM for semantic dedup/triage and loads the full bug-class title pool. Running that on the `createPlatformIssueReport` request thread would add latency and a failure surface to every crash-boundary/report call. A durable Inngest event moves the work off the request thread, keeps the LLM out of the hot path, and inherits Inngest's retries — while the cron remains the backstop.

## 5. Verification Gates

| Layer | What |
| ----- | ---- |
| Unit | `platform-issue-reports.test.ts`: emits `quality/issue-report.created` for an OPEN report, does NOT emit for a support-flow status, send failure is non-fatal. Runner test: `reportId` scopes the `getOpenReports` query. Existing `operate/issue-report-triage.test.ts` (pure logic) stays green. |
| Typecheck / build | `pnpm --filter web typecheck`; `pnpm --filter web build`. |
| Functional (live install) | Submit a quality report; confirm a `BI-PIR-*` item appears in `/ops` within seconds (not 15 min), with the `Source report: PIR-…` marker; re-submit the same title → occurrenceCount bumps, no duplicate. |

## 6. Next
Phase 5 (audit-ledger remediation through the front door) and Phase 6 (UI fold — `/admin/issue-reports` + the other origin pages become evidence views of one backlog).
