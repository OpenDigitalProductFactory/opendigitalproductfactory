---
status: active
---

# Flow-efficiency adversarial fixtures implementation plan

- **Backlog item:** `BI-7C1F43E3`
- **Workroom:** `WC-AA6941F2`
- **Design:** `docs/superpowers/specs/2026-09-04-flow-efficiency-adversarial-fixtures-design.md`
- **Delivery decision:** atomic
- **Downstream measurement consumer:** `BI-69803ACC`

## Design grounding

- Existing specs/plans reviewed: this plan and
  `docs/superpowers/specs/2026-09-04-flow-efficiency-adversarial-fixtures-design.md`.
- Current code substrate reviewed: `apps/web/lib/work-capsules/liveness.ts`,
  `apps/web/lib/work-capsules/activity-stream.ts`, and
  `apps/web/lib/tak/thread-checkpoint.ts`.
- Source of truth: durable Workroom, TaskRun, Git, event-cursor, and evidence facts;
  provider/session flags remain observations rather than authority.
- Decision: extend the existing pure reconciliation seams with bounded fixtures and
  the minimum corrections they prove, without adding a queue, ledger, or lifecycle.

## Scope and atomicity

Ship one test-led Phase 1 safety slice covering partial worktree create/delete,
worktree loss during a turn, a terminal turn with stale session state, provider-child
event flooding, oversized resume payloads, and cursor-gap snapshot recovery. These
fixtures share one purpose: prove the existing Workroom control plane is truthful
enough to admit parallel downstream work. Shipping only a subset would make that
readiness claim misleading, so the fixtures and any minimal owning fixes form one
atomic delivery.

The seven-day pilot observation remains separate acceptance evidence. This plan does
not shorten that window or infer its result.

## Backlog coverage

- Decision: atomic
- Parent: BI-7C1F43E3
- Receipt: cmtn9q8mp01g801p5w675j2zq
- Rationale: All six adversarial fixtures jointly establish one truthful
  concurrency-readiness baseline; partial delivery would make that claim
  misleading and cannot be shipped independently.
- Dependencies: none

| Deliverable | Objective / acceptance refs | Live BI | Dependency | Independently shippable |
|---|---|---|---|---|
| Phase 1 adversarial control-plane fixture pack and minimal owning corrections | OBJ-FEAF-BINDING; OBJ-FEAF-LIVENESS; OBJ-FEAF-EVENTS; OBJ-FEAF-RESUME; OBJ-FEAF-BASELINE; AC-FEAF-001..008 | BI-7C1F43E3 | merged pilot PR #5029 and classification repair PR #5035 | No — partial coverage cannot establish concurrency readiness |

The atomic deliverable has four-way traceability:

- Requirements: OBJ-FEAF-BINDING; OBJ-FEAF-LIVENESS; OBJ-FEAF-EVENTS;
  OBJ-FEAF-RESUME; OBJ-FEAF-BASELINE.
- Contracts: CT-FEAF-BINDING-OWNERSHIP; CT-FEAF-LIVENESS-PRECEDENCE;
  CT-FEAF-EVENT-FAIRNESS; CT-FEAF-CURSOR-CONTINUITY;
  CT-FEAF-RESUME-BOUND; CT-FEAF-BASELINE-TRUTH.
- Flows: FLOW-FEAF-PHASE-1; FLOW-FEAF-PHASE-2; FLOW-FEAF-PHASE-3;
  FLOW-FEAF-PHASE-4; FLOW-FEAF-PHASE-5.
- Verification: AC-FEAF-001; AC-FEAF-002; AC-FEAF-003; AC-FEAF-004;
  AC-FEAF-005; AC-FEAF-006; AC-FEAF-007; AC-FEAF-008.

Downstream `BI-69803ACC` consumes the deterministic baseline but does not own or block
this implementation. The later BIs remain dependency-ordered exactly as the local-first
design specifies; this branch does not absorb their product work.

## Phase 0 — Governed artifact baseline

1. Commit this design and plan with DCO on the campaign branch and push the immutable
   artifact revision.
