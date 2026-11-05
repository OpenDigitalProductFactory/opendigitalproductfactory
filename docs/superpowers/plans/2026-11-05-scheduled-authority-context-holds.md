---
status: draft
---

# Scheduled authority holds — BI-412A2F72

**Status:** implementation plan; current controlled characterization and complete wake-input binding remain prerequisites. No feature delivery or runtime acceptance is claimed.

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus this plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Objective and existing design

**OBJ-HOLD:** A settled governed refusal stops repeated scheduled attempts until a relevant recorded fact changes. A changed fact permits current authority validation, never execution by itself.

This is the existing parent requirement **OBJ-REVIEW-CLOSE / AC-REVIEW-HOLD / V-HOLD** in [the weekly-review design](../specs/2026-09-10-decision-engine-weekly-self-review-design.md) and [its build plan](2026-09-10-decision-engine-weekly-self-review-build.md), published by PR #6602. This child adds no approval engine, scheduler, table, grant, new persistent status or independent decision policy. BI-E458A9CB owns same-turn refusal recovery; BI-39946DC1 owns per-call consequence agreement; BI-73780C2E owns correction execution and outcome assessment. Their delivery does not satisfy this child's scheduled/restart contract.

### Acceptance criteria (verbatim from the live item)

1. Reproduce the relevant repeated scheduled refusal with TaskRun/tool lineage before implementation.
2. Consume the existing governed disposition and persist a bounded hold through canonical TaskRun/Workroom/scheduled-work state; no second scheduler or status vocabulary.
3. Unchanged authority, stage, evidence and routing facts do not re-dispatch the same blocked operation or repeat human requests.
4. A relevant recorded change wakes the existing work and revalidates all current authority before execution; unrelated changes do not wake it.
5. Pending approval, missing input, transport failures and inconclusive checks retain their distinct recovery rules.
6. Tests cover restart/resumption, revocation, changed stage/subject and unrelated revisions; measure live repeated-refusal reduction without claiming correlation as cause.

## Grounding and present evidence

Reviewed source: main at `36e41146b69db5a181be3380f611abce8eff06d1`. The delta from earlier review base `63949b3fa953cc00f166015140b125c3d3a6a19a` changes build-review refresh and local-provider capacity, not the scheduled-hold surfaces below. PR #6875 already supplies typed required-writer termination and provider-busy handling; PR #6912 already preserves successful reads during correction and supplies a scheduled effort warrant. Keep both.

The bounded Nov 5 database re-read confirms that a Nov 3 scheduled TaskRun recorded three `authority_denied / refused` tool results, followed by another TaskRun ten minutes later with no tool execution. This is historical lineage, not proof of identical authority inputs or that refusal caused the later provider failure. Private run/tool identifiers stay in native item evidence. Do not reactivate that task, replay its requests, or call this a controlled current-build reproduction.

Existing contracts and carriers:

- `apps/web/lib/govern/authority/governed-rejection-disposition.ts`: canonical refused / awaiting-person / awaiting-input / inconclusive classification.
- `apps/web/lib/tak/agentic-result.ts` and `agentic-loop.ts`: loop results currently reduce settled refusals to policy-or-capability prose. Preserve structured tool result and provenance rather than parsing the sentence.
- `apps/web/lib/actions/agent-task-scheduler.ts`: required-writer correction excludes provider deferral but not a typed settled authority hold. Run-failure detection omits typed result failure. Generic settlement re-arms retry/cron.
- `apps/web/lib/tak/scheduled-task-runs.ts`: existing required-tool and terminal verdict helpers; retain proposal precedence and persisted successful work.
- `apps/web/lib/actions/agent-task-claim.ts`: `withCurrentScheduledTask` / `lockCurrentScheduledTask` fence the current commission, owner, run, cadence and scope under a row lock.
- `TaskRun.progressPayload`: authoritative durable hold evidence for the existing run. `ScheduledAgentTask` / `ScheduledJob` are fenced projections, not separate authority.
- `apps/web/lib/work-management/workroom-drive-checkpoint.ts`, `writeback-latch.ts`, and `apps/web/lib/queue/functions/workroom-drive-stage-run.ts`: existing enqueue identity, run observation and approval wait. Enqueue is not execution; calendar rollover must not release an authority hold.
- `apps/web/lib/queue/functions/agent-task-dispatch.ts`: existing periodic dispatcher must reconcile held standalone tasks too. Merely setting nextRunAt=null would strand them.
- `apps/web/lib/govern/authority/coworker-authority-decision.ts` / `resolve-coworker-tool-authority.ts`: canonical exact-call subject, route, decision versions, capabilities, grants, delegation, sensitivity and policy inputs. An approval-binding fingerprint alone is insufficient: it includes run identity and does not represent every wake-relevant fact.
- [Workroom cycle continuity](../../architecture/workroom-cycle-continuity.md): restart, provenance, approval, current lease and uncertain-effect obligations. Timed provider holds and ordinary writeback retries retain their current purposes.

