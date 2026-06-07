# Verification — Zero-Config Upstream Feedback Escalation (Phase A)

| Field | Value |
| ----- | ----- |
| Backlog item | `BI-6D45BA27` |
| Plan | [2026-06-06-zero-config-upstream-feedback-escalation.md](../plans/2026-06-06-zero-config-upstream-feedback-escalation.md) |
| Date | 2026-06-06 |
| Verifier | Claude (in-thread) |
| Method | Unit + real-DB integration (dynamic analysis), not screenshots |

## What was driven

**Functional happy path — real Postgres + in-process stub relay** (`lib/actions/feedback-escalation.integration.test.ts`, run against the isolated dev DB on `:5433`, never the live DB on `:5432`):

1. Seeded `PlatformDevConfig.singleton` with `upstreamFeedbackOptIn=true`, `upstreamRelayUrl=<stub>`, `contributionMode=selective`, not paused.
2. Created a real `PlatformIssueReport` whose title/description contained a machine hostname (`DESKTOP-ZZZ9QW`).
3. Invoked the real `escalateReportUpstream({ reportId })` — no mocks on Prisma or HTTP; the action selected the **relay** transport (relay configured) and POSTed to the in-process stub.

## What was observed

- **Result:** `{ ok: true, status: "filed", issueNumber: 4242 }`.
- **Persistence (real row):** `PlatformIssueReport.upstreamIssueNumber=4242`, `upstreamIssueUrl` contains `/issues/4242`, `upstreamSyncedAt` is a real `Date`.
- **Audit (real row):** a `HiveContributionLedger` row with `contributionType="feedback"`, `contributor` matching `^dpf-agent-`, `status="submitted"`, non-empty `payloadHash`.
- **Redaction (relay received):** the stub's captured request body had the hostname stripped — `title`/`body` contain `[redacted]`, not `DESKTOP-ZZZ9QW`.
- **Install authentication:** the relay received header `x-dpf-install-id` matching `^dpf-agent-`.
- **Idempotency:** a second `escalateReportUpstream` returned `{ ok: true, status: "already-filed", issueNumber: 4242 }` with no re-POST.
- **No GitHub call:** because a relay URL was set, the direct GitHub path was never taken (verified by the relay receiving the payload and the install's token being irrelevant to selection).

## Cleanup / safety

- The test refuses to run unless the DB URL targets `:5433` (dev). Live DB received **read-only inspection only**.
- All created rows were deleted and `PlatformDevConfig` restored in `afterAll`; post-run check confirmed `0` leftover report/ledger rows and config back to `upstreamFeedbackOptIn=false`, `upstreamRelayUrl=null`.
- The integration test is gated behind `RUN_DB_INTEGRATION=1`; without it the suite **skips** (confirmed), so CI stays DB-free.

## Gating coverage (unit)

`fileUpstreamFeedback` blocks correctly for opt-out, paused, and `fork_only`; returns `already-filed` when linked; `rate-limited` over cap; surfaces transport `failed`/`skipped`. UI affordance (`FeedbackForm`) shows the consent prompt on first use, files on accept, hides for `fork_only`, and surfaces failures. Coworker tool `escalate_feedback_upstream` shares the same auth-free core.

## Sign-off

Phase A (portal substrate) is **functionally verified** for the relay path end-to-end against a real database. Totals: 51 unit tests + 2 integration tests green; full `tsc` typecheck clean.

**Not yet verified (out of Phase A scope):** the hosted relay service itself (Phase B) and the real GitHub-issue creation it performs server-side; reseller-target and reverse-channel (Phase C). The live consumer install will reach `status:"filed"` once Phase B's relay is deployed and `upstreamRelayUrl` defaults to it.
