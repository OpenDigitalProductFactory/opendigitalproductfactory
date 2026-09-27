# Repair archetype room projection persistence and lifecycle

Status: proposed; independent review pending. Backlog: BI-224E6E82.
Workroom: WC-0829A222. Date: 2026-09-27.

## Existing direction and evidence

This addendum repairs the existing room projection; it does not establish another
room model, scheduler, authorization system, or business process.

PR #5141 merged as `3860578dea493e49d1efacc521c500e5c1fb5080`
(commit timestamp 2026-09-06T21:14:17Z). Its signed design-grounding trailer cites
`docs/architecture/archetype-business-value-streams.md` section 2.1 and the work
source registry. That historical architecture document's blob is
`53c242ba4e8abd18577f96e4cc41d7dd5c863bc1`. It defines composition from one
operational value-stream model. This is historical design evidence, not a new
independent approval or proof that the shipped persistence worked.

Reuse [archetype business value streams](../../architecture/archetype-business-value-streams.md),
[proactive workrooms](2026-08-29-proactive-workrooms-design.md), and the existing
`EaElement` lifecycle. The existing BI acceptance criteria remain authoritative.

Source inspection at `71b9df9f08705fd1ff67b2c5f01cfc87a05e71b0` found:

- `archetype-room-definition-projection.ts` supplies `notationId` to EaElement,
  although that model obtains notation through its element type.
- Relationship filters use `sourceId` and `targetId`; the Prisma model defines
  `fromElementId` and `toElementId`.
- Removed definitions, relationships and view bindings are physically deleted,
  contrary to the BI's history-preserving acceptance.
- The room projector has no production caller. The existing app orchestrator
  `apps/web/lib/storefront/project-operational-value-stream.ts` invokes only EA
  projection and is used by setup/reset/backfill flows.

These are structural findings (receipt `cmuk3p3ox041a01upwercarom`). No live
Prisma or portal acceptance has yet passed for this repair.

## Research reuse and bounded comparison

The prior operational-model research and vocabulary remain in the linked design
documents; do not repeat or backdate them. This repair compares existing local
implementation choices, rather than adopting a new external framework:

| Existing approach | Reuse or reject for this repair |
| --- | --- |
| EA value-stream projection and app orchestration | Reuse the derived OVSM and production entrypoint; preserve EA return contract. |
| Room projection's unknown-argument persistence facade | Replace query argument erasure with Prisma-checked query shapes; mocks must not hide invalid fields. |
| Canonical EaElement lifecycle and retained relationships | Use retirement instead of deletion; retain identity and audit history. |

New external benchmarking is not claimed. Independent review must determine
whether the historical evidence is sufficient for the existing feature baseline.

## Repair contract

The identifiers below make the existing repair requirements and acceptance
criteria readable by the scope-baseline writer. They do not expand the scope.

**OBJ-PERSIST:** Persist each declared stage as a room definition with valid typed database writes and its declared role, trigger, outcome, gates and measures.
**OBJ-IDENTITY:** Preserve one room identity per organization and stage across repeated and concurrent projection, without losing unrelated metadata.
**OBJ-HISTORY:** Retire and reactivate room definitions without deleting their identities, relationships, view references or lifecycle history.
**OBJ-ATOMIC:** Derive the operational model once and commit the EA and room projections atomically through the existing production entrypoint.
**OBJ-CONVERGE:** Reconcile existing EA-only installations through the supported entrypoint and verify the resulting room lifecycle on the deployed system.

R1. Persist every declared stage's trigger, outcome, responsible role, trust gates
and measure bindings with valid Prisma inputs. Resolve a missing stage role from
its declared stream role consistently with the sibling job-definition projection;
never invent a role absent from both.

R2. Keep identity scoped to projection source, organization and stage key. Repeat
projection updates the same row. Separate organizations must never share rows.
Preserve unrelated metadata. Concurrent projection must not silently duplicate
definitions: use the existing transaction/locking convention, verify it with a
real database test, and seek design review if no existing convention suffices.

R3. A dropped stage becomes retired under the existing lifecycle vocabulary.
Preserve its row, relationships, view references and existing history. Record the
transition through the established lifecycle audit convention. A reintroduced
stage reactivates the retained identity. Active-definition consumers must exclude
retired definitions, while historical references continue to resolve. Do not
apply destructive pruning conventions from the EA canvas to room history.

R4. Extend `projectOperationalValueStreamForArchetype` to invoke both projections
using one derived model and one transaction. Respect a caller-supplied transaction;
when none exists, use the canonical client transaction. Preserve the current EA
result shape consumed by setup/reset/backfill. A room failure must roll back the
combined projection and propagate an actionable failure rather than report success.

R5. Existing installations converge through the existing operational-value-stream
backfill/reconciliation entrypoint. Verify that its eligibility check does not skip
organizations merely because EA already exists. Do not add a second scheduler or
run broad production backfills as an incidental test.

## Acceptance and verification

| ID | Objectives | Required observation |
| --- | --- | --- |
| AC-1 | OBJ-PERSIST | Actual generated Prisma client creates and updates room definitions with all declared bindings; unknown fields cannot pass typechecking. |
| AC-2 | OBJ-IDENTITY | Repetition and concurrent invocation preserve one identity per organization/stage; another organization's rows are untouched. |
| AC-3 | OBJ-HISTORY | Removing then restoring a stage preserves row identity, relationships and history, excludes retirement from active results, and records lifecycle transitions. |
| AC-4 | OBJ-ATOMIC | Production orchestration derives once and persists both projections; injected failure leaves neither partially committed. |
| AC-5 | OBJ-CONVERGE | Existing EA-only organizations are eligible for supported reconciliation and receive room definitions without a duplicate EA model. |
| AC-6 | OBJ-PERSIST, OBJ-IDENTITY, OBJ-HISTORY, OBJ-ATOMIC, OBJ-CONVERGE | Live supported setup/reset or reconciliation against a governed test organization yields the expected definitions and retirement behavior. |

AC-1 through AC-6 retain the statements previously labelled AC1 through AC6.
The prior design-spec receipt remains evidence for its exact reviewed revision;
this format correction still requires approval of the revised immutable artifact.

Unit tests alone are insufficient. Real Prisma regression coverage must use the
shared nonproduction environment and an isolated test organization. Tests must
assert retained relationships and rollback, not merely compare mocked arguments.
Live acceptance must record the served image/commit, operation and observed rows.

## Scope, risk and recovery

This is one atomic repair of BI-224E6E82. Runtime trust-gate enforcement, metric
computation, UI redesign, coworker dispatch and the sibling job projection's
independent functionality remain outside this change.

Consolidate only conventions required for this repair: typed projection inputs,
shared orchestration and retirement semantics. Allocate about one fifth of effort
to that refactoring; avoid a broad framework rewrite.

Risks are transaction ownership, JSON metadata preservation, backfill selection,
and consumers that assume every definition is active. Trace those consumers before
implementation. No schema migration is planned; any discovered uniqueness/schema
requirement must amend this design before implementation. Roll back code via a
reviewed revert, retain all data/history, and use supported reconciliation after
repair. Never restore destructive cleanup as a runtime workaround.

Implementation and acceptance remain pending. Follow the [repair plan](../plans/2026-09-27-archetype-room-projection-repair-plan.md).
