---
status: binding
---

# Workroom Process Overseer — Design

**Backlog item:** `BI-3913EB49`  
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
loop. The relevant designs are complementary rather than interchangeable workflow engines:

| Source design | Applicable mechanism | DPF decision |
|---|---|---|
| [WikiSkill](https://arxiv.org/html/2608.27454) | Immutable experience, curated knowledge, executable skills, and an external accept/reject/rollback loop; cross-model transfer can regress | Adopt immutable evidence, scoped knowledge, versioned methods, independent validation, negative-result retention, and profile-specific qualification. Reject direct corpus injection and coordinator self-certification. |
| [Automated Researchers Can Reliably Mitigate Alignment Failures](https://alignment.anthropic.com/2026/automated-alignment-researchers/) | Parallel researchers with persistent artifacts, fresh sessions, isolated held-out evaluation, a capability floor, and explicit monitoring for evaluation gaming | Adopt flexible collaboration within fixed attempt/budget accounting, retained artifacts, evaluator separation, and capability preservation. Reject interpreting many automated attempts as evidence that one coworker replaces a qualified assessor. |
| [Automated Weak-to-Strong Researcher](https://alignment.anthropic.com/2026/automated-w2s-researcher/) | A flexible inner research loop performed well, while seed selection, evaluator feedback, dataset shortcuts, and label leakage created reward-hacking paths | Adopt flexible stage execution inside a precommitted outer envelope. Keep seeds, labels, held-out answers, and evaluator authority outside both executor and coordinator control. |
| DPF PAAW, JSI, TAK, WWMD, WWWD, and WSID | Existing authority, job qualification, organizational and platform judgment, profession craft, evidence, and promotion substrate | Extend these owners through one conformance projection. Do not create a competing agent manager, competence ledger, decision kernel, or workflow database. |

DPF therefore adopts bounded budgets, immutable evidence, held-out or independent evaluation,
explicit role separation, monitorable interventions, and fail-closed escalation. It rejects
prompt-only oversight, hidden retries, silent authority widening, candidate-selected evidence, and
any coordinator path that can inspect held-out answers or approve its own consequential output.

The local `AGI by december.txt` transcript is a discovery and interpretation source, not a
normative reference. Its WikiSkill and Goodhart observations are consistent with the primary
sources above; its AGI-date, vendor-roadmap, and model-release claims are speculative and do not
create DPF requirements.

The detailed source findings and adoption/rejection rationale remain in
`docs/superpowers/specs/2026-08-30-paaw-competence-evolution-workroom-design.md` sections 5, 6, and
12, with the qualification mapping in `docs/architecture/job-specific-intelligence.md`. This
design narrows those findings to Workroom process conformance.

The design extends three canonical substrates already on `main`:

- `WorkShapeDefinition` owns triggers, ordered stages, grants, measures, budgets, review points,
  and stop conditions (`BI-EFFD97B4`, PR #4909).
- `WorkroomParticipant` owns persisted roster and explicit coordinator assignment
  (`BI-4CB2EF76`, PR #4913).
- Workroom scope claims bind collaboration shape and `workShape` `key@version`; room cycles,
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

### 3.1 Component boundaries

The implementation has four components with one-way dependencies:

1. **Observation adapter** converts already-loaded Workroom state into a bounded
   `WorkroomShapeObservation`. It may resolve a declared `WorkShapeDefinition` and canonical
   coordinator JSI/TAK eligibility, but it does not decide conformance.
2. **Pure conformance projector** accepts only the declared collaboration/work shapes and the
   observation. It returns `WorkroomShapeConformance`; it performs no I/O and mutates nothing.
3. **Lifecycle guard** accepts the operation plus the projection and returns an allow/refuse
   decision. It does not recompute a second rule set. Finite-cycle and standing-room callers use
   this same contract.
4. **Read-model/UI adapter** serializes the projection into `WorkroomView` and renders it. It has no
   write path and cannot affect the guard decision.

Dependencies point inward: store/runner and read-model adapters depend on the projector and guard;
the projector never depends on Prisma, React, a runner, or a client. Existing
`WorkShapeDefinition`, `WorkroomParticipant`, lifecycle receipt, and scope-claim owners remain
authoritative.

### 3.2 Input and output interfaces

`WorkroomShapeObservation` is a value object containing the Workroom identifier, checked instant,
persisted participants, current/proposed stage, observed receipt/evidence kinds, observed grants,
budget use, review/stop observations, close intent, and optional coordinator eligibility. The
eligibility value distinguishes a person (`not-applicable`) from an AI coworker whose canonical JSI
and TAK authority binding is `eligible | absent | stale | narrowed | suspended | incompatible | unknown`.
Unknown is not inferred as eligible.

`WorkroomShapeConformance` returns the exact shape key/version, collaboration shape, overseer
identity/source, current/next stage, normalized observation summary, sorted deviations,
disposition, intervention reason, checked instant, and reconciliation key. The key excludes the
wall-clock instant and includes only stable room/shape/stage/deviation/operation identity, so a
retry of the same observed state has the same key.

`WorkroomLifecycleGuardDecision` returns either `allowed: true` with the permitted operation or
`allowed: false` with disposition, reason, deviation codes, reconciliation key, and a complete
receipt payload. Callers persist that payload without reconstructing policy. A shaped operation
with a missing projection returns a typed `missing_conformance_result` refusal; an unshaped room
returns `not-applicable` and preserves legacy behavior.

### 3.3 Reliability and consistency rules

- The projector is total and side-effect free: malformed or missing shaped observations become
  deviations rather than exceptions or optimistic defaults.
- Declared shape identity is exact. An unresolved key or version mismatch refuses execution; the
  projector never silently substitutes the latest shape.
- Lifecycle callers pass the projection produced from the same transaction/read snapshot as the
  proposed transition. Stores re-check the guard before write, preventing a stale UI projection
  from authorizing execution.
- Receipt persistence is append-only and idempotent on `(room, reconciliationKey, operation)`.
  A duplicate retry reads the existing refusal/intervention receipt rather than emitting another.
- A persistence failure means the transition remains refused. No lifecycle advance is committed
  without its required receipt; no receipt claims a transition that rolled back.
- Standing reconciliation is per-room and bounded. A failed room does not poison the sweep, and
  the next sweep safely retries the same reconciliation key.
- The UI treats the projection as explanatory state, not authority. Missing UI data cannot turn a
  refusal into an allow.

### 3.4 Recovery matrix

| Failure | Required behavior | Recovery |
|---|---|---|
| Shape key cannot resolve or version differs | `pause`; no dispatch/open/complete | Restore the declared version or make an explicit reviewed shape migration, then reproject. |
| No explicit coordinator, multiple coordinators, or derived-only coordinator | `escalate`; no autonomous advance | Persist exactly one qualified coordinator through the canonical roster path. |
| AI coordinator eligibility is absent, stale, suspended, incompatible, or unknown | `escalate` or `stop` according to severity | Refresh JSI evidence/TAK binding or assign a qualified coordinator; never self-certify. |
| Stage/evidence/grant/budget/review/stop deviation | Refuse with the typed deviation and append one receipt | Repair the observed fact or obtain the already-declared human authorization; reproject. |
| Conformance projection unavailable for a shaped room | Fail closed with `missing_conformance_result` | Retry projection from canonical state; do not fall back to legacy execution. |
| Receipt append fails | Roll back/withhold the lifecycle write | Retry the same operation and reconciliation key after storage recovers. |
| Standing sweep crashes mid-run | Previously committed rooms remain committed; uncommitted room remains eligible | Resume per-room reconciliation; idempotency suppresses duplicates. |
| UI cannot render the section | Enforcement remains active server-side | Surface the existing error boundary/notice and repair the read surface; never disable the guard. |

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

**OBJ-WPO-001:** Every Workroom projects one explainable Process Overseer state from its declared
collaboration and activity shapes plus observed participants, stages, evidence, authority, budgets,
reviews, stop conditions, and coordinator eligibility.

**OBJ-WPO-002:** Executable shaped Workrooms advance only through a shared fail-closed lifecycle
guard, while unshaped legacy Workrooms retain compatible behavior and report that conformance is
not applicable.

**OBJ-WPO-003:** Every refusal or intervention is deterministic, attributable, and idempotently
reconcilable without widening authority or allowing the coordinator to judge its own work.

**OBJ-WPO-004:** The existing Workroom detail surface explains coordinator assignment, conformance,
stage progress, deviations, and intervention in an accessible compact presentation.

| Acceptance ID | Objective | Acceptance statement |
|---|---|---|
| AC-WPO-001 | OBJ-WPO-001, OBJ-WPO-004 | Every `WorkroomView` exposes a Process Overseer/conformance projection and the existing Workroom detail surface renders it. |
| AC-WPO-002 | OBJ-WPO-001, OBJ-WPO-002 | An executable shaped Workroom requires exactly one explicitly persisted coordinator; absent, multiple, or legacy-derived assignment cannot autonomously advance. |
| AC-WPO-003 | OBJ-WPO-001, OBJ-WPO-003 | Required roles, stage order, evidence, receipts, grants, budgets, review points, stop conditions, role independence, and AI JSI/TAK eligibility produce deterministic typed deviations. |
| AC-WPO-004 | OBJ-WPO-002, OBJ-WPO-003 | The shared lifecycle guard refuses nonconformant shaped operations with the exact disposition and intervention data, while preserving unshaped legacy compatibility. |
| AC-WPO-005 | OBJ-WPO-003 | Repeated checks produce one stable reconciliation key suitable for one attributable activity or attention receipt. |
| AC-WPO-006 | OBJ-WPO-004 | The Workroom surface distinguishes explicit from compatibility-only derived coordination and explains current/next stage, last check, unresolved deviations, and intervention reason. |
| AC-WPO-007 | OBJ-WPO-001, OBJ-WPO-002, OBJ-WPO-003, OBJ-WPO-004 | Focused pure, read-model, lifecycle, and component tests, typecheck, production build, UX route sweep, exact-tree CI, merge checks, and live-install verification pass before completion. |
