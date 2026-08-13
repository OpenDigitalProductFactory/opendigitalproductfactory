# Restaurant host operational capacity repair

Backlog: BI-4D076907  
Capsule: WC-DB2D7D60

## Evidence and boundary

On canonical lineage `f0ba454875921ed909d11f7f6ab50440941137c4`, the host stand recommended Aster 1 for Quinn Doyle at 21:17 America/Chicago, then rejected the command because the estimated 90-minute service turn extended beyond the table's public booking schedule. Runtime evidence `cmsqw4h5i006p01s0c8ln572w` proves that the floor was unchanged and the table was physically unoccupied.

The shared capacity repository correctly enforces resource schedules for public holds and bookings. An authenticated host seating or moving an already-present party is a distinct operational action: it must still enforce table status, seat capacity, overlapping allocations, idempotency, and optimistic versions, but a service-turn estimate may extend beyond the last public bookable start.

## Implementation

1. Add an explicit, default-on resource-schedule enforcement option to the canonical capacity allocation boundary.
2. Set the option off only for authenticated host seating and table-move commands.
3. Preserve default enforcement for guest holds and booking submission.
4. Prove the live closing-interval regression in repository and command tests, then run the governed exact-tree delivery and repeat the authenticated seating/reload acceptance.

## Non-goals

- No schema or migration.
- No change to public operating hours or reservation availability.
- No weakening of occupancy, capacity, version, staffing, or transaction checks.
- No new UI control or copy.
