---
title: "Decision-engine weekly self-review"
status: draft
backlog: BI-19CEC4B4
epic: EP-0AF96937
date: 2026-09-10
---

# Decision-engine weekly self-review

_Status: draft · BI-19CEC4B4 · EP-0AF96937 · branch `feat/decision-engine-weekly-self-review`_

## Current reconciliation status (2026-10-25)

Sections 1–9 preserve the original design and acceptance history. They describe intent, not a
verified deployed inventory. Section 10 proposes completion integration. The human-only correction
assumption changes only after its amendment is approved and a valid delegation exists; current
controls remain in force.

Source baseline: origin/main afd6723da1f1e20bdfd75e41f975fa81e7c89033. BI-19CEC4B4 remains
awaiting-acceptance. Measures, executor and proposal routing exist; that does not prove an
end-to-end corrective loop. The two review-run/disposition models proposed below were not found
in the inspected schema. Do not create tables merely to match this historical prose.

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

## 10. Outcome review and corrective action (2026-10-25 proposal)

### 10.1 Evidence and completion boundary

This is the implementation companion to
[GPP model-to-execution design](2026-10-01-gpp-model-to-execution-design.md). Its prepared purpose-to-outcome amendment is a separate publication; no missing amendment confers runtime authority.
BI-19CEC4B4 retains measurement/routing. BI-73780C2E owns the independently shippable correction
lifecycle. Design approval, immutable coverage and implementation admission remain pending.

The 2026-10-25 trust report contained 15 class rows: 1,428 decisions, zero human samples, 31
agent-reported choices, nine downstream outcome resolutions, 1,186 without a recommendation and
202 unresolved. Evaluation time: 12:41 UTC. This report population is not every approval; sparse
linked outcomes do not establish a causal diagnosis.

The inbox snapshot held 26 pending envelopes: 20 blocked-run evidence writes, three handoffs, two
research receipts with the same visible rationale/missing-binding error, and one backlog merge.
Ten recent displayed results were authorized; three did not complete. This bounded sample is not
a historical approval or safety rate.

Source findings at the original snapshot, with delivery reconciliation:
- The loader selects the trailing seven days, while measureUnlearned selects rows at least seven
  days old. Normal populations overlap only at the cutoff.
- measureAgreement reads chosenOptionId without the human/agent provenance used by the trust
  report, but labels the result human agreement. Reuse canonical denominator rules.
- Unlearned/no-comparison lines are no-action. Some actionable findings stop at reported or
  needs-defect-filed. Routing errors can become an empty summary while lastStatus becomes ok.
- PR #6577 adds look-ahead and completeness disclosure at the 20,000-row limit; this bounds returned rows, not database scan cost. Verify runtime cost before declaring acceptance.
- The existing owned decision-engine-review-weekly task was located through a bounded metadata read. Its last observed run was healthy, but this is not evidence that correction and follow-up are complete; retain the existing task and cron.

### 10.2 Cadence, populations and outcome quality

Retain the existing weekly task and operator-owned schedule. Use existing operational events for
material failures between reviews; do not create a second scheduler. Repeated unsuccessful firings
are distinct from retries within a dispatch. BI-412A2F72 owns bounded holds/relevant-change wakeups;
thresholds follow job purpose and risk, not a borrowed fixed number.

Separate populations: decisions created in the reporting window, unresolved decisions whose
outcomes are overdue, and corrections whose follow-up window has matured. Use a separate indexed,
bounded traversal for overdue work, not a wider capped query. Compare the prior equivalent window
and retain late observations without rewriting history. Page or record explicit incomplete coverage.

Publish existing GPP M-1–M-7 through BI-FEDD8F45 alongside purpose/constraint violations,
ineffective/uncertain/duplicated/reversed effects, missing outcome evidence, unnecessary human
interruptions, repeated blocks, corpus/routing gaps and weight sensitivity. Track corrections
applied, held, ineffective, verified and still awaiting sufficient evidence.

Keep human concordance, agent-reported choices and independent/system observations separate.
Agreement is not correctness; a later change is not proof of causality. Preserve observer, expected
result, provenance and attribution limitations. Retain minimum-sample reporting and representative
qualitative audits. Zero observed failures with incomplete observation is not a safety result.

