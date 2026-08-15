# Restaurant floor confirmation version repair

Backlog: BI-4D076907

## Live evidence

On canonical served bytes `0aa6437438a266c8a3926777d99984e91e566a18`, the host stand recommended Quinn Doyle (3) at Aster 1 (4). Three confirmations from freshly rendered choices failed closed as `Floor changed before confirmation`; reload preserved the waiting party and available table. Aster 1 had one live reservation allocation for the following day, outside the immediate seating interval.

## Contract

The optimistic seating token covers exactly the demand, resource, and live allocation facts the atomic command rechecks for the proposed interval. A non-overlapping earlier or later reservation remains visible to planning but cannot make an immediate command stale. An overlapping allocation must continue to reject without partial writes.

## Delivery plan

1. Reproduce the false conflict with a loader regression containing a later reservation.
2. Centralize the live-overlap filter used by seating evaluation and command-token projection.
3. Apply the same token boundary to seat and move options.
4. Run focused tests, typecheck, independent exact-tree review, governed pregate, protected merge, canonical upgrade, and the same seat-plus-reload acceptance.

No schema migration or new UI copy is required. The existing conflict notice and authored spatial layout remain unchanged.
