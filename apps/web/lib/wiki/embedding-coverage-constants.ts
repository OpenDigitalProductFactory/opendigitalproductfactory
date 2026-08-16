// Scheduling identity for the embedding-coverage self-heal (BI-ED117C82).
//
// Deliberately dependency-free, mirroring watchdog-constants.ts: the
// scheduled-jobs catalog and the admin surface must be able to name this job
// WITHOUT importing the Inngest client or the reconcile itself.

export const EMBEDDING_COVERAGE_JOB_ID = "embedding-coverage-reconcile";
export const EMBEDDING_COVERAGE_JOB_NAME = "Embedding coverage self-heal";
export const EMBEDDING_COVERAGE_INNGEST_ID = "ops/embedding-coverage-reconcile";
export const EMBEDDING_COVERAGE_RUN_NOW_INNGEST_ID =
  "ops/embedding-coverage-reconcile-run-now";
export const EMBEDDING_COVERAGE_REQUESTED_EVENT =
  "ops/embedding-coverage-reconcile.requested";

/**
 * Every two hours at :40.
 *
 * A boot hook was the previous mechanism and could only retry at restart — and
 * it attempted repair at the one moment least likely to succeed, because local
 * inference is routinely deferred by local-CI capacity reservations while other
 * startup work competes. A published stance that misses its vector degrades
 * stance relevance to lexical, which the BI-7E1F128A fail-safe then escalates
 * on, so the operator experiences a silent embedding gap as "the AI keeps asking
 * me things it already knows".
 *
 * Two-hourly means a gap closes on its own within a working session without a
 * restart, a button, or anyone knowing embeddings exist. The run is cheap when
 * there is nothing to do — one page scan plus one vector scan, no model calls.
 * :40 keeps it clear of the on-the-hour and half-hour ticks the other crons use.
 */
export const EMBEDDING_COVERAGE_CRON = "40 */2 * * *";
export const EMBEDDING_COVERAGE_CADENCE = "Every 2 hours at :40";

/** Durable Workroom collecting this outcome's activity, so a run is visible. */
export const CORPUS_HEALTH_WORKROOM_ID = "workroom-corpus-health";
export const CORPUS_HEALTH_WORKROOM_TITLE = "Corpus health";
export const CORPUS_HEALTH_WORKROOM_OBJECTIVE =
  "Keep the organisation's recorded doctrine retrievable by the decision engine — every published page carries a current vector, so coworkers decide from what the business actually wrote down.";

/** WorkroomActivity.kind for one coverage run. */
export const EMBEDDING_COVERAGE_ACTIVITY_KIND = "embedding-coverage";