### 10.3 Correction through existing authority

Each finding has a stable scope/class identity, accountable owner, evidence/window, proposed action,
expected outcome, follow-up due time and explicit disposition. Refresh evidence on the same open
finding; do not duplicate it or silently alter an approval's exact content. Materially changed
evidence creates an attributable successor.

Reuse DecisionResolutionProposal, Workroom/TaskRun execution and evidence. Audit their canonical
fields before adding any table/type/tool. Persist measured and routed coverage; console output
alone is insufficient. The historical proposed model names are not a schema mandate.

Required lifecycle: measured finding -> owned disposition -> permitted correction -> recorded
effect -> follow-up observation -> verified, ineffective or explicitly insufficient evidence.
Map this onto existing canonical statuses rather than creating a second lifecycle vocabulary.

Correction delegation names permitted operation classes, target scope, maximum change,
budget/retry bounds, validity, reviewer requirement and rollback. Collecting evidence, drafting
corpus and repairing routing follow their existing authority/delivery paths. Weight changes require
an explicit delegation naming allowed axes, range, versioning and evaluation. Review cannot grant
itself access, publish governing doctrine, retire controls or promote trust from favorable statistics.

A settled correction inside valid delegation acts through GPP/TAK and normal delivery gates.
Otherwise send one named decision to the owning scope with the missing authority or policy choice.
Missing input, denied authority, missing evidence and transport faults have distinct remedies.
An uncertain effect is reconciled before retry or handled through verified idempotency.

Measurement may finish while correction remains open. Report measured/routed/actioned/verified
coverage separately. Routing failure or an immature observation window prevents claiming the loop
complete. Ineffective/harmful tuning follows its declared rollback or bounded hold through the same
authority path, preserving original failure evidence.

### 10.4 Owner experience

Compose existing attention, owner-decision, report-kit and authorized-surface projections:
- Separate required judgment from unread information and technical recovery.
- Show weekly changes, results and coverage; only material owner decisions enter Needs you.
- Present a genuine inline checkpoint and central inbox using one envelope, with purpose, scope,
  consequence, governing reason and accountable resolver.
- Reconstruct pending/resolved state and evidence after refresh/reconnect from durable records.
- Typed connector/readiness remedies reach the principal able to fix them; an unrelated approval
  cannot repair missing configuration or authority.
- Respect user-opened evidence panels and preserve a dismissal for the run.

Verify keyboard and screen-reader flow, meaningful labels, narrow viewports and light/dark themes.
No new approval control is introduced by this amendment.

### 10.5 Objectives and acceptance

**OBJ-REVIEW-COVERAGE:** Reviews distinguish complete measurement from missing outcome/routing coverage.

**OBJ-REVIEW-PURPOSE:** Corrections preserve versioned purpose, constraints and weighted tradeoffs through GPP action and observed outcome.

**OBJ-REVIEW-CLOSE:** Actionable findings reach an owned disposition and executed corrections receive subsequent result assessment.

| Acceptance | Objectives | Statement | Owning item |
|---|---|---|---|
| AC-REVIEW-WINDOW | OBJ-REVIEW-COVERAGE | A decision older than seven days without an outcome is reported; human, agent and observed-result populations remain separate; a window beyond the page limit is traversed or explicitly incomplete. | BI-19CEC4B4 |
| AC-REVIEW-LINEAGE | OBJ-REVIEW-PURPOSE | A reference case links objective and doctrine/vector versions through judgment, applicable authority/permit, execution, effect and independently evidenced outcome; missing edges are reported. | BI-FEDD8F45, BI-F3C2EC7A |
| AC-REVIEW-CORRECT | OBJ-REVIEW-CLOSE | Repeated reviews maintain one owned correction per unchanged finding, act only within current delegation, preserve failures and assess results after the observation window. | BI-73780C2E |
| AC-REVIEW-HOLD | OBJ-REVIEW-CLOSE | Unchanged settled refusals do not redispatch; relevant change revalidates authority and resumes the same work without duplicate effect. | BI-412A2F72 |
| AC-REVIEW-UI | OBJ-REVIEW-COVERAGE, OBJ-REVIEW-CLOSE | Results and genuine judgment requests share durable state across inline/inbox views and refresh; keyboard, screen-reader, narrow viewport and light/dark checks pass. | BI-73780C2E |
| AC-REVIEW-HONESTY | OBJ-REVIEW-COVERAGE | Routing failure and incomplete traversal are visible and cannot count as full completion; shadow agreement never changes runtime autonomy. | BI-19CEC4B4, BI-7D1E43DE |

