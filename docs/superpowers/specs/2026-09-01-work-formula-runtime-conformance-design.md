---
status: draft
---

# Runtime Conformance for the Universal Work Formula

**Date:** 2026-09-01 · **Scope:** platform · **Decision scope:** WWMD

## 1. Problem

Work coordination fails silently. Over one week of platform work, six defects shared one shape:

> **Either the health signal and the thing it describes are different substrates, or "could not measure" and "measured zero" are encoded as the same value.**

Observed instances, all verified on the live install:

| Incident | Signal | Reality | Undetected for |
|---|---|---|---|
| Code-graph reconcile | `ScheduledJob.lastStatus = ok`, every 15 min | `mode: "noop"`, indexing nothing | 4 days |
| Code-graph health | `indexedFileCount = 4406` (from `CodeGraphFileHash`) | `graph_node = 0`, `graph_edge = 0` | 4 days |
| `search_code_graph` | `{ results: [] }` | graph was empty, not the model absent | until asked |
| Kernel attenuation | tests green | predicate keyed on an archetype **0 of 96** pages carry | since BI-5BB1A364 |
| `describe_committed_model` | `trust: high 0.99` | answered from an unidentifiable tree, wrongly | first live call |
| Backlog | 4 items `open` | work merged, deployed, verified | this session |

None was reported by a user. Two — the governance-lane ones — *could not* be: users do not close backlog items or mint gate receipts. They surfaced only because an agent executed a full lifecycle end to end.

**This generalises past development.** The same shape applies to any work anchored on an entity lifecycle: a hiring requisition whose candidate is onboarded but whose room stays open; books "closed" on an unbalanced period; a tax period that elapsed with no filing room ever opened; a hotel folio settled while the stay room reports active; an MSP service window that passed without engagement. Development is not the hard case — it is the only case with **externally reconcilable truth** (`git status`, a merged PR, a sha). Everything else has none unless the anchor entity is modelled.

## 2. Substrate that already exists — do not rebuild

Verified before drafting, per `dpf-verify-substrate-first`:

| Concern | Where it already lives |
|---|---|
| Invariant lifecycle `frame → propose → collaborate → review → govern → verify → carry-over` | `kernel/principles/universal-work-formula`, `dpf-bring-work-under-formula` |
| Canonical work unit + carrier adapters | `work-management/work-unit.ts` — `WORK_UNIT_CARRIER_REGISTRY` already registers `work-capsule`, `work-item`, `task-run` |
| Company-facing status | `work-management/status-projection.ts` (single projection authority) |
| Domain variation, temporal shape | `work-management/source-registry.ts` — `domainCategory`, `roomProjection.mode` ∈ `finite \| standing` |
| Recurring/periodic rooms | `BOOKKEEPING_ROOM_PROJECTION` (standing), `room-cycle-*.ts`, `work-shapes.ts#projectWorkShapeCycleBoundary` |
| Carry-over | `WorkroomOutcomePacket`, `WORKROOM_CYCLE_EVIDENCE_KIND` |
| Standing-room dispatch | `drive-resolution.ts` → plan executed by an Inngest job |
| Runtime finding store | `EaConformanceIssue` (`issueType`, `severity`, `status`, `detailsJson`) + `conformance-issue-reconciler.ts` |
| Formula conformance | `scripts/check-work-unit-conformance.mjs` |

**The lifecycle, the temporal shapes, the cycle boundaries and the carry-over packet all exist.** This spec adds no lifecycle and no second projector.

## 3. The actual gap

Four things, each evidenced:

**G1 — The anchor is not joinable outside development.** `Workroom` carries typed FK anchors `backlogItemId`, `epicId`, `workItemId`, `featureBuildId`, `taskRunId` — every one a development carrier. Non-development anchors live in `outcomeAnchor Json`, whose declared kinds include `customer-account`, `service-request`, `coworker`, `work-case`, `external`. A JSON blob cannot be joined, so *"anchor reached its terminal state but the room is still open"* is computable for a backlog item and **not computable for a guest, a requisition, or a financial period**.

**G2 — Liveness is derived from development signals.** `list_workrooms` derives liveness from *lease expiry, the linked build's phase, an open PR, and last sync*. Three of four are delivery-shaped. A standing bookkeeping room or a guest-stay room has exactly one signal — lease expiry — which is a timer, not a truth. It reports that a lease lapsed, never that work stalled or completed.

**G3 — Conformance is source-time only.** `check-work-unit-conformance.mjs` validates *changed runtime modules*. All 200 `scripts/check-*` guards read source. Every incident in §1 was runtime state. No guard that reads code can see a graph that emptied, a job that reported `ok` while doing nothing, or a period that elapsed unserved.

**G4 — There is no terminal predicate per anchor kind.** Nothing declares what "done" *means* for a given anchor, so completion is an assertion by the executor rather than an observation of the anchor. `status-projection.ts` projects the carrier's state; it cannot check the carrier against the world.

## 4. Design

### 4.1 Promote the anchor to a joinable contract

Add `WorkroomAnchor` — one row per (workroom, anchor), replacing reliance on `outcomeAnchor Json` for anything that must be reconciled. Fields: `workroomId`, `anchorKind` (Prisma enum, per §8 of the rulebook — a closed set is an enum, never a free string), `anchorId`, `anchorSourceKey`, `terminalObservedAt`, `lastObservedState`, `lastObservedAt`.

`outcomeAnchor` remains for display and for genuinely external anchors, but a room whose kind declares a terminal predicate MUST carry a `WorkroomAnchor` row. The existing typed FK columns stay and are backfilled into it, so development loses nothing.

