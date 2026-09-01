---
status: active
---

# Proactive Workrooms implementation plan

**Design:** [2026-08-29-proactive-workrooms-design.md](../specs/2026-08-29-proactive-workrooms-design.md)
**Epics:** `EP-WORKFORCE-TRANSITION` · `EP-WORK-CONVERGENCE` · `EP-PAAW-HARMONIZATION`
**Phase C backlog item:** `BI-662254C6` — canonical Workroom relations
**Kernel:** `DI-6B057EE5AE32` (`wire-work-shapes-to-rooms`, high confidence)
**Branch:** `doc/workroom-proactive-operations` (this design/plan) — implementation branches per slice

## Outcome

A standing Workroom wakes on its own declared trigger, runs the stages its shape assigns to an AI
coworker under one explicit coordinator/Process Overseer, hands every governed advance to the
accountable human, records a cycle and its evidence, and stops on a declared condition. Customer
0's source-code operations, adopter inquiries and
payables run in such rooms, portfolio-aligned and nested — and the generic half ships to every
install of the archetype while the DPF-specific half stays configuration.

## Research and benchmarking

Recorded in the design, §7 — Kubernetes controllers (level-triggered reconcile, bounded), Prefect /
Dagster (freshness-as-trigger, schedule separated from work definition), Renovate and Dependabot
(propose-never-commit; generic tool, configured binding). Adoptions and rejections are stated there
rather than repeated here.

## Delivery boundary

**Decision: sliced, not atomic.** Unlike the workroom-portfolio convergence plan, these slices are
genuinely independent products, not internal sequencing:

- A + B deliver a running drive with no rooms declared — inert but complete and testable.
- C (relations) is independently valuable: it closes the specified-but-unmodelled nesting gap
  (design finding 8) whether or not any room is driven.
- E and F are separable by construction — that separability *is* the demarcation requirement, and
  shipping them together would make the boundary untestable.

The atomic-vs-sliced call matters because the alternative — one large PR — would land an unproven
drive runner and customer 0's own business bindings in the same revert unit.

## Phase A — bind a shape to a room

Deliverable: a standing room can declare `workShapeKey@version`, and that claim projects into the
room's cycle. No runner; nothing wakes.

Files:
- `apps/web/lib/work-management/workroom-shape-claim.ts` (extend — the existing claim mechanism)
- `apps/web/lib/work-management/work-shapes.ts` (its first production consumer)
- `apps/web/lib/work-management/room-cycle-adapter.ts`

Steps:
1. Failing tests: a room with a work-shape claim projects a cycle whose `trigger`, `stopConditions`
   and `expectedReviewAt` come from the declared shape; a room with no claim is byte-identical to
   today; an unknown or unparseable `key@version` resolves null and never throws on the read path.
2. Extend the claim reader/writer. No migration — `scopeClaims` is the same carrier the collaboration
   shape and posture claims already ride, per the design §3.2.
3. Call `projectWorkShapeCycleBoundary` from the adapter.

Verification: targeted Vitest; `pnpm --filter web build`. Docs: none — no user-visible surface.

## Phase B — the overseen drive runner

Deliverable: a declared standing room with one explicit coordinator passes shape conformance, wakes
on its trigger, runs its `agent:` stages, rechecks conformance, and stops.

Files:
- `apps/web/lib/queue/functions/workroom-drive.ts` (new — mirrors
  `obligation-assurance-watch.ts`: pure exported job + thin Inngest cron/event wrappers behind
  `gateAtEntry`)
- `apps/web/lib/work-management/drive-resolution.ts` (new — pure: shape + posture → dispatch plan)
- `apps/web/lib/work-management/workroom-shape-conformance.ts` (new — pure declared-versus-observed
  projection shared with finite-room transitions)
- `apps/web/lib/operate/scheduled-jobs/agent-task-core.ts` (reuse `scheduleAgentTaskFor` unchanged)

Steps:
1. Failing tests first, and these are the load-bearing ones:
   - zero, multiple, or only legacy-derived coordinators refuse dispatch; one explicit current
     coordinator is required;
   - missing required participants, out-of-order stage, absent prerequisite receipt, exhausted
     budget, due review point, or met stop condition returns a typed deviation and next disposition;
   - a stage whose `accountablePrincipalRef` is `role:` or `person:` is **never** dispatched — it
     becomes an attention item (design §3.2, §6);
   - a `governed-decision` advance is never executed by the runner at any posture;
   - each declared stop condition halts the run and escalates; the budget stop does not bury the
     ledger;
   - a room whose posture resolves to `quiet` does not wake;
   - an unreachable substrate reports and stops, and raises nothing from an empty read.
