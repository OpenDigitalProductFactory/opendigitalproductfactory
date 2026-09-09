---
status: active
Backlog: BI-2515F779
Profile: fix
Author: Mark Bodman
Date: 2026-09-09
---

# Acceptance route reads a decomposed child's inherited baseline — fix design

## 1. Defect

**OBJ-ARB-ROUTE-INHERITS:** The acceptance reviewer route for a decomposed
child binds to the same inherited scope baseline the readiness projection
already grants it, so the one receipt the medium shape owes is reachable.

Reproduced on this operator install (development), served `v2026.09.08-reviewer-recovery.3`
(contains #5187), 2026-09-09 00:55Z: `update_backlog_item_status(done)` on
BI-B269FC72, BI-AFE8BB73 and BI-F2FEC1EB (children of BI-B5C8FEFC by plan
coverage `cmtq1ibws07w601qwkobgze4b`) evaluates `initiative-readiness.v3` with
delivery passing and exactly one unmet requirement, `ACCEPTANCE_EVIDENCE_REQUIRED`
("an eligible reviewer (a coworker qualifies) verifies the acceptance criteria"),
while `OBJECTIVE_BASELINE_REQUIRED` passes through inheritance. The recovery
packet issues no reviewer route and escalates
`baseline-not-found: No current objective baseline exists. Complete independent
spec approval before acceptance mapping` (decisions IRD-669768E43DD4,
IRD-C7E84E37D0FD, IRD-03C6F2445F57).

Named ref: `apps/web/lib/backlog/initiative-readiness/terminal-recovery.ts`
at `cdf5a475f468`, `defaultLoadBaselinePayloads` (line 206) and
`defaultLoadEligibleEvidenceActivityIds` (line 220) read
`initiative_scope_baseline` rows on the subject only. The projection's
inheritance (`parent-scope-inheritance.ts`, BI-B87514F5) is never consulted
by the router.

Ruled out by running: re-syncing the rooms with `adopt_worktree`
(workroom-identity-incomplete cleared, baseline-not-found remained); recording
delivery evidence (DELIVERY_EVIDENCE_REQUIRED flipped to pass, baseline-not-found
remained); the parent BI-B5C8FEFC, which has its own baseline, received a
route from the same code path.

## 2. Ordered fix

1. `baseline-source.ts`: one resolver, `loadBaselineSource(db, itemId)`, returns
   the subject's own baseline rows when it has any, else the baselines of the
   parent whose decomposed coverage maps it (via `loadInheritedInitiativeScope`),
   with `origin` and `inheritedFromItemId` for audit. Evidence is never
   inherited.
2. `terminal-recovery.ts`: both default ports read through the resolver. The
   pure router and every existing test are untouched.
3. Runbook line under "children inherit the parent's scope" names the resolver.

## 3. Acceptance

| AC | Objective | Statement |
| --- | --- | --- |
| AC-ARB-OWN-WINS | OBJ-ARB-ROUTE-INHERITS | An item with its own baseline rows is routed against them; the parent is not read. |
| AC-ARB-INHERITED-ROUTE | OBJ-ARB-ROUTE-INHERITS | A decomposed child with no baseline of its own is routed against its parent's baseline chain and its own post-baseline evidence, and receives a reviewer route instead of `baseline-not-found`. |
| AC-ARB-NONE-STAYS-CLOSED | OBJ-ARB-ROUTE-INHERITS | An item with neither its own nor an inherited baseline still escalates `baseline-not-found`. |

Failing-to-passing proof: `baseline-source.test.ts` (4 cases) fails to compile
before step 1 and passes after; `terminal-recovery.test.ts` (16 cases) is green
before and after.

## 4. Rollback

One PR revert; no schema, no data.
