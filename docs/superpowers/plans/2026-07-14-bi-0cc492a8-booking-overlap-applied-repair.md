# BI-0CC492A8 — booking-overlap applied-state repair plan

Backlog item: `BI-0CC492A8`  
Epic: `EP-056D2A5E` — Resource contention & concurrency safety  
Date: 2026-07-14

## Current evidence

- The original hazard described in the BI was partially remediated by PR #2568 (`00040ea02`): `packages/db/prisma/migrations/20260702150000_booking_overlap_exclusion/migration.sql` now includes `overlapQuarantinedAt` columns, quarantine loops, and quarantine-aware EXCLUDE predicates.
- The canonical local install has already applied migration `20260702150000_booking_overlap_exclusion` with checksum `bb142273c65ba88bc96d89975df5e4919e48870b6cc1e58298e3184bdaae4e44`, and live DB introspection shows the old state:
  - no `overlapQuarantinedAt` columns on `StorefrontBooking` / `RentalAgreement`;
  - both EXCLUDE constraints exist, but their predicates do not exclude quarantined rows.
- `schema.prisma` now declares `overlapQuarantinedAt` on both models, so already-applied-old installs can remain schema-drifted even though source is safe for not-yet-applied installs.

## Scope

Add a forward-only repair migration for installs that already applied the old migration content before PR #2568 landed. The migration must also be safe on installs that apply the already-corrected original migration first.

## Phases

1. **Migration**
   - Add a new timestamped Prisma migration after the current latest migration.
   - `ADD COLUMN IF NOT EXISTS` for both quarantine columns.
   - Run the same idempotent quarantine loops before constraints are recreated, so any overlaps present in a drifted/manual state are parked rather than destroyed.
   - Drop and recreate `StorefrontBooking_no_overlap` and `RentalAgreement_no_overlap` with quarantine-aware predicates.
   - Keep the migration forward-only and data-preserving.

2. **Verification harness**
   - Extend `packages/db/test/booking-overlap-migration.verify.sql` or add a focused repair harness proving:
     - old-applied state (constraints exist, quarantine columns absent) is repaired;
     - clean/fixed state is idempotent;
     - overlapping active rows are quarantined before constraints are recreated;
     - a fresh overlapping insert still fails with SQLSTATE `23P01`.

3. **Local source checks**
   - Run the repair harness against throwaway Postgres if available.
   - Run migration safety guard / relevant DB tests.
   - Run `git diff --check`.

4. **Canonical verification**
   - Run the shared local-CI gate before push/merge.
   - Capture evidence on `BI-0CC492A8`.

## Rollback

This is a schema migration, so rollback is forward-only: ship a subsequent migration if an issue is found. The intended change is additive plus constraint replacement; no booking/agreement rows are deleted or status-mutated.
