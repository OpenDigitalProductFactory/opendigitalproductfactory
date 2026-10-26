---
title: "Decision-engine weekly self-review — build plan"
status: draft
backlog: BI-19CEC4B4
epic: EP-0AF96937
design: docs/superpowers/specs/2026-09-10-decision-engine-weekly-self-review-design.md
date: 2026-09-10
---

# Decision-engine weekly self-review — build plan

**Current planning boundary (2026-10-25):** the completion integration amendment below governs proposed remaining work. Phases 1–4 preserve delivery history and original intent; they are not a verified current inventory. The amendment requires independent scope review and immutable plan coverage before implementation.

Phased implementation of the design at `docs/superpowers/specs/2026-09-10-decision-engine-weekly-self-review-design.md`. Each phase is independently shippable and maps to one backlog item; the umbrella is BI-19CEC4B4.

## Phase 1 — measures module and fixture (AC-1, AC-2)

- `apps/web/lib/decision/self-review/measures.ts`: pure, deterministic measures over `ReviewLedgerRow[]` (volume, craft-fallback, starvation, repeat-escalation, empty-question, unlearned, agreement, weight-sensitive); one `REVIEW_THRESHOLDS` module; `computeReviewLines`.
- `measures.test.ts`: fixture reproducing the 2026-09-08 findings; per-measure edge cases; determinism.
- Historical table proposal superseded: use the existing TaskRun/TaskArtifact persistence contract in design section 5; no new review-run or disposition models.
- Loader `load-review-window.ts`: trailing 7 days of `DecisionInteraction` joined with profile kind, plus material counts per profile.
- Deliverable BI: this item (BI-19CEC4B4) until decomposed at plan review.

## Phase 2 — task kind, executor, seed, room digest (AC-6)

- `decision-engine-review` added to `SCHEDULED_AGENT_TASK_KINDS`; executor `decision/self-review/decision-engine-review-task.ts` mirroring `bookkeeping-cycle-task.ts` (idempotent per ISO week, off the LLM path).
- Dispatcher branch in `actions/agent-task-scheduler.ts`.
- Seed: one task per install, cron `0 6 * * 1`, owned by the operator principal.
- Digest posted to the standing governance Workroom named by the concierge design.

## Phase 2 — SHIPPED 2026-09-22

`decision-engine-review` is a scheduled-task kind, seeded on every install at
`0 6 * * 1` (Monday 06:00 UTC, before the bookkeeping cycle so a week of
governance findings is waiting when the operating week opens). The executor
`decision/self-review/decision-engine-review-task.ts` mirrors
`bookkeeping-cycle-task.ts`: deterministic and off the LLM path. The original claim of durable per-ISO-week idempotency is not established by its activity-text lookup; design section 5 and V-PERSISTENCE define the required repair. `load-review-window.ts` is the single read behind it, so the measures
stay pure and every finding is reproducible from a fixture.

Material coverage counts only rows the gate can actually read
(`reviewStatus: approved`, `promotionState: promoted`); draft or unpromoted
material would make a starved profile look fed.

Not yet: the digest is written to the run log, not posted into the standing
governance room. That lands with Phase 3, which owns routing and the
review-page section.

## Phase 3 — routing, attention, review-page section (AC-3, AC-5)

- Routing by scope: WWMD lines to founder review, WWWD to the owner `weekly-digest` lane (`agreement` below threshold escalates to `needs-you-now`), WSID to the registry's accountable coworker.
- `attention/sources/decision-engine-review.ts` source; owner-routing lane rules.
- Review page section "This week's engine review" with confirm / reject / snooze dispositions; rejected lines with unchanged evidence suppressed for 4 weeks.

## Phase 4 — learning wiring (AC-4)

- `examine-weight` lines call `persistWeightAdjustmentProposals`.
- `file-defect` lines file a backlog item with the query as reproduction; WSID `publish-craft-page` lines let the specialist draft via its existing craft path.

## Verification

Unit: fixture and per-measure tests (Phase 1), executor idempotency (Phase 2), routing and suppression (Phase 3), proposal wiring (Phase 4). Live: after deploy, `list_scheduled_agent_tasks` shows the task; a manual `rerun_scheduled_agent_task` produces one logical TaskRun and frozen TaskArtifact result under design section 5, with the review-page projection on the DEV install.

## Completion integration amendment (2026-10-25, draft)

Anchor: BI-19CEC4B4 / EP-0AF96937. Workroom WC-CD6F907A. Source baseline
afd6723da1f1e20bdfd75e41f975fa81e7c89033. This documentation does not implement a fix, approve a
changed scope or close awaiting-acceptance work. Historical phases above retain their scope.

