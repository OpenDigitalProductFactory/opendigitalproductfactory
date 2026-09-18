---
title: "Decision-engine weekly self-review"
status: draft
backlog: BI-19CEC4B4
epic: EP-0AF96937
date: 2026-09-10
---

# Decision-engine weekly self-review

_Status: draft · BI-19CEC4B4 · EP-0AF96937 · branch `feat/decision-engine-weekly-self-review`_

## 1. Problem

Founder direction, 2026-09-08: the platform must review its own decision engine weekly and present to the right human what may or should change: how many decisions were made, where corpus is missing, where weights need examining.

Measured on the DEV install (ledger 2026-08-24 to 2026-09-09, 949 `DecisionInteraction` rows): 888 WWMD, 58 WWWD, 3 WSID; 348 profession-gate consults fell back to platform doctrine unseen; `chosenOptionId` and `humanOutcome` were null on every row; `DecisionShadowLedger` and `DecisionResolutionProposal` were empty; 10 escalations carried an empty question. Every one of those facts was derivable from columns already in Postgres, and nothing computed them. The pieces that exist do not talk: `ProfessionCorpusGap` (11 open, no consumer), `ProfessionCorpusUsageStat` (1,374 injections, never compared with WSID decisions), `founder-review/queue.ts` (escalations only), the `ai-decision` attention source (residue only), the golden-drift check on the review page (2 WWMD scenarios). The kernel principle `commons-are-curated-not-just-appended` prescribes a cadence review by the accountable human and gives that human nothing to review from.

## 2. What already exists (fuse, do not build)

