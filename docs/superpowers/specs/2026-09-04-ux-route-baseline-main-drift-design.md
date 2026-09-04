---
status: active
---

# UX route-baseline main-drift repair design

| Field | Value |
| --- | --- |
| Backlog item | `BI-91DF9A6B` |
| Workroom | `WC-D77C0C55` |
| Delivery shape | Atomic fix |
| Protected source ref | `3345e08acbfee8cb03df8e339b376ac9e6e5d3e2` |

## Problem and reproduced evidence

The committed route-budget row for `/finance/settings/tax` still records 684
default-visible words. Protected PR #5038 changes only the async-operation spec
and plan, yet CI run `33840976282` measured 688 words and blocked. Its other
numeric axes and normalized accessibility structure are byte-for-byte stable.

This is not attributable to the docs PR:

- protected run `33839851944` for the introducing current-main change measured
  the route at 686 words;
- current-main merge-group run `33840885799` also measured 686;
- PR #5038 then measured 688, the documented two-word measurement envelope;
- #4724 added the persistent one-word `Withheld` and `Employer` labels without
  updating the 684-word row; and
- `/inventory` did not reproduce its first-pass refusal, so its row is not
  evidence for this repair and must remain untouched.

The prevention gap is static. `scripts/check-ux-fit-decision.mjs` recognizes a
new route and added controls, but not added JSX copy or rendered `label:` values.
The existing exact manifest-to-baseline comparison would have refused 686 > 684
if the introducing copy change had been classified as UX-impacting.

## Objectives

**OBJ-1:** Restore `/finance/settings/tax` to a reviewed, reproducible baseline
whose value comes from two independent measurements of one exact protected SHA.

**OBJ-2:** Treat added user-visible TSX copy as UX-impacting so the introducing PR
must carry measured evidence, while imports, paths, identifiers, and styling-only
changes remain outside the gate.

**OBJ-3:** Preserve the existing route inventory, two-word empirical noise floor,
same-run confirmation, merge-group sweep, and protected merge authority.

## Design

The runtime ratchet remains unchanged. The repair extends only the static impact
classifier by reusing its user-copy extraction seam. Direct JSX text and values
of rendered copy properties (`label`, `title`, `description`, `placeholder`,
accessible labels, and their close equivalents) classify a changed non-test TSX
file as UX-impacting. Module paths and presentation/configuration attributes do
not.

The baseline repair is evidence-derived: dispatch two independent
`update_baseline=true` sweeps on the same pre-change SHA, merge them using the
canonical reproducibility tool, and splice only reproducible affected rows. A
non-reproducing route is never frozen from one observation.

## Ordered fix sequence

1. Preserve the exact protected reports and reproduce the missing visible-copy
   classification with failing unit tests.
2. Extend the classifier at the existing copy-extraction seam and make the new
   and adjacent regression tests pass.
3. Obtain two independent same-SHA baseline artifacts and combine them using
   `apps/web/scripts/merge-ux-route-baselines.ts`.
4. Splice only the reproducible `/finance/settings/tax` row; do not change
   `/inventory` or the route inventory.
5. Run the focused classifier and ratchet suites, source guards, DCO, then every
   protected PR and merge-group check. If local capacity is unavailable, record
   that gate as inconclusive without inferring PASS; protected CI remains
   mandatory.

This is one atomic repair. The classifier without the evidence-derived row still
leaves unrelated PRs blocked; the row without the classifier repeats the defect.

## Acceptance criteria

| Acceptance | Objective | Proof |
| --- | --- | --- |
| AC-1 | OBJ-1 | Two same-SHA freezes are reproducible and their conservative merge supplies the committed tax row. |
| AC-2 | OBJ-1, OBJ-3 | `/inventory` and the route inventory are unchanged. |
| AC-3 | OBJ-2 | Added JSX text and rendered `label:` values are classified as UX-impacting. |
| AC-4 | OBJ-2 | Imports and styling-only additions remain non-impacting. |
| AC-5 | OBJ-2 | A measured 686-word manifest against the stale 684-word row is refused before merge. |
| AC-6 | OBJ-3 | Ratchet noise, confirmation, and workflow semantics are unchanged. |
| AC-7 | OBJ-1, OBJ-2, OBJ-3 | A fresh docs-only PR and the protected merge group complete with the UX route-budget check green. |

## Risks and rollback

- A broad string heuristic could make harmless refactors demand UX evidence.
  Bounded rendered-property matching and negative fixtures prevent that.
- A one-run baseline could encode fixture noise. Two independent freezes and the
  canonical merge tool prevent that.
- Rollback is the single fix commit. Reverting it restores both the prior
  classifier and prior baseline together; no database or runtime migration is
  involved.
