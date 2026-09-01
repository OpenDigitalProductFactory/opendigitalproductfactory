# Workroom Process Overseer — Implementation Plan

**Backlog item:** `BI-3913EB49`  
**Design:** `docs/superpowers/specs/2026-09-01-workroom-process-overseer-design.md`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time —
> one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
> `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and
> `dpf-pr-with-dco` for handoff.

## Delivery shape

This is one atomic, clean-revert contract. The pure projection, lifecycle consumption, read-model
field, and UI explanation are not independently useful: shipping only the projection would still
permit drift; shipping only enforcement would make refusals opaque; shipping only UI would assert
control that does not exist.

## Phase 1 — Pure conformance projection (TDD)

Create `workroom-shape-conformance.ts` and colocated tests. Reuse the canonical collaboration-shape,
work-shape, participant, coordinator, receipt, cycle, and outcome types. Add no table or agent role.

Red cases cover zero/multiple/derived coordinators, missing roles, forbidden role overlap,
shape/version mismatch, missing/out-of-order stage, missing evidence/receipt, grant widening,
budget exhaustion, due review, met stop, AI JSI/TAK ineligibility, and unresolved deviations at close.
Prove deviation ordering/deduplication and stable reconciliation keys.

## Phase 2 — Lifecycle enforcement and durable explanation (TDD)

Add a shared lifecycle guard. Shaped operations require a passing conformance result; unshaped
legacy operations retain current behavior. Consume the guard in room-cycle open/complete paths and
expose the same guard for stage dispatch/review callers. Refusals carry the exact disposition,
deviation codes, intervention reason, and reconciliation key so callers can append one attributable
activity/attention receipt without guessing.

Update room-cycle-store tests for continue, pause/escalate/stop, idempotent replay, and close with an
unresolved deviation.

## Phase 3 — Workroom projection and UX (TDD)

Add the conformance projection to `WorkroomView` and compute it in `buildWorkroomView` from the
declared shape claims plus observed roster/cycle/receipts. Add a Process Overseer component to the
existing detail context using report-kit primitives and theme variables. Show explicit/derived
assignment, disposition, current/next stage, last check, deviations, and intervention reason.

Update read-model and component tests. Capture a measured UX-fit manifest for the touched Workroom
component files and verify narrow/wide plus light/dark rendering through the canonical route sweep.

## Phase 4 — Refactor and blast-radius closure

Spend at least 20% of the change consolidating existing coordinator, required-role, shape-binding,
stage, receipt, and stop checks behind the shared projection/guard. Sweep importers, JSON baselines,
prompt/skill prose, migrations, and CI content guards. Keep one authoritative rule per fact.

## Verification

- focused Vitest: conformance, coordinator/participation, shape claim, room-cycle store, read model,
  outcome packet, and Workroom component;
- typecheck and production build;
- UX fit manifest plus route/theme/viewport sweep;
- `pnpm run pregate:preflight`, independent semantic review, and `pnpm run pregate` on the exact
  committed tree;
- GitHub required checks and live-install verification after merge when the install serves the
  merge commit.

## Risks and rollback

- **False refusal:** keep deviation inputs explicit and pure; tests pin each refusal independently.
- **Legacy breakage:** only a declared work shape activates mandatory conformance.
- **Authority widening:** compare observed grants to the shape ceiling; never mutate grants.
- **Duplicate attention:** stable reconciliation key makes replay idempotent.
- **UX overload:** one collapsed/compact existing-detail section, no new route or dashboard.

Rollback removes lifecycle consumption while retaining recorded activities and read projection.
Nonconformant rooms remain paused rather than being reclassified as conformant.

## Backlog coverage

Decision: `atomic`. All four phases are one fail-closed Process Overseer contract mapped to
`BI-3913EB49`; none is independently shippable without creating either unenforced or unexplained
behavior. The immutable coverage receipt is recorded after this plan is committed and pushed.

