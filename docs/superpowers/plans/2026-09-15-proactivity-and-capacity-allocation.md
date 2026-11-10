---
status: active
---

# Proactivity and capacity allocation — implementation plan

**Design:** [2026-09-15-proactivity-and-capacity-allocation-design.md](../specs/2026-09-15-proactivity-and-capacity-allocation-design.md)
**Backlog:** `BI-7AE90091`
**Kernel:** `DI-BD764C443825` (drain funds business work, with floors — margin 3.905, high
confidence, autonomy-eligible) · `DI-E56D267C303C` (derived postures per archetype — margin
6.771, high confidence, autonomy-eligible).

## Outcome

The operator sees, on one page, what every workroom in the hierarchy is set up to do, who owns
it, how proactive it is, what share of the week's LLM capacity it holds, and what that capacity
bought. A situational posture re-weights allocation without ever breaching a floor. Spare
capacity near the weekly reset funds the business, not only the platform. Stages run on the
cheapest model that can actually do them.

## Delivery boundary

**Every slice ends at something observable on this install.** This program has shipped eleven
capabilities that were complete, tested, green and unconnected. No slice is done at a finished
module; each names a number that moves on the live install, and that observation is the
acceptance criterion.

## Phase A — read model and board

Deliverable: the operator can see the real state of the hierarchy.

Files: `apps/web/lib/ops/allocation-read-model.ts`; a route under the existing Operations
section; report-kit primitives, theme tokens, UX-fit manifest.

Steps:
1. Failing tests: the tree resolves from `contains` relations; each row carries shape, trigger,
   owner (ladder-resolved or flagged unowned), proactivity level and action boundary; spend
   attributes from `AgentBudgetEvent`; a room with backlog pressure and no allocation is
   flagged starved; a proxy figure is labelled a proxy and never presented as measurement.
2. Compose the read model from existing sources only — no new tables.

**Observable:** the board shows this install's twelve standing rooms with real spend and real
throughput, and names anything starved.

## Phase B — allocation model

Deliverable: planned share per portfolio and room, with floors that hold.

Files: `apps/web/lib/capacity/allocation-model.ts` (pure).

Steps:
1. Failing tests first, and the floor test is the one that matters: **a maximal posture boost
   cannot reduce any portfolio below its floor**; ceilings cap a single portfolio's weekly
   draw; lending moves only the surplus above a lender's own need; lending never reclaims
   mid-week; the sum of shares never exceeds the pool.
2. Pure function over pool, tree, demand scores and posture weights.

**Observable:** the board shows planned versus actual share per portfolio, with floors visible.

## Phase C — situational postures

Deliverable: the operator picks a business situation; allocation re-weights.

Files: `packages/storefront-templates/src/postures.ts` (derived, as `standing-rooms.ts` is);
a governed write to select one.

Steps:
1. Failing conformance tests: every leaf archetype resolves a posture set including `steady`;
   **no posture is authored per install** (the archetype demarcation guard extends to cover
   postures); selecting one records reason and actor; floors survive every posture.
2. Derive posture sets from each archetype's operational value stream.

**Observable:** selecting `at-capacity` visibly re-weights the board; the foundational floor
does not move.

## Phase D — drain extension

Deliverable: spare weekly capacity funds business work.

Files: `apps/web/lib/capacity/evaluate-drain.ts` (extend; it currently dispatches Build Studio
only, bounded by `BUILD_WIP_CAP`).

Steps:
1. Failing tests: archetype room work is a drain candidate alongside builds; candidates rank by
   demand within posture weights; a floor-protected room is never drained *from*; the drain
   still respects WIP caps and the quiescence gate; with no ready business work the drain
   behaves exactly as today.
2. Extend the candidate set; keep the existing dispatch path.

**Observable:** near a reset, spare capacity dispatches archetype work, attributed to the room
that spent it.

## Phase E — posture suggestion

Deliverable: the platform proposes the posture rather than waiting to be told.

Steps:
1. Failing tests: a rescue at occupancy threshold proposes `at-capacity`; the proposal carries
   the evidence that produced it; **a proposal is never auto-applied**; a disputed proposal
   leaves the current posture untouched.
2. Derive from the organisation's own operational data.

**Observable:** the board proposes `at-capacity` from occupancy before the operator selects it.

## Phase F — backlog coverage

Deliverable: the backlog is mapped to the rooms that would execute it.

Steps:
1. Failing tests: platform-scoped items map to the Build Studio room, archetype items to their
   archetype rooms; an item mapping nowhere is reported, never silently dropped; a room with
   waiting backlog and no allocation is named starved.

**Observable:** starved rooms are named together with the backlog waiting on them.

## Phase G — effort tier per stage

Deliverable: the week serves more work at the same cost.

Files: `work-shapes.ts` (stage gains `effort`); `tak/effort-warrant.ts` (declared tier beats
the proxy); the dispatcher passes it through.

Steps:
1. Failing tests: a stage-declared tier beats the message-length proxy; **a governed-decision
   stage is never demoted** regardless of budget pressure; an undeclared stage falls back to
   today's behaviour exactly; the board reports spend per stage against its declared tier.
2. Declare tiers across the standing shapes (sweeps and correlations low; governed decisions
   high).

**Observable:** the same weekly pool serves materially more stage runs, with governed decisions
unchanged in tier and count.

## Sequencing

A → B → C are the spine and must land in order; the board is worthless without the model, and
the model is unsteerable without postures. **G is independent and has the best
value-to-effort ratio in the plan** — it stretches the pool whether or not the rest lands, and
can go first if budget pressure is the urgent problem. D depends on B (floors must exist before
the drain can respect them). E depends on C. F is independent.

## Risks and rollback

- **A boosted posture starves an obligation.** Structurally prevented by floors; asserted in
  Phase B, not left to review.
- **The board becomes a second scheduler.** It sets shares and posts asks; the drive still
  dispatches. Any design where the board calls dispatch is wrong.
- **Postures drift into per-install authoring.** Guarded in Phase C by extending the existing
  archetype demarcation guard.
- **Cheap models degrade governed decisions.** Phase G forbids demoting a governed-decision
  stage; the tier is a capability floor, not a cost target.
- **Rollback:** A, E, F revert cleanly. B and the allocation model are pure functions. C and G
  are declarations plus a resolver. D is an extension of an existing candidate set and reverts
  to Build-Studio-only.

## Backlog coverage

`BI-7AE90091`. Coverage recorded via `record_plan_backlog_coverage` once the plan commit's
provenance resolves; no receipt claimed here.
