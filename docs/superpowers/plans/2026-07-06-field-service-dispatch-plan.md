# EP-3516E23D — Field-service dispatch (BI-10E350A6)

**Spec:** [docs/superpowers/specs/2026-07-06-reusable-queueing-substrate-design.md](../specs/2026-07-06-reusable-queueing-substrate-design.md) §4.4
**BI:** BI-10E350A6 (EP-3516E23D). Depends on Phase 1 (telemetry spine, #2652) + CWQ activation (#2662).
**Goal:** The first archetype consumer of the queueing substrate — turn a confirmed,
provider-assigned StorefrontBooking into a tracked, measured field-service job on a
dispatch board, so a trades-maintenance operator ("Lead Manager") sees every job and
its stage, and the job's flow feeds the same telemetry/visibility as every other queue.

## What changed

- **`lib/work-management/source-registry.ts`** — new `field-service-job` WorkItem source
  type + its registry entry (owningArea storefront, domain field-dispatch, `accountResolverKey: null`
  so it stays out of the resolver-key set; account resolves via the originating booking).
- **`lib/queue/bridges/booking-bridge.ts`** — `bridgeBookingToWorkItem(bookingId)`:
  idempotent, no-ops for non-confirmed / unassigned bookings, upserts a stable per-storefront
  dispatch queue (`dispatch-<storefrontId>`), creates a `physical` WorkItem with
  `dueAt = scheduledAt`, and records `recordQueueTransition("enqueued")` into the shared telemetry.
- **`app/api/storefront/bookings/[id]/confirm/route.ts`** — after confirming, best-effort
  post-commit bridge call (never fails the confirmation).
- **`lib/storefront/dispatch-board-data.ts`** — the board read model: pure column grouping
  (`groupDispatchJobs`, `columnForStatus`) + `getDispatchBoard(storefrontId)` (best-effort, [] on failure).
- **`app/(shell)/storefront/dispatch/page.tsx`** — the dispatch board: jobs grouped into
  workflow columns; archetype-gated (trades-maintenance) with a gentle explainer otherwise.
- **`StorefrontAdminTabNav` + storefront layout** — conditional "Dispatch" tab, shown only
  when the storefront's archetype is trades-maintenance.

## Verification

- 22 new unit tests (source-registry, booking bridge idempotency + telemetry, board grouping +
  read); existing nav + section-nav ratchet + storefront suites green (102); `tsc --noEmit` clean;
  module-size OK.
- Live (post-merge+deploy): confirm a booking with an assigned provider on a trades-maintenance
  storefront → a job appears on `/storefront/dispatch`, a `QueueTelemetryEvent` (enqueued) lands,
  and after the rollup the dispatch queue surfaces in `get_queue_status`. Re-confirming does not
  duplicate the job.

## Not in this phase

Customer-facing "N ahead / expected start" signal; technician mobile "my jobs" view; drag-to-reassign
on the board; a per-crew (vs per-storefront) queue split (no crew model exists — providers are
individual today). Routing WorkItems to specific providers (the CWQ router, Phase 2).

## UX-Fit-Decision

Adds one archetype-gated route (`/storefront/dispatch`) and one conditional nav tab, shown ONLY to
trades-maintenance storefronts — every other archetype sees no new surface. It gives field-service
operators the one board they currently lack (confirmed jobs by stage), reusing the shared report-kit
StatusBadge and the existing storefront-admin tab strip. No new user input control; read-only board.
Net surface is scoped to the archetype that needs it and removes a real blind spot.