**For agentic workers:** execute one independently reviewable BI at a time, on its own branch/PR.
Follow current DPF red/green, independent-review and delivery procedures. Obtain the immutable
design/plan approval and coverage required by the item's actual shape before implementation.

### Reconcile historical assumptions

| Historical statement | Current source finding / required disposition |
|---|---|
| New review-run/disposition tables are required | Superseded by design section 5: TaskRun/TaskArtifact own review execution/results, proposal records own actual owner rulings, and Workroom/TaskRun evidence owns delegated correction. No new tables. |
| ISO-week lookup establishes complete idempotency | Proposal deduplication and a historical activity lookup do not prove one durable complete review. Verify concurrency, restart and coverage. |
| Every finding becomes a human proposal | Some stop at report/defect-needed or craft nomination. Under design section 10, delegated correction may act; missing authority becomes one owner decision. |
| Seven days of rows measures outcomes overdue a week | Split reporting/overdue populations, canonical provenance-aware denominators and bounded continuation. |
| Task status ok proves review completion | Measurement, routing, correction and verification have distinct coverage; partial failure stays visible. |
| Learning wiring completes the outcome loop | Reported choice/weight proposal is not evidence of effect quality. Link the effect and subsequent observation. |

### Deliverable graph and existing owners

Keys below are stable plan references. Dependencies are sequencing, not implementation admission.
Preserve existing acceptance work and parent decomposition rather than repeat delivered code.

| Key | Live BI | Source seam / scope | Depends on | Requirement refs | Verification refs |
|---|---|---|---|---|---|
| stage-admission | BI-D95FD249 | Preserve admitted delivery-author evidence authority in the existing stage resolver; PR #6592 merged, live acceptance pending | Existing GPP/TAK authority and current funding/delegation | AC-REVIEW-HOLD | V-ADMISSION |
| tool-attachment | BI-8E7F0276 | Explicit required-tool attachment and bounded budget recovery | Existing stage declarations | AC-REVIEW-HOLD | V-ADMISSION |
| blocker-report | BI-E458A9CB | Bound blocked reporting and pending-approval waiting; PR #6588 deployed, broader refusal recovery remains open | Existing stage assignment and approval lineage | AC-REVIEW-HOLD | V-HOLD |
| refusal-hold | BI-412A2F72 | Existing scheduled-work/TaskRun/Workroom holds and relevant-change wakeup | stage-admission | AC-REVIEW-HOLD | V-HOLD |
| delegated-permit | BI-39946DC1 | gpp/bindings.ts, permit-verdict.ts and per-call consequence refinement | Classify actual effects before promotion | AC-REVIEW-LINEAGE | V-PERMIT |
| review-measurement | BI-19CEC4B4 | decision/self-review/load-review-window.ts, measures.ts, decision-engine-review-task.ts | Existing outcome provenance; reproduce first | AC-REVIEW-WINDOW, AC-REVIEW-HONESTY | V-MEASURES |
| outcome-efficacy | BI-FEDD8F45 | GppPermitObservation, ToolExecution/receipts, ExternalEvidenceRecord and decision-outcome stores | Recover owning design/branch; review-measurement | AC-REVIEW-LINEAGE | V-LINEAGE |
| corrective-action | BI-73780C2E | decision/self-review/route-review-findings.ts, decision/resolution-proposal-store.ts, resolution-write-through.ts and existing executor | review-measurement, outcome-efficacy; applicable stage-admission/refusal-hold | AC-REVIEW-CORRECT, AC-REVIEW-UI | V-CORRECT, V-UI |
| reference-demonstration | BI-F3C2EC7A | Canonical-runtime specimen and existing authorized-surface/attention views | Applicable components above and its recorded prerequisites | AC-REVIEW-LINEAGE, AC-REVIEW-UI | V-REFERENCE |

BI-6082C235, BI-F302B80E, BI-01F8F06D and BI-7D1E43DE remain the subject, reported-choice,
shadow-bridge and report-only trust owners. Verify their evidence before proposing deltas.
BI-EAFD2D09 owns duplicate-merge refinement separately. BI-0B8657BD and BI-ADAC33D5 own related
outcome/citation acceptance and reliability. Paired-installation-owned records remain read-only.

BI-E9555B2D remains the xlarge coordination umbrella, not an independently shippable
implementation row. The three admission/reporting rows above reuse their existing delivery
owners. A passing blocked-report write is not delivery-author completion permission or proof
that every historical refusal is parked. Retain these distinct acceptance boundaries.

### Ordered execution and verification

1. **Reproduce and retain evidence.** Re-read live statuses and exact source; establish schedule/run
   health through a bounded read. A truncated listing cannot prove absence. Reproduce window,
   provenance, missing binding and repeated-refusal faults with exact run lineage.