- `ScheduledAgentTask` with a closed `taskKind` set; `bookkeeping-cycle` is the deterministic, off-LLM weekly kind (`finance/bookkeeping/bookkeeping-cycle-task.ts`), idempotent per period. The review is the same shape.
- Standing governance Workroom pattern (BI-A2234157) and the Decision Concierge draft (`2026-08-23-decision-concierge-design.md` §4.6): a room that receives a digest per sweep. The concierge proposes rulings for individual decisions; this review reports on the engine. They share the room and the cadence, not the content.
- Attention plane: `attention/sources/*`, owner lanes `needs-you-now | weekly-digest | custodian` (`owner-routing.ts`), weekly digest disposition (`weekly-digest-preferences.ts`).
- Ledger columns: `gateKey`, `gateFallbackUsed`, `fallbackProfileId` (stamped since #5261), `outcomePayload.professionKey`, `sensitivity`, `sensitivityUnstable`, `featureCoverageWeak`, `autonomyBlockers`, `chosenOptionId`, `humanOutcome`, `recommendedOptionId`.
- `craft-consult-demand.ts` (#5261) is the first review measure, already on the review page.
- `weight-inference-adapter.ts` and `weight-proposal-store.ts` exist with no non-test caller; the review is their caller.
- `propose_improvement` (contribution-hive pack) files a backlog item from a coworker.

## 3. Research and benchmarking

- **Google SRE error-budget review** (SRE Book ch. 4, Workbook ch. 2): a weekly, deterministic report over recorded SLIs, read by the owning team, with a fixed set of questions and a policy that names who acts. Adopted: fixed measure set, weekly cadence, owner-named routing. Rejected: a single global owner; DPF has three scope owners.
- **Evidently AI / Arize model-monitoring reports**: drift, data quality and performance computed from logged predictions and (when available) ground truth, with "no ground truth yet" as an explicit state. Adopted: unlearned-outcome counting as a first-class measure, agreement rate computed only over rows with a human outcome. Rejected: statistical drift tests on axis scores; DPF's ±ε sensitivity flag is already persisted per decision.
- **Great Expectations checkpoints**: a run is a set of named expectations over a data window, each pass/fail with a threshold owned in code. Adopted: each measure is a named expectation with a threshold and an owner. Rejected: a separate data-docs site; the report lands in the existing room and attention plane.
- Standard followed: ISO/IEC 42001 clause 9 (monitoring, measurement, analysis and evaluation of an AI management system) as the shape of "measure, evaluate, present to management on a cadence".

## 4. Design

### 4.1 Measures (deterministic SQL over the trailing 7 days, prior 7 for deltas)

| Key | Measure | Threshold that raises a line | Scope owner |
|---|---|---|---|
| volume | decisions by scope (profile kind), gate, routeContext, outcome, riskTier | always reported | all |
| craft-fallback | profession-gate rows with `gateFallbackUsed`, per (professionKey, domainClass) | any | WSID specialist for that key |
| starvation | decisions per material row, per profile | > 20 decisions per row | scope of the profile |
| repeat-escalation | defer/escalate rows sharing normalised question text or `/tool/` route | ≥ 3 in the week | scope of the profile |
| empty-question | defer/escalate rows whose question is a bare label | any | WWMD (defect) |
| unlearned | rows older than 7 days with `recommendedOptionId` set and `chosenOptionId` null | ratio > 0.5 per gate | scope of the gate |
| agreement | rows with both ids: share where chosen = recommended, per scope and domainClass | < 0.7, or no rows at all | scope of the gate |
| weight-sensitive | rows with `sensitivityUnstable` or non-empty `sensitivity.flippingPrincipleIds`, grouped by driving principle | any principle flipping ≥ 3 decisions | WWMD |
| corpus-gap | `ProfessionCorpusGap` open > 14 days; `wsid-*` material never above derived tier; org stance material still B/0.6 | any | WSID / WWWD |

Each measure yields zero or more **review lines**: `{ measureKey, scope, ownerRef, headline, evidence (query + counts), proposedAction, actionRef }`. `proposedAction` is one of: confirm-material, publish-craft-page, examine-weight, file-defect, capture-stance, no-action. Lines are the proposal set; the human confirms or rejects each.

### 4.2 The run

New `taskKind: "decision-engine-review"` in `SCHEDULED_AGENT_TASK_KINDS`, executor `decision/self-review/decision-engine-review-task.ts` mirroring `bookkeeping-cycle-task.ts`: deterministic, idempotent per ISO week (`periodKey`), off the LLM path. It writes one `DecisionEngineReviewRun` row (period, computed measures as JSON, line count, routed count) and posts the digest into the standing governance Workroom the concierge design names. Seeded on every install by the scheduled-task seed with the default cron `0 6 * * 1` (Monday 06:00 UTC), owned by the install's operator principal.

### 4.3 Routing (the "right human")

- WWMD lines → founder / contributor review lane (existing founder-review wording).
- WWWD lines → the org owner via the `weekly-digest` attention lane; a line whose measure is `agreement` below threshold escalates to `needs-you-now`.
- WSID lines → the accountable specialist coworker for `professionKey` (registry `roles[0]`), which may act within its authority (draft a craft page, file its own corpus BI through `propose_improvement`) and reports what it did in the next run. Confirmation stays human.

A line is never auto-applied. `examine-weight` lines feed `persistWeightAdjustmentProposals` (existing, currently uncalled) so they surface as weight proposals on the review page; `confirm-material` and `publish-craft-page` lines link to the existing craft and stance pages; `file-defect` lines file a backlog item with the query as reproduction.

### 4.4 Surfaces

- Review page section "This week's engine review": the latest run's lines grouped by scope, each with confirm / reject / snooze; rejected lines carry a reason that the next run reads (a rejected line with the same key and unchanged evidence is not re-raised for 4 weeks).
- Attention plane: a new `decision-engine-review` source emitting one item per routed line, lane per §4.3.
- `DecisionEngineReviewRun` is queryable so week-over-week deltas are computed from prior runs, not recomputed history.

### 4.5 Guardrails

- Deterministic measures only; no LLM in the run. The specialist's follow-up is an ordinary coworker task with its own budget.
- Every line carries the query that produced it; a line without evidence is not emitted.
- Thresholds live in one module with a test per measure over a fixture ledger.
- The run never writes to any corpus; only the human's confirmation or the specialist's draft-first path does.

## 5. Data model

- `DecisionEngineReviewRun { runId, periodKey, startedAt, completedAt, measures Json, lines Json, routedCount, status }`, unique on `periodKey`.
- `DecisionEngineReviewLineDisposition { runId, lineKey, disposition (confirmed|rejected|snoozed), reason, byPrincipalId, at }`.
- No change to `DecisionInteraction`.

## 6. Objectives

**OBJ-1:** Every install computes a weekly, deterministic review of its decision engine from the ledger it already keeps.

**OBJ-2:** Each finding reaches the human or specialist who owns that scope, as a proposal with its evidence, never as an applied change.

**OBJ-3:** Rejections and confirmations are remembered so the review converges instead of nagging.

## 7. Acceptance criteria

| AC-ID | Objectives | Statement |
|---|---|---|
| AC-1 | OBJ-1 | A fixture ledger reproducing the 2026-09-08 measurements yields lines for craft-fallback (enterprise-architecture, 348), unlearned (kernel-consult, ratio 1.0), empty-question (4 tool names) and starvation (mark-dpf-platform). |
| AC-2 | OBJ-1 | Running the task twice in one ISO week produces one `DecisionEngineReviewRun`. |
| AC-3 | OBJ-2 | Lines route by scope: WWMD to founder review, WWWD to the owner digest lane, WSID to the registry's accountable coworker; each line carries its query and counts. |
| AC-4 | OBJ-2 | `examine-weight` lines appear as weight proposals on the review page through the existing proposal store; no run writes to `WikiPage` or `PerspectiveMaterial`. |
| AC-5 | OBJ-3 | A rejected line with unchanged evidence is not re-emitted for 4 weeks; a confirmed line is not re-emitted while its evidence trends down. |
| AC-6 | OBJ-1 | The task is seeded on a fresh install and appears in `list_scheduled_agent_tasks`. |

## 8. Phasing

1. Measures module + fixture tests + `DecisionEngineReviewRun` (AC-1, AC-2).
2. Task kind, executor, seed, room digest (AC-6).
3. Routing + attention source + review-page section with dispositions (AC-3, AC-5).
4. Weight-proposal and corpus-BI wiring (AC-4).

## 9. Non-goals

Per-decision rulings (concierge); golden panels per profession (own item); changing any threshold in the gates themselves.