2. Resolve the posture through the existing ladder — do not re-derive cadence. `damp` remains the
   only reducing lever; clamps only tighten.
3. Consume the same pure conformance result before and after dispatch. Append an attributable
   receipt and attention item on drift; do not invent an occupant, skip a stage, widen authority,
   or silently retry.
4. Dispatch through the existing `ScheduledAgentTask` engine with a deterministic task id derived
   from `roomId + shapeKey`, so reconcile is idempotent and flipping a setting never piles up
   duplicate schedules (the lesson already encoded in `coworker-self-tasks.ts`).
5. Record the cycle (Phase A), observed transition, conformance result, and room activity on the
   existing ledger.

Verification: targeted Vitest; `pnpm --filter web build`; a driven test room exercised on the shared
nonproduction environment under a claimed lease — never by rebuilding the live portal.

## Phase C — workroom relations

Deliverable (`BI-662254C6`): the five work-coordination relations are modelled, closing design
finding 8.

Files:
- `packages/db/prisma/schema/work-coordination.prisma` (new `WorkroomRelation` model)
- one forward-only migration, backfill SQL inline
- `apps/web/lib/work-management/room-relations.ts`

Steps:
1. Failing tests: each of `contains` / `spawned-from` / `depends-on` / `blocks` / `contributes-to`
   round-trips; a cycle in `contains` is rejected; portfolio dependencies are **not** silently
   converted into work-coordination relations (the vocabulary boundary's explicit warning).
2. Add the closed relation enum, the normalized join model, named endpoint relations, triple
   uniqueness, and endpoint-leading indexes. Add the forward-only migration. It must apply cleanly
   against the existing 330-row population, not just a clean schema; there is no backfill because no
   existing field can distinguish or safely infer any of the five relations.
3. Add the one-room adjacency read model. Keep descendant traversal explicitly depth- or
   cursor-bounded; never load the full room inventory and silently truncate it.

Verification: `pnpm --filter web exec vitest run`; migration applied against a copy of live-shaped
data; `pnpm --filter web build`.

## Phase D — proactivity families for standing operations

Deliverable: a posture can govern this work at all (design finding 4).

Files:
- `apps/web/lib/proactivity/proactivity-types.ts`
- `apps/web/lib/proactivity/proactivity-resolver.ts`

Steps:
1. Failing tests per new family, and a test that the closed union is exhaustive.
2. Add families for contribution intake, code-review flow, advisory triage, adopter inquiry and
   payables. Each gets an explicit comment saying why it is not folded into an existing family —
   the discipline `marketing-campaign` already set.
3. Advisory triage and payables inherit the out-of-hours **exemption** posture where harm accrues
   while the business is closed; adopter inquiry does not.

Verification: targeted Vitest; `pnpm --filter web build`.

## Phase E — the software-platform standing-room profile (L2)

Deliverable: every install of the `software-platform` archetype gets the room set, derived.

Files:
- `packages/storefront-templates/src/standing-rooms.ts` (new, derived — modelled on
  `operational-value-stream.ts`)
- `apps/web/lib/work-management/work-shapes.ts` (the shape declarations)

Steps:
1. Failing conformance tests **first** — these are the demarcation's control gate, not the prose:
   - no file under `packages/storefront-templates/` contains a forge URL, a foreign org slug, or a
     credential-shaped string;
   - every declared room definition resolves for every leaf archetype in the category from OVSM
     alone;
   - no `apps/web/lib/work-management/` module imports from `src/archetypes/`.
2. Declare the shapes of design §5 — five top rooms, thirteen sub-rooms — each passing
   `validateWorkShape` (failure exit and budget stop mandatory).
3. Derive the room set from OVSM; author nothing per archetype.

Verification: conformance suite; `pnpm --filter storefront-templates exec vitest run`;
`pnpm --filter web build`. Docs: the archetype profile catalogue gains the room set.

## Phase F — Customer-0 bindings (L3)

Deliverable: DPF's own rooms exist, bound to DPF's repository, coworkers and thresholds.

Files:
- seed / configuration rows only — **no** `apps/web/lib` or `packages/` change may appear in this
  phase's diff. If one does, the demarcation is wrong and Phase E is not finished.

Steps:
1. Create the five top rooms and their sub-rooms with `contains` relations (Phase C), correct
   `portfolioRole`, `activityKind` and `servesPortfolioRoles`.
2. Bind the forge coordinates, coworker-to-stage assignments and thresholds as configuration.
3. Retire `WC-42C558DD` into the new `foundational` Source Custody room, preserving its outcome
   anchor — teardown removes execution resources, never history.
4. Surface the **one open placement question** from design §5: Business Administration under
   `foundational` versus its own support portfolio. Operator ratification, not an agent decision.

Verification: live install — each room wakes, produces one cycle, and hands its governed advance to
the human. Recorded as canonical-runtime execution evidence via `record_execution_evidence`.

## Phase G — the room surface

Deliverable: the Process Overseer and drive are legible — who owns conformance, whether the
assignment is explicit or derived, current and expected next stage, deviations, last check, what
wakes the room, when next, what happened last, and why it is behaving this way.

Files: `apps/web/components/workspace/workroom/` (compose existing primitives; no new route)

Verification: component tests; theme-aware token check; UX-fit manifest; browser exercise on the
shared nonproduction environment at desktop and narrow viewports.

## Phase H — retire agent-owned proactivity

Deliverable: `COWORKER_SELF_TASKS`'s four entries become declared shapes, the `agent:` preference
scope and per-coworker proactivity controls are removed, and one Workroom-owned drive/posture
mechanism remains. Legacy agent-scoped facts are ignored rather than copied into rooms because an
identity preference cannot be inferred as an outcome preference. Unroomed activity uses the
activity-family/platform default. Participant trust, grants, qualifications and autonomy remain
tighten-only safety ceilings, not proactivity settings. Acceptance is owned by `BI-87C9C91C`.

**Explicitly gated on E and F succeeding on the live install.** Retiring the working mechanism before
its replacement is proven is how a proactivity outage happens silently.

## Risks and rollback

- **A driven room that will not stop.** The sharpest risk in the plan. Mitigated structurally: no
  shape passes `validateWorkShape` without a failure exit and a budget stop, and Phase B's tests
  assert each halts a run. Rollback: disable the Inngest cron; rooms revert to inert records.
- **Demarcation leak.** Mitigated by Phase E's three conformance tests running before the profile is
  written, and by Phase F being config-only — a code file in that diff is the tripwire.
- **Duplicate schedules.** Deterministic task id from `roomId + shapeKey`; reconcile is idempotent.
- **Coordinator self-certifies the work.** The Process Overseer owns sequence and conformance, not
  the task result or consequential approval. Tests reject coordinator/evaluator or
  coordinator/approver overlap when the shape requires independence; AI coordinators also require
  current process-coordination JSI and TAK authority.
- **Migration against live data.** Phase C's migration must apply against the existing 330-row
  population; forward-only, backfill inline.
- **Spend.** Standing rooms consume inference on a cadence. `spendClass` already rides the posture;
  the budget stop condition bounds a single run; the review point bounds the room.
- **Rollback shape:** A, B, D, G revert cleanly. C leaves an unused table (forward-only, acceptable).
  E and F are data/profile changes revertible without migration.

## Backlog coverage

Phase C is covered by `BI-662254C6`: one independently shippable relation-model slice for the five
closed work-coordination relations, its forward-only migration, cycle rejection, and read model.
This mapping does not convert portfolio dependencies into Workroom relations.

The executable Process Overseer is filed as `BI-3913EB49` under live epic `EP-1FABA22D`. It reuses
`BI-4CB2EF76` for persisted participant/coordinator assignment and `BI-EFFD97B4` for definition-level
trigger, grant, and measure contracts. The latter explicitly excludes the trigger runtime; this
plan's Phase B and `BI-3913EB49` own transition conformance and drive enforcement rather than
stretching either dependency.

Coverage is recorded via `record_plan_backlog_coverage` only after an independently approved scope
baseline and a pushed plan commit resolve. No receipt is claimed here.
