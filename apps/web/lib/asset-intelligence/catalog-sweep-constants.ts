/**
 * Catalog enrichment sweep schedule constants (EP-ASSET-INTELLIGENCE, spec §4.2/§4.4).
 * Kept separate from the Inngest function so the scheduled-jobs catalog and its
 * parity test can import the ids without pulling in the queue runtime.
 */
export const CATALOG_SWEEP_JOB_ID = "catalog-enrichment-sweep";
export const CATALOG_SWEEP_JOB_NAME = "Catalog enrichment sweep";
export const CATALOG_SWEEP_SCHEDULED_INNGEST_ID = "ops/catalog-enrichment-sweep-scheduled";
export const CATALOG_SWEEP_REQUESTED_INNGEST_ID = "ops/catalog-enrichment-sweep-requested";
export const CATALOG_SWEEP_REQUESTED_EVENT = "ops/catalog-enrichment-sweep.requested";
/**
 * Weekly on Monday at 04:37 UTC. Weekly matches the feed cadence (spec §4.2:
 * "weekly cadence + manual request") — endoflife/CPE data changes slowly. The
 * odd 04:37 minute keeps it off the shared 04:00/05:00 ticks (scheduling-map
 * contention guard: no cron shared by 3+ jobs). Keep this literal in sync with
 * the catalog entry in scheduled-jobs/catalog.ts.
 */
export const CATALOG_SWEEP_CRON = "37 4 * * 1";
export const CATALOG_SWEEP_CADENCE = "Weekly on Monday at 04:37 UTC";
/** Per-poll batch bound — Vercel-friendly; repeated polls rotate through the spine. */
export const CATALOG_SWEEP_BATCH_LIMIT = 100;