## Atomic delivery boundary and traceability

One atomic repair maps to BI-412A2F72. Typed result propagation, durable settlement, both wake paths and current-authority validation must land together: propagation alone still retries; settlement alone can strand work; wake without validation can execute under stale authority. Characterization, implementation and verification below are internal sequencing, not independently delivered capabilities.

| Key | Requirement references | Contract references | Flow references | Verification references |
| --- | --- | --- | --- | --- |
| scheduled-authority-hold | OBJ-REVIEW-CLOSE; AC-REVIEW-HOLD; acceptance criteria 1–6 | GOVERNED_REJECTION_DISPOSITION; withCurrentScheduledTask; TaskRun.progressPayload | scheduled-loop-to-settlement; held-task-to-current-authority-revalidation | V-HOLD; controlled-lineage; restart-and-wake-matrix; served-runtime-cohort |

## Phase 1 — characterize and freeze exact bindings

**Deliverable:** a current controlled reproduction plus exact existing carrier/read/write contracts, before implementation.

1. Resolve remaining exact edit claims before changing those files. Initial scheduler, loop and this plan are claimed; graph/test/helper/docs paths need their own claims. Respect active owners; no force or alternate-file workaround.
2. Use the existing scheduled test harness and governed private-SQL verification environment for a harmless owned fixture with actual TaskRun/tool lineage. Keep original admission and refusal. Compare two scheduled opportunities, not a replayed historical tool call. Record source/image identity and all authority/stage/subject/evidence/routing inputs. A mocked unit test is characterization only; it does not become live governed lineage.
3. Demonstrate the retry seam, then write the failing behavior assertions. No real business effects, new credentials/grants, extra human approval request, or revival of paused/cancelled/terminal work.
4. Resolve the wake comparison from complete canonical server-owned decision inputs. Record exact source/version references, normalized operation and arguments, owner/agent, stage/run assignment, subject, current effective grants/capabilities, delegation status/scope/expiry, explicit operator policy, decision/evidence versions and routing facts. Store references/digests instead of secrets.
5. Distinguish operation identity from changing TaskRun IDs and timestamps. An unrelated room update, a new calendar cycle or broad updatedAt is not a relevant change. A changed source is relevant only through a recorded contract/policy/evidence dependency. Unknown, truncated or failed reads retain the hold.
6. Reuse canonical resolver and input fingerprint helpers where appropriate; do not duplicate their policy. If complete inputs cannot be obtained without a separately owned contract change, stop this implementation and reconcile that dependency explicitly.

**Open prerequisites:** current controlled lineage has not been produced; the complete canonical wake-input projection is not yet selected. Historical lineage and source inspection do not close these prerequisites.

## Phase 2 — carry and persist the existing outcome

**Deliverable:** one bounded authoritative hold on the existing run, with fenced schedule/room projections.

1. Preserve the canonical disposition, rejection reason, exact blocked operation and existing approval/input bindings in loop completion. Use the original governed result. Do not infer all policy-or-capability failures are settled refusals or all parked results are human waits.
2. Suppress required-writer correction and forced fallback only when the run is genuinely held on that required action. A successful read or blocker report must not hide an outstanding required action.
3. Settle the TaskRun using existing states and typed progress payload. Preserve pending-person and pending-input recovery contracts and the original envelope. Keep infrastructure-inconclusive retry/backoff separate.
4. Write hold evidence and ScheduledAgentTask/ScheduledJob projections within the existing current-commission transaction. Do not swallow a failed authoritative write and still park cadence. Do not overwrite another run's hold or a newly narrowed commission.
5. Extend existing Workroom run observation/latch to read the authoritative hold, retaining it across restart and calendar rollover. Do not rewrite completed historical runs as working.

## Phase 3 — reconcile relevant changes through existing dispatch

**Deliverable:** the same work becomes eligible once after a relevant recorded change, subject to fresh admission.

