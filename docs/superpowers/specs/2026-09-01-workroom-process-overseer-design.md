# Workroom Process Overseer — Design

**Backlog item:** `BI-3913EB49`  
**Epic:** `EP-1FABA22D`  
**Status:** implementation baseline  
**Extends:** `2026-08-29-proactive-workrooms-design.md` §3.2 and `2026-08-30-paaw-competence-evolution-workroom-plan.md` §7A

## 1. Outcome

Every projected Workroom names the coordinator who oversees its process and reports whether the
room conforms to its declared collaboration and activity shapes. A room with an executable
`WorkShapeDefinition` may advance autonomously only when exactly one current coordinator was
persisted explicitly and the deterministic conformance result permits the transition.

The Process Overseer owns sequence and conformance. The accountable owner still owns the outcome;
executors do the work; independent reviewers/evaluators judge it; approvers authorize consequential
advances. The coordinator is an existing participant role, not a new agent type or table.

## 2. Research and design choices

The research recorded in PR #4881 supports a flexible inner work loop inside a fixed outer control
loop. DPF adopts bounded budgets, immutable evidence, held-out or independent evaluation, explicit
role separation, and fail-closed escalation. It rejects coordinator self-certification, prompt-only
oversight, hidden retries, silent authority widening, and candidate-selected evidence.

The design extends three canonical substrates already on `main`:

- `WorkShapeDefinition` owns triggers, ordered stages, grants, measures, budgets, review points,
  and stop conditions (`BI-EFFD97B4`, PR #4909).
- `WorkroomParticipant` owns persisted roster and explicit coordinator assignment
  (`BI-4CB2EF76`, PR #4913).
- Workroom scope claims bind collaboration shape and `workShapeKey@version`; room cycles,
  activities, receipts, and outcome packets carry observed execution.

No `ProcessOverseer`, `WorkroomConformance`, or shadow roster table is added. Conformance is a pure,
recomputable read projection; attributable activities and receipts remain the durable audit trail.

## 3. Contract

`WorkroomShapeConformance` contains:

- exact collaboration-shape key and work-shape `key@version` checked;
- Process Overseer identity and assignment source;
- current and expected-next stage;
- a closed set of typed deviations;
- `continue | pause | escalate | stop | complete | not-applicable` disposition;
- next permitted transition, intervention reason, check instant, and stable reconciliation key.

Deviation kinds cover:

- absent, multiple, or legacy-derived coordinator;
- missing required collaboration role;
- coordinator/reviewer or coordinator/approver independence conflict;
- unresolved or version-mismatched shape;
- missing or out-of-order current stage;
- missing prerequisite evidence or required receipt;
- authority outside the shape grant ceiling;
- exhausted budget, due review point, or met stop condition;
- unresolved deviation omitted from a closing outcome packet;
- absent/stale JSI or TAK eligibility for an AI coordinator.

The pure projection is deterministic for the same declared/observed input. Deviations are sorted
and deduplicated; its reconciliation key is derived from room, shape version, stage, and deviation
codes so repeated finite events or standing sweeps produce one logical disposition.

## 4. Enforcement

The lifecycle guard consumes a conformance result before convene/open-cycle, stage dispatch,
stage completion, review, and close. `continue` and an explicitly satisfied `complete` are the only
autonomous dispositions. `pause`, `escalate`, and `stop` refuse the transition with the exact
intervention reason. A shaped room with no conformance result also refuses; an unshaped legacy room
remains compatible and visibly reports `not-applicable` until a work shape is declared.

The guard never repairs a mismatch. It does not invent participants, select a coordinator, skip a
stage, add a grant, synthesize evidence, or convert a derived coordinator into an explicit one.

Standing-room reconciliation is bounded and idempotent: callers supply only the room being
reconciled and persist at most one activity/attention receipt per reconciliation key. Estate-wide
selection and scheduling remain outside this module.

## 5. Read model and UX

`WorkroomView` carries the conformance projection. The existing Workroom detail surface adds a
compact Process Overseer section showing:

- coordinator name and whether assignment is explicit or derived;
- conformance disposition and last check;
- declared/current/next stage;
- unresolved deviations and intervention reason.

The section uses report-kit status/notice primitives and theme tokens. It does not add a route,
dashboard, tab, or configurable form. Membership remains distinct from presence, and a derived
coordinator is labelled compatibility-only rather than execution-qualified.

## 6. Scale, security, and rollback

Conformance is O(participants + stages + receipts + budgets) for one room. It performs no database
query and no estate scan. The loader already fetches a bounded roster, messages, activities, and one
anchored room; it passes those observed values into the projection.

Security is tighten-only. A room definition is a ceiling, never a source of authority. AI
coordinator eligibility is supplied by canonical JSI/TAK resolution; unknown eligibility fails
closed for executable shaped rooms.

Rollback disables lifecycle consumption of the result while retaining the read projection,
activities, and deviations. Rooms whose explicit coordinator or shape cannot be proved remain
paused; recorded failures are never reinterpreted as passes.

## 7. Acceptance

- Every `WorkroomView` exposes a Process Overseer/conformance projection.
- Executable shaped rooms require exactly one explicit coordinator.
- Required roles, stage order, evidence, receipts, grants, budgets, review points, stop conditions,
  role independence, and AI eligibility are deterministic deviations.
- Lifecycle guards refuse nonconformant shaped rooms and preserve legacy unshaped compatibility.
- Repeated checks yield one stable reconciliation key.
- The Workroom surface distinguishes explicit from derived coordination and explains intervention.
- Targeted pure, read-model, lifecycle, and component tests pass; typecheck, build, UX route sweep,
  and merged-code CI pass before merge.