2. Re-sync `WC-AA6941F2`, obtain fresh server-issued reviewer packets, and complete the
   research, design-spec, spec-approval, architecture, plan-review, and live plan
   coverage lanes. Do not reuse the rejected pilot review.
3. Re-read implementation readiness. Begin code only after the server records the
   required receipts or a separately authorized, time-bounded bootstrap exception.

Verification: immutable provider blob resolution, independent author/reviewer identity,
scope baseline, plan-coverage receipt, and a fresh readiness decision.

## Phase 1 — Locate seams and write RED fixtures

1. Map each acceptance statement to the smallest existing owner among worktree janitor,
   Workroom liveness/reconciliation, TaskRun/provider event ingestion, replay/cursor,
   and resume-payload modules.
2. Claim the exact source/test paths before editing.
3. Add deterministic fixtures using injected observations, cursors, clocks, and byte
   budgets. Avoid wall-clock sleeps and destructive real-worktree operations.
4. Run each focused test and retain its expected failure output as RED evidence.

Verification: six named scenarios fail for the intended missing invariant rather than
fixture setup, import, or environment errors.

## Phase 2 — Minimal binding and liveness corrections

Implement only the production changes required by AC-FEAF-001..003:

- represent partial binding/cleanup outcome with existing activity/workspace shapes;
- fence the old writer before finalizing a replacement;
- verify paths before cleanup and make compensation idempotent;
- reconcile terminal turn, provider session, durable wait, lease, and Git/worktree facts
  independently, with terminal and durable-wait precedence made explicit.

Verification: focused RED fixtures become GREEN; all adjacent janitor, watchdog, and
liveness tests remain green.

## Phase 3 — Bounded event, replay, and resume corrections

Implement only the production changes required by AC-FEAF-004..006:

- partition replaceable provider-child progress by Workroom/provider and enforce a
  bounded fair drain;
- keep consequential events ordered and uncoalesced;
- detect monotonic cursor gaps, perform one bounded snapshot recovery, and refuse an
  unverifiable continuation;
- budget resume packets before serialization and return explicit metadata-only or
  bounded-handoff state when the ceiling is exceeded.

Verification: flood fairness is deterministic, gap recovery is single-shot and
monotonic, oversize behavior preserves evidence metadata, and ordinary-path suites pass.

## Phase 4 — Baseline and refactoring lane

1. Expose deterministic test metrics/counters for recovery outcome, fairness, replay
   mode, payload downgrade, and duplicate execution.
2. Record the exact test/fixture identities and results as the Phase 1 input baseline
   for `BI-69803ACC`; do not manufacture historical runtime measurements.
3. Spend approximately 20% of implementation effort on evidence-led cleanup inside the
   touched modules: consolidate duplicated fixture builders or state precedence only
   when doing so keeps behavior obvious and tests green.

Verification: AC-FEAF-007/008 traceability table is complete and focused plus affected
tests pass after refactoring.

## Phase 5 — Protected delivery and live verification

1. Run proportional local checks, typecheck, exact-tree local CI where available,
   semantic review, and DCO verification. Preserve unavailable or capacity-deferred
   lanes as `INCONCLUSIVE` with compensating protected checks.
2. Open one PR for `BI-7C1F43E3`, resolve review findings, and merge only through the
   protected merge queue.
3. Publish and advance the canonical runtime when the change affects served code.
   Verify the exact served merge SHA and exercise the safest representative recovery
   path on the live install.
4. Record delivery/acceptance evidence and objective observations. Keep the Workroom in
   `verifying` while the separate seven-day pilot window is incomplete.

## Verification commands

The exact focused commands are selected after Phase 1 identifies the owning modules.
The minimum gate is:

- focused Vitest files for every touched owner;
- affected-test discovery and all returned tests;
- web typecheck for runtime TypeScript changes;
- `pnpm run pregate:preflight`;
- exact-tree `pnpm run pregate` when admitted;
- `pnpm pr:health` and protected GitHub checks before merge.

Unknown scope, stale evidence, or an unresolved guard expands verification; no command
is removed merely to fit local capacity.
