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
4. (Second slice, found live on `v2026.09.09-acceptance-route-inherits-baseline.1`:
   the route was issued but dispatch refused `baseline-conflict`.)
   `objective-mapping-submission-admission.ts` and
   `objective-mapping-repository.ts` read the same resolver through
   `loadBaselineSourceForItem`, and the writer accepts a baseline whose subject
   is the inheriting parent. Test: a decomposed child with no baseline of its
   own is admitted and its mapping recorded against the parent's chain.
5. (Third slice, found live on `v2026.09.09-acceptance-route-inherits-baseline.2`:
   the mapping was recorded but completion still reported
   `ACCEPTANCE_EVIDENCE_REQUIRED`.) The item transition's reconciliation
   (`backlog-terminal-transition.ts` → `reconcileInitiativeObjectives`) read only
   the child's own baseline rows. The transition now loads the inherited scope
   before reconciling and, when the child has no baseline of its own, adds the
   parent's baseline rows and names the parent as an accepted baseline subject
   (`baselineSubjectIds`). Own rows always win. Test: a child's mapping and
   evidence reconcile to `pass` against the parent's baseline only when the
   parent is named; a foreign baseline stays `missing`.

## 3. Acceptance

| AC | Objective | Statement |
| --- | --- | --- |
| AC-ARB-OWN-WINS | OBJ-ARB-ROUTE-INHERITS | An item with its own baseline rows is routed against them; the parent is not read. |
| AC-ARB-INHERITED-ROUTE | OBJ-ARB-ROUTE-INHERITS | A decomposed child with no baseline of its own is routed, admitted, recorded and reconciled against its parent's baseline chain and its own post-baseline evidence, and closes through readiness v3 instead of stopping at `baseline-not-found`, `baseline-conflict` or a permanently missing acceptance. |
| AC-ARB-NONE-STAYS-CLOSED | OBJ-ARB-ROUTE-INHERITS | An item with neither its own nor an inherited baseline still escalates `baseline-not-found`. |

Failing-to-passing proof: `baseline-source.test.ts` (4 cases) fails to compile
before step 1 and passes after; `terminal-recovery.test.ts` (16 cases) is green
before and after.

## 4. Rollback

One PR revert; no schema, no data.
