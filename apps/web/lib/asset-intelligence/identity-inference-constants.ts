/**
 * AI identity-resolution fallback schedule constants (EP-ASSET-INTELLIGENCE, spec §4.2/§8).
 * Kept separate from the Inngest function so the scheduled-jobs catalog and its parity
 * test can import the ids without pulling in the queue runtime.
 */
export const IDENTITY_INFERENCE_JOB_ID = "identity-inference-fallback";
export const IDENTITY_INFERENCE_JOB_NAME = "AI identity-resolution fallback";
export const IDENTITY_INFERENCE_SCHEDULED_INNGEST_ID = "ops/identity-inference-fallback-scheduled";
export const IDENTITY_INFERENCE_REQUESTED_INNGEST_ID = "ops/identity-inference-fallback-requested";
export const IDENTITY_INFERENCE_REQUESTED_EVENT = "ops/identity-inference-fallback.requested";
/**
 * Weekly on Tuesday at 04:43 UTC — a day after the catalog-enrichment sweep (Mon 04:37)
 * so freshly-enriched CatalogIdentities exist before the AI resolves the tail. The odd
 * 04:43 minute keeps it off the shared 04:00/05:00 ticks (scheduling-map contention
 * guard: no cron shared by 3+ jobs). Keep this literal in sync with the catalog entry
 * in scheduled-jobs/catalog.ts.
 */
export const IDENTITY_INFERENCE_CRON = "43 4 * * 2";
export const IDENTITY_INFERENCE_CADENCE = "Weekly on Tuesday at 04:43 UTC";
/** Per-poll scan bound — Vercel-friendly; repeated polls rotate through the tail. */
export const IDENTITY_INFERENCE_SCAN_LIMIT = 200;
/** Entities per model call — the batch half of the cost guardrail (spec §4.2). */
export const IDENTITY_INFERENCE_BATCH_SIZE = 20;
/**
 * Per-run inference-token budget cap — the budget half of the cost guardrail. Bounds a
 * single pass so a 10k+-entity estate cannot blow the AI budget in one sweep; the
 * remainder is picked up on the next poll (stalest-first rotation).
 */
export const IDENTITY_INFERENCE_TOKEN_BUDGET = 200_000;
/** Hard backstop on model calls per run, independent of tokens. */
export const IDENTITY_INFERENCE_MAX_CALLS = 25;