1. Reconcile held Workroom work through the existing drive path, and standalone scheduled work through the existing dispatcher. Bound reads and processing; inspect overflow/unavailability explicitly.
2. Compare the recorded complete wake inputs with current canonical facts. Unchanged or unknown stays held without inference, governed writes or repeated person requests.
3. A relevant change wins one current-commission fenced continuation. Concurrent ticks cannot enqueue duplicate attempts. Re-check paused/inactive/cancelled/terminal state, assignment, stage, subject and current source.
4. Fresh admission evaluates current grants, capability, delegation and expiry, explicit always-approve policy and all other normal checks. Revocation or expiry can invalidate the old context but cannot grant execution. A new refusal records its current binding once.
5. Reconcile uncertain effects before retry. A local transaction rollback proves nonexecution only for effects fully within that transaction; external effects need destination reconciliation or verified idempotency. Never replay an unknown action merely because the hold changed.

## Verification and required impact work

Before Red, the graph returned eight scheduler tests and 24 loop tests. Preserve that returned inventory in native work evidence and run the affected graph-linked tests, plus colocated tests for every added helper. Missing/stale graph advice expands verification.

Minimum targeted matrix:

- Refused required writer produces a durable hold, no forced correction or generic cron retry, and no duplicate envelope.
- Identical consecutive ticks and process restart retain the hold; unrelated revision and calendar rollover do not wake.
- One relevant authority/evidence/routing change produces one fenced continuation across concurrent ticks.
- Revoked/expired delegation, changed stage/subject/source, paused/cancelled/terminal work, missing/truncated reads and changed commission cannot inherit old authority.
- Awaiting-person retains its exact envelope and recorded outcome; awaiting-input retains its named remedy; inconclusive transport/provider failures retain timed recovery.
- Successful reads, required-writer enforcement, proposal precedence, persisted tool executions and provider-busy handling remain correct.
- External success followed by local receipt failure remains uncertain until reconciled.

Existing suites include agent-task-scheduler-governed-terminal.test.ts, agent-task-scheduler-required-writer.test.ts, agent-task-claim.test.ts, scheduled-task-runs.test.ts, agentic-loop-authority-refusals.test.ts, agentic-loop-canonical-design-refusal.test.ts, writeback-latch-run.test.ts, workroom-drive-cross-cycle.test.ts and agent-task-dispatch.test.ts. Resolve additional graph tests after the final scope is known.

The impact contract requires style-drift-guard and module-size limits: scheduler 820 lines and loop 2,581 lines may shrink, never grow under the guard's own count. Refactor shared settlement/classification out of those oversized modules rather than append another local branch. This is reliability/refactoring work; funding allocation is unresolved and is not inferred from DEV authority.

Update or substantively disposition docs/architecture/agent-standards-dpf-conformance.md, docs/design/golden-triangle-design.md and docs/user-guide/workroom-approval-recovery.md. Also reconcile workroom-cycle-continuity.md for any changed latch semantics. Regenerate the doc index for this new plan.

Run affected unit tests, package typechecks and preflight; obtain exact-tree governed integration including actual private-SQL cases, independent semantic review, protected PR checks and merge queue. Unrun/infrastructure-inconclusive checks remain labelled as such.

After canonical release and governed self-upgrade, verify served identity contains the merge, then execute current harmless positive and negative cases. Compare the same declared cohort/windows before and after: dispatches, repeated authority writes, person requests, successful outcomes and unknown coverage separately. Suppression alone is not useful work delivered and correlation is not causation. Keep acceptance open when samples or an observation window are missing.

## Risks and rollback

The principal risks are stranded tasks, duplicate wakeups, partial-context false wakes and merging distinct waits. Mitigations are both existing reconciliation paths, one canonical current-commission fence, complete server-owned input references, conservative unknown handling and the explicit matrix above.

Rollback reverts the code through protected delivery and retains historical TaskRun/tool/hold evidence. Reconcile held work using the supported current-owner recovery path; do not blanket-reactivate schedules or delete evidence. A rollback is not authorization to replay unknown effects.

## Backlog coverage

Parent requirement: BI-E9555B2D / existing weekly-review design; atomic child: BI-412A2F72.
Decision: atomic, for the coupled settlement-and-wake rationale above.
Mappings: scheduled-authority-hold → BI-412A2F72; internal phases depend on the preceding phase.
Receipt: pending provider-verified immutable plan publication and canonical coverage recording. This placeholder is not a receipt and grants no implementation readiness.