2. **Implement the selected durable review contract and verify measurement before tuning.** Under BI-19CEC4B4, wire the deterministic dispatcher to existing TaskRun/TaskNode execution and TaskArtifact results (design section 5); extend the canonical task-record writer for server-derived IDs and transaction support. Freeze cutoff/definition, persist per-line intended destinations before effects, preserve partial routing failures, and publish the completed artifact reference atomically. V-PERSISTENCE: concurrent ticks, mid-routing crash/restart, identity/content conflict, completed-run replay, changed-definition successor, uncertain effect reconciliation, unauthorized result read and late observation. Assert one frozen result, no duplicated destination, no fabricated human ruling and explicit unknown coverage. Then verify merged measurement. BI-F55BBB6B / PR #6577 repairs the mature-population query and completeness disclosure; do not reimplement it. V-MEASURES: include a ten-day-old unresolved decision,
   recent decision, late outcome, agent report and human choice; test page-limit continuation,
   duplicate ticks, restart, changed policy version and routing failure. Preserve unknowns and
   sample minima. Do not promote weights or trust.
3. **Reconcile admission.** V-ADMISSION/V-PERMIT: delegated intended use proceeds without redundant
   approval; changed arguments/subject, revocation, expiry, denied grants, explicit checkpoint and
   missing reviewer binding retain prescribed outcomes. Ordinary writes gain no Phase-2 permit
   requirement. Shadow-replay the sampled queue; execute none of its historical requests.
4. **Link outcomes.** V-LINEAGE: trace objective and doctrine/vector/weight versions through
   judgment, applicable authorization/permit, execution, effect and observation. Missing or expired
   lineage is incomplete. Reconcile uncertain effects before retry; publish M-1–M-7 denominators.
5. **Complete correction.** V-CORRECT/V-HOLD: a repeated finding retains one action and owner,
   executes only a delegated correction, survives restart, records effect and assesses it after
   its observation window. Changed/revoked authority is rechecked. Ineffective tuning follows its
   declared rollback/hold and remains visible.
6. **Verify the owner view and reference specimen.** V-UI/V-REFERENCE: inline checkpoint, inbox and
   Workroom share durable pending/resolved state after refresh/reconnect. Check keyboard,
   screen-reader, narrow viewport and light/dark flow. Respect opened/dismissed panels. Test
   human takeover, cancellation, duplicate attempts and no surprise queued agent effects.
7. **Tune by observed results.** Compare declared baseline/window against purpose alignment,
   outcome quality, M-2/M-5/M-7, repeated blocks and owner effort. Only recorded correction bounds
   authorize changes. Broader doctrine/threshold/authority/trust changes return to the owner.
   Retain old versions and an explicit no-change disposition when evidence is insufficient.

### Refactoring, compatibility and rollback

Consolidate stage/approval derivation, review denominators and decision/effect correlation in their
existing homes. Add no second approval engine, ledger, scheduler or broad DEV bypass. Repair
collection and routing before expanding tuning capability.

Contract refs: GPP-PURPOSE-LINEAGE (GPP realization section 12), REVIEW-CORRECTION-LIFECYCLE
(review design section 10), REVIEW-PERSISTENCE (review design section 5), TAK-PD-003/006 (hard constraints and exact authorization).
Flow refs: purpose-to-effect-to-observation and finding-to-correction-to-verification.

The audited persistence choice uses existing fields and model policies (design section 5); no additive schema field or table is planned. An implementation finding that disproves this choice requires an explicit scope amendment and the existing data review, rather than a silent carrier change. This amendment makes no schema change. Do not backfill causality from
text similarity. Roll out measurement first, one scope/class in shadow, then a separately authorized
bounded correction. Preserve schedules, evidence and per-binding enforcement mode.

Rollback restores the prior resolver/projector version, revokes affected permits through the
existing path and pauses the affected correction class; history remains. Compensation requires its
own authority/recovery contract. No inference account password is required.

### Backlog coverage

This multi-item integration sequence is proposed, not implementation-ready coverage. All independent
deliverables map to existing live BIs except the newly captured BI-73780C2E, still triaging.
No current provider-verified immutable coverage receipt was established for this amendment.

Publish the relevant revisions, obtain independent scope approval, then record decomposed plan
coverage with mappings, dependencies and the requirement/contract/flow/verification refs above.
Each independently shippable entry must name one live delivery BI in the receipt; split aggregate
rows into their owning existing child items rather than submit an xlarge umbrella as a delivery.
Copy the returned receipt here and revalidate it. Changed scope/artifacts refresh normal coverage;
historical phase prose and this documentation change cannot substitute for a receipt or delivery.
