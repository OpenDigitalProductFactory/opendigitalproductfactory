---
status: active
---

# Flow-efficiency adversarial fixtures

- **Backlog item:** `BI-7C1F43E3`
- **Workroom:** `WC-AA6941F2`
- **Parent designs:**
  - `docs/superpowers/specs/2026-08-30-bounded-delivery-control-plane-design.md`
  - `docs/superpowers/specs/2026-09-03-local-first-agentic-delivery-throughput-design.md`
- **Source delta:** `docs/superpowers/specs/2026-09-04-t3-code-source-delta-review.md`
- **Delivery decision:** one atomic Phase 1 slice; no new queue, ledger, or lifecycle authority

## Problem

The bounded-delivery pilot is live, but its happy-path evidence does not prove that
Workroom projection and resume behavior stay truthful when Git, provider, session,
event, or payload state disagree. Those contradictions are the conditions most likely
to multiply waste once paired-install scheduling and campaign fan-out begin.

This slice adds executable adversarial fixtures at the existing reconciliation seams.
It may make the smallest production correction needed to make a fixture pass, but it
does not implement the downstream delivery rail, paired scheduler, async hub, session
rollup, campaign controller, scorecard, or execution-profile BIs.

## Research and alternatives

The design compares three primary implementations rather than inventing a fourth
control plane:

| Source | Useful mechanism | DPF adoption | Rejected transfer |
|---|---|---|---|
| [T3 Code at `4e547318b6`](https://github.com/pingdotgg/t3code/tree/4e547318b60031eb546d8cf2b84ad9fa0785a87a) and the pinned source review | Durable orchestration events, separate provider-session state, worktree-aware turns, and failure reports for stale worktree/session projections | Turn its observed contradictions into deterministic fixtures against DPF's existing Workroom, TaskRun, event, and worktree seams | A T3-shaped global thread ledger, shared writable worktrees, or merge-only completion |
| [Temporal workflow replay](https://docs.temporal.io/workflows) | Ordered event history reconstructs state; external effects are not repeated during replay | Require monotonic event application and bounded snapshot recovery when a cursor gap prevents safe replay | A new workflow engine or replaying Git/provider side effects from process memory |
| [GitHub Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) | A stable concurrency group bounds simultaneous work and makes replacement/cancellation explicit | Preserve one immutable gate identity and explicit lane admission | GitHub's pending-run replacement behavior as a fairness or evidence policy; approvals and terminal evidence are never coalesced |

The project-specific choice is existing-substrate reconciliation. Workroom remains the
canonical delivery identity; Git and provider state are observations. Binding changes
remain fenced, version-checked sagas, and uncertainty fails closed with one recovery
action. This follows the parent design and avoids a new source of truth.

## Canonical objectives

**OBJ-FEAF-BINDING:** Reconcile partial worktree creation, partial deletion, and worktree loss during an active turn without granting two writers, following an unverified path, or reporting healthy work from stale projection data.

**OBJ-FEAF-LIVENESS:** Derive liveness from independent durable facts so a terminal turn with a stale active provider session cannot wedge, falsely reap, or falsely complete its Workroom.

**OBJ-FEAF-EVENTS:** Preserve fair, bounded progress under provider-child event floods and recover a replay cursor gap through one bounded snapshot without coalescing consequential events.

**OBJ-FEAF-RESUME:** Enforce a resume-payload ceiling and downgrade to metadata-only or bounded handoff state instead of retaining or returning an oversized history.

**OBJ-FEAF-BASELINE:** Produce a reproducible Phase 1 measurement baseline for `BI-69803ACC` covering truthful recovery, event fairness, payload bounds, and duplicate execution, without claiming that the seven-day throughput window has completed.

## Canonical acceptance links

| Acceptance | Objective | Statement |
|---|---|---|
| AC-FEAF-001 | OBJ-FEAF-BINDING | A failed create followed by cleanup records the partial resource and reaches one retryable or terminal state; cleanup is idempotent and never operates on an unverified path. |
| AC-FEAF-002 | OBJ-FEAF-BINDING | Partial deletion and worktree loss during a turn fence the old writer before any replacement binding becomes active; preserved Git evidence and orphan cleanup remain visible. |
| AC-FEAF-003 | OBJ-FEAF-LIVENESS | A terminal turn outranks a stale active-session flag, while a durable queued wait prevents false reaping; contradictory facts yield an explicit recovery state. |
| AC-FEAF-004 | OBJ-FEAF-EVENTS | A flood from one provider child cannot starve another Workroom or child; approvals, failures, ownership, lifecycle, and terminal evidence remain ordered and uncoalesced. |
| AC-FEAF-005 | OBJ-FEAF-EVENTS | A monotonic cursor gap performs at most one bounded snapshot recovery, advances only to a verified cursor, and fails closed when the snapshot cannot establish continuity. |
| AC-FEAF-006 | OBJ-FEAF-RESUME | A resume packet over the configured byte/item ceiling returns metadata-only continuation or a bounded handoff reason and never silently truncates authoritative evidence. |
| AC-FEAF-007 | OBJ-FEAF-BASELINE | Focused tests emit deterministic counters/timings for the six adversarial scenarios and record the exact fixture/test identities that `BI-69803ACC` can consume as its pre-change baseline. |
| AC-FEAF-008 | OBJ-FEAF-BINDING, OBJ-FEAF-LIVENESS, OBJ-FEAF-EVENTS, OBJ-FEAF-RESUME | Existing ordinary-path tests stay green; unknown or contradictory state expands to exhaustive verification and protected CI remains mandatory. |

## Architecture and invariants

1. **Pure seams first.** Model each adversarial sequence as data against existing
   reconciliation/projector functions. Do not require real process destruction or
   arbitrary filesystem deletion in unit tests.
2. **Independent observations.** Worktree existence, Git branch/ref, provider process,
   TaskRun/turn, durable wait, and Workroom lease are sampled independently. No single
   stale boolean establishes liveness.
3. **Fenced binding saga.** Intent is recorded before external mutation; the old writer
   is fenced; external state is verified; only then is the new binding finalized.
   Failure records compensation/orphan state and supports idempotent retry.
4. **Monotonic delivery.** Event cursors never move backward. Replaceable progress may
   coalesce within a bounded Workroom/provider partition; consequential events may not.
5. **Bounded continuation.** Payload budgeting is computed before serialization.
   Oversize returns an explicit downgrade; it does not drop receipts or terminal facts.
6. **No false completion.** These fixtures establish recovery behavior and a scorecard
   baseline. They do not complete the still-running seven-day pilot acceptance window.

## Failure and rollback

- A fixture that exposes a defect is RED evidence, not permission to weaken its
  assertion. The smallest owning projector/reconciler is corrected under TDD.
- If an existing seam cannot express the scenario, add a narrow pure helper beside the
  owner. Do not add persistence or a new domain entity from this BI.
- Rollback removes the minimal production correction and fixture together only if the
  parent behavior is demonstrably incompatible. Never roll back by deleting durable
  evidence or relaxing protected checks.

## Verification

Run each new fixture RED before the production change, then GREEN with its adjacent
suite. Run all affected tests, typecheck, the exact-tree local gate when available,
semantic review, DCO, protected PR checks, canonical release, and exact served-SHA live
verification. Record any unavailable local lane as `INCONCLUSIVE`, never `PASS`.