### 10.6 Research and overlap disposition

- [OPA decision logs](https://www.openpolicyagent.org/docs/management-decision-logs): adopt decision
  identity, evaluated policy revision and masked input/result patterns; retain the DPF monitor/store.
- OpenBot peer source review at 46642d6c91daa663bccff673595f4e12a419a496:
  [inline approval](https://github.com/CopilotKit/OpenBot/blob/46642d6c91daa663bccff673595f4e12a419a496/app/src/components/approvals/inline-approval.tsx)
  and [automatic learning](https://github.com/CopilotKit/OpenBot/blob/46642d6c91daa663bccff673595f4e12a419a496/docs/automatic-learning.md).
  Adopt one approval record across views and separation of collection, publication and tool authority.
  This is handed-off source research: OpenBot was not run, visual usability was not verified and
  this pass could not refetch those pinned files. Reject default-allow, fixed failure thresholds,
  volatile activity state and hosted dependencies as DPF requirements.
- [Anthropic](https://www.anthropic.com/research/trustworthy-agents): adopt objective/plan-level
  oversight with intervention for material exceptions; not unrestricted agency.
- [OpenAI agent guide](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf):
  adopt effect-sensitive intervention and bounded recovery, subject to recorded DPF policy.
- [DORA](https://dora.dev/capabilities/streamlining-change-approval/): adopt review near the work and
  automated validation while retaining independence and mandatory controls.

BI-0B8657BD owns proactive-review outcome/citation acceptance, not this weekly correction executor.
Reuse that boundary and BI-ADAC33D5 outcome reliability rather than redefine correctness.
BI-E9555B2D owns stage authority, BI-FEDD8F45 efficacy and BI-F3C2EC7A the reference demonstration.
The correction successor BI-73780C2E differs from BI-19CEC4B4 measurement/routing and BI-31159978
reviewer-writer schema repair. Component delivery status is not live integration evidence.

### 10.7 Current approval-noise reference case and delivery sequence

The served inbox observed on 2026-10-25 (America/Chicago; observation 2026-10-26T00:32Z) displayed 15 pending approvals and 10 other notices. Visible pending envelopes include ordinary Workroom evidence writes with outcome blocked. Three successive WC-31246E11 requests say the prior evidence request is awaiting approval. The displayed propose boundary requests a separate owner authorization for each write. This observation establishes a repeated interruption path, not permission to approve or replay those requests.

Refactor the existing authority resolver and stage projection to distinguish append-only observability from a gate ruling. A blocked or inconclusive fact may be recorded only for the validated actor, assigned Workroom, current subject and stage; its payload must not mint a receipt, complete a stage, approve a design, publish doctrine, widen a grant or cause an external effect. A stage-bound observation does not turn a proposed implementation into an authorized implementation. Validate required input and exact source bindings before creating an approval envelope. Missing technical context returns a named repair to the agent; it is not a human policy choice. Preserve denials and genuine checkpoint ownership.

The first implementation comparison must reproduce this distinction through the actual governed entry point: ordinary bound blocked evidence, wrong room, missing task/stage binding, attempts to write a pass or completion receipt, explicit human checkpoint, expired or revoked mandate, and changed arguments. Show whether each call executed, was refused, requested input or required judgment, with no historical queue replay. Measure owner interruptions per distinct effect, duplicate unchanged requests and recorded outcome coverage before and after. Do not count hidden cards as reduced approvals.

Publish this review amendment first, then the separate GPP correlation amendment, preserving both original artifacts in aeeafe0ca70a25696a8d077b157611cecb63ee36. Independent approval and live plan coverage are owed by implementation; documentation publication alone grants no new execution authority. BI-73780C2E owns correction-and-follow-up, with the stage/admission owners in section 10.6 retaining their scopes.