### 4.2 Declare a lifecycle contract per anchor kind

Extend `source-registry.ts` — the file the formula already designates for per-domain variation — with three additions per entry. **No new registry.**

- `terminalPredicate` — a pure, server-evaluable function `(anchor) → terminal | active | indeterminate`. Note the third value: it is the whole point (§5).
- `teardownContract` — the named obligations discharged on completion. Development: reap the worktree, release the lease, close the branch claim. Outside development this carries compliance weight — candidate-record retention, guest PII, period locking — so an unexecuted teardown is a finding, not untidiness.
- `recurrence` — for `standing` rooms, the rule that mints the next instance, expressed against the **period as the anchor entity**.

### 4.3 The period is the entity

For recurring work the anchor is not the process, it is the period: `FY2026-Q3` for the books, `week-of-2026-09-07` for the menu cycle, the contract's engagement window for an MSP. Modelling the period as a first-class anchor makes recurrence ordinary instance management and yields D7 (§4.4) for free.

### 4.4 A runtime conformance sweep

One scheduled steward, riding `EaConformanceIssue` and the existing reconciler — **not a new alerting path**. Each detector is grounded in an incident from §1.

| ID | Detector | Would have caught | Latency |
|---|---|---|---|
| D1 | Job reports `ok` with no state delta on its anchor | code-graph reconcile | 2 runs (~30 min) vs 4 days |
| D2 | Health metric sourced from a different substrate than it describes | `indexedFileCount` vs `graph_node` | immediate |
| D3 | Empty result carries no coverage marker | `search_code_graph → []` | immediate |
| D4 | Predicate keyed on a value the corpus never contains | attenuation lever, 0/96 | seed time |
| D5 | Gate remediation names a tool the caller's population cannot hold | `initiative_evidence_write` | before a caller hits it |
| D6a | Anchor terminal, workroom open | 4 BIs this session | daily |
| D6b | Workroom complete, anchor **not** terminal | books closed on an unbalanced period | daily |
| D7 | Period elapsed, no workroom instantiated | a missed filing | per period |
| D8 | Workroom completed, teardown contract unexecuted | orphaned worktree left in `/sandbox-workspace` | daily |

D6b is the dangerous inversion and has no analogue in today's tooling.

## 5. Research & Benchmarking

**Kubernetes controller reconciliation — ADOPT.** Controllers are *level-triggered*: they compare observed state to desired state on every pass rather than trusting an event. That is exactly the failure in §1 — an edge-triggered `ok` was recorded and never re-checked against reality. More importantly, `status.conditions` carries `True | False | **Unknown**`, where `Unknown` explicitly means *the controller could not determine this*. That is the missing third value which collapses "could not measure" into "measured zero" throughout our stack. Adopt both: level-triggered sweeps, and a mandatory third state on every terminal predicate and coverage marker.

**Temporal — ADOPT NARROWLY, REJECT WHOLESALE.** Its durable timers and "workflow never started" alarms are precisely D7. But adopting Temporal as an execution substrate would replace Inngest and the formula's own dispatch, which §2 shows already works. Take the *concept* (a period with no instance is an alarmable condition), not the runtime.

**BPMN / Camunda boundary and compensation events — ADOPT THE COMPENSATION IDEA, REJECT THE NOTATION.** BPMN models teardown as compensation attached to a completed activity, which is a better fit for `teardownContract` than treating cleanup as a final step that can simply be skipped. Reject the notation and engine: DPF already expresses process as `supportedTransitions` in the source registry, and a second process language would violate single-source-of-truth.

**Rejected:** Great Expectations / dbt tests — data-quality assertion frameworks over datasets, not entity-lifecycle reconciliation, and they would add a parallel findings store beside `EaConformanceIssue`.

## 6. Migration

1. Add `WorkroomAnchor` + `AnchorKind` enum; backfill from the typed FK columns and from `outcomeAnchor` where the kind is recognised. Forward-only, backfill inline.
2. Extend `source-registry.ts` entries with the three contract fields; existing entries default to `terminalPredicate: indeterminate` so nothing silently claims a truth it cannot check.
3. Land the sweep with D1, D2, D6a first — substrate-agnostic and highest return.
4. D6b, D7, D8 follow once terminal predicates and teardown contracts exist for at least two non-development kinds.

## 7. Acceptance

- A room whose anchor kind declares a terminal predicate cannot be marked complete while the predicate reports `active` — and reports `indeterminate` rather than passing when it cannot evaluate.
- A scheduled job that records `ok` with no anchor state delta for N consecutive runs raises an `EaConformanceIssue`.
- A period that elapses with no workroom instantiated raises one.
- A completed room with an unexecuted teardown obligation raises one.
- `check-work-unit-conformance.mjs` gains a runtime counterpart; the static guard is unchanged.
- No second status projector, no second findings store, no second process language.

## 8. Open questions for the operator

- **Non-development closure authority.** An external CLI session completed nine merged PRs this week and could not close its own backlog items: the delivery evidence lane accepted its evidence, while `RESEARCH_REQUIRED` and `OBJECTIVE_BASELINE_REQUIRED` need `record_initiative_evidence` / `record_initiative_design_review`, which do not surface for that population, plus a spec-approval receipt routed to an *independent* reviewer. Either agent populations get a reviewer route, or CLI-executed closure is explicitly an operator step. Today it is neither, so finished work misreports as open — §1's failure shape, one level up.
- Which two non-development anchor kinds go first? Recommend one `finite` (hiring requisition) and one `standing` (financial period), so both temporal shapes are exercised before the pattern is generalised.
