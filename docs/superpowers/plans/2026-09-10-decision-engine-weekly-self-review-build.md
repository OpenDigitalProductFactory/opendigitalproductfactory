---
title: "Decision-engine weekly self-review — build plan"
status: draft
backlog: BI-19CEC4B4
epic: EP-0AF96937
design: docs/superpowers/specs/2026-09-10-decision-engine-weekly-self-review-design.md
date: 2026-09-10
---

# Decision-engine weekly self-review — build plan

Phased implementation of the design at `docs/superpowers/specs/2026-09-10-decision-engine-weekly-self-review-design.md`. Each phase is independently shippable and maps to one backlog item; the umbrella is BI-19CEC4B4.

## Phase 1 — measures module and fixture (AC-1, AC-2)

- `apps/web/lib/decision/self-review/measures.ts`: pure, deterministic measures over `ReviewLedgerRow[]` (volume, craft-fallback, starvation, repeat-escalation, empty-question, unlearned, agreement, weight-sensitive); one `REVIEW_THRESHOLDS` module; `computeReviewLines`.
- `measures.test.ts`: fixture reproducing the 2026-09-08 findings; per-measure edge cases; determinism.
- `DecisionEngineReviewRun` and `DecisionEngineReviewLineDisposition` Prisma models + migration; unique on `periodKey`.
- Loader `load-review-window.ts`: trailing 7 days of `DecisionInteraction` joined with profile kind, plus material counts per profile.
- Deliverable BI: this item (BI-19CEC4B4) until decomposed at plan review.

## Phase 2 — task kind, executor, seed, room digest (AC-6)

- `decision-engine-review` added to `SCHEDULED_AGENT_TASK_KINDS`; executor `decision/self-review/decision-engine-review-task.ts` mirroring `bookkeeping-cycle-task.ts` (idempotent per ISO week, off the LLM path).
- Dispatcher branch in `actions/agent-task-scheduler.ts`.
- Seed: one task per install, cron `0 6 * * 1`, owned by the operator principal.
- Digest posted to the standing governance Workroom named by the concierge design.

## Phase 3 — routing, attention, review-page section (AC-3, AC-5)

- Routing by scope: WWMD lines to founder review, WWWD to the owner `weekly-digest` lane (`agreement` below threshold escalates to `needs-you-now`), WSID to the registry's accountable coworker.
- `attention/sources/decision-engine-review.ts` source; owner-routing lane rules.
- Review page section "This week's engine review" with confirm / reject / snooze dispositions; rejected lines with unchanged evidence suppressed for 4 weeks.

## Phase 4 — learning wiring (AC-4)

- `examine-weight` lines call `persistWeightAdjustmentProposals`.
- `file-defect` lines file a backlog item with the query as reproduction; WSID `publish-craft-page` lines let the specialist draft via its existing craft path.

## Verification

Unit: fixture and per-measure tests (Phase 1), executor idempotency (Phase 2), routing and suppression (Phase 3), proposal wiring (Phase 4). Live: after deploy, `list_scheduled_agent_tasks` shows the task; a manual `rerun_scheduled_agent_task` produces one run row and the review-page section on the DEV install.
