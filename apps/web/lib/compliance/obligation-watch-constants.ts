// Scheduling identity for the obligation assurance watch (TAK §8.11).
//
// Deliberately dependency-free, mirroring watchdog-constants.ts: the
// scheduled-jobs catalog and the admin surface must be able to name this job
// WITHOUT importing the Inngest function module and dragging the whole queue
// client into their graph.

export const OBLIGATION_WATCH_JOB_ID = "obligation-assurance-watch";
export const OBLIGATION_WATCH_JOB_NAME = "Obligation assurance watch";
export const OBLIGATION_WATCH_INNGEST_ID = "compliance/obligation-assurance-watch";
export const OBLIGATION_WATCH_RUN_NOW_INNGEST_ID =
  "compliance/obligation-assurance-watch-run-now";
export const OBLIGATION_WATCH_REQUESTED_EVENT =
  "compliance/obligation-assurance-watch.requested";

/**
 * Daily at 05:40 UTC.
 *
 * Daily, not weekly: the sweep is a bounded read of three small tables and the
 * finding key is stable per due date, so a re-run costs one query set and
 * creates nothing new. A weekly sweep means an obligation can go up to six days
 * overdue before anyone is told. 05:40 sits after the 04:00–05:00 nightly block
 * and before the working day, so the finding is waiting when the owner arrives.
 */
export const OBLIGATION_WATCH_CRON = "40 5 * * *";
export const OBLIGATION_WATCH_CADENCE = "Daily at 05:40";
