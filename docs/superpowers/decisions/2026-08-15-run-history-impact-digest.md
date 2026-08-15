# Run History — carry each upgrade's summary with the run that applied it

**Date:** 2026-08-15
**Surface:** `/ops/self-upgrade` → Run History (`apps/web/components/ops/SelfUpgradeClient.tsx`)
**Backlog:** BI-F7A591AF
**Kernel decision:** DI-E3CC179DC0C2, profile `mark-dpf-platform`
**UX-fit manifest:** `docs/ux-fit/2026-08-15-run-history-impact-digest.ux-fit.json`

## Problem

When something breaks after an upgrade, the operator's question is *which*
upgrade introduced it, and when. Run History could not answer it: each row was a
status badge, a run id, a 12-char SHA pair and a timestamp. Correlating a
symptom to a change meant reading `UpgradeImpactSummary` out of Postgres by
hand.

The record itself was never missing. It was unreachable:

- `UpgradeImpactSummary` persists the full computed summary (`schema.prisma`).
- `SelfUpgradeRun.impactSummaryId` pins the exact summary a run carried.
- `loadRunImpactDigest` already surfaces that digest — but only for the *latest*
  run's card.
- `change-record.ts` mirrors headline + counts into the ChangeRequest register.

So this is a surfacing change, not new substrate.

## Decision

Each history row carries its own digest (headline + counts ribbon) inline, and
expands on demand to the item list that run applied.

Three properties are load-bearing:

1. **Loaded by the run's OWN `impactSummaryId`** — never a (lineage, target)
   re-derivation, which drifts the moment upstream advances past that run's
   endpoints. A completed run must keep reporting the changes *it* applied. This
   is the same rule the Latest Run card follows.
2. **One batched read per page, projected in Postgres.** `getPersistedSummaryDigests`
   selects `summary->'counts'` and `summary->'phrased'->>'headline'` for the
   page's ids via a parameterised `ANY($1)` — not a query per row, and not the
   full `allItems` array of every summary on the page. Digests are fetched for
   the returned page only, never the pagination lookahead row.
3. **The item list is lazy and per-row.** Expanding one run fetches that run's
   summary through the ops-gated `getSelfUpgradeRunImpact` action, once, and
   holds it across collapse/expand.

The categorised row itself (`ImpactItemRow`) is now shared with the "What's in
this update?" panel rather than duplicated — the badge vocabulary is the
operator's read of "what kind of change is this?" and must not drift between the
upgrade you are deciding on and the upgrade you are diagnosing.

## Kernel consultation

`principle_decide` (DI-E3CC179DC0C2) scored digest-only vs digest + lazy
disclosure vs a full inline list for every row. Result: **digest +
lazy disclosure** — composite 10.560 vs 7.268 (digest-only) and 5.685 (full
inline), margin 3.292, high confidence, no commandment conflict. The full inline
list scored worst: it is the only option that scores badly on
`human_cognitive_load` while adding no answer the disclosure does not already
give.

## Failure modes handled

- A run that recorded no summary shows no digest — it does not borrow a
  neighbour's.
- A digest read failure leaves the rows as they were; the history table still
  renders.
- An expanded row whose summary row has since gone says so in words rather than
  rendering an empty list that reads as "no changes".

## Related

- [Upgrade impact change categories](2026-08-15-upgrade-impact-change-categories.md) — the badge taxonomy these rows render (BI-6EC1350E).
- [Latest Run card — human-readable upgrade scope](2026-07-15-self-upgrade-run-card-human-readable-scope.md) — the same digest, one surface earlier.
- [Self-upgrade change register design](../specs/2026-06-16-self-upgrade-change-register-design.md) — the ITIL shadow record that carries the same headline + counts.
