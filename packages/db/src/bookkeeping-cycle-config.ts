// packages/db/src/bookkeeping-cycle-config.ts
// The initial use of the Bookkeeping Work Room (BI-DC738330, S-TRIG). Seeding a
// standing weekly `bookkeeping-cycle` scheduled task is what turns the framework
// from available into running: on cadence it opens or advances the current
// period's cycle on the standing `bookkeeping-period` room. The deterministic
// handler lives in apps/web's scheduler (executeScheduledAgentTask branches on
// taskKind and runs executeBookkeepingCycleTask without an LLM loop).

export const BOOKKEEPING_CYCLE_TASK_ID = "bookkeeping-cycle-weekly";

// The Bookkeeper coworker (AGT-907) — the actor the opened cycle is attributed to.
export const BOOKKEEPING_CYCLE_AGENT_ID = "AGT-907";

export const BOOKKEEPING_CYCLE_TASK_TITLE = "Bookkeeping cycle (weekly)";
export const BOOKKEEPING_CYCLE_ROUTE_CONTEXT = "/finance/banking";

// Weekly, Monday 09:00 UTC. The cycle key is the ISO week, so the cadence and an
// on-arrival statement both resolve to one idempotent period.
export const BOOKKEEPING_CYCLE_SCHEDULE = "0 9 * * 1";
export const BOOKKEEPING_CYCLE_DEFAULT_TIMEZONE = "UTC";
export const BOOKKEEPING_CYCLE_SCHEDULED_JOB_NAME = "Bookkeeping Cycle Weekly";

// MUST equal BOOKKEEPING_CYCLE_TASK_KIND in
// apps/web/lib/operate/scheduled-jobs/agent-task-kind.ts — the scheduler
// discriminates on this literal. packages/db cannot import from apps/web, so the
// value is duplicated here behind this contract note.
export const BOOKKEEPING_CYCLE_TASK_KIND = "bookkeeping-cycle";

export const BOOKKEEPING_CYCLE_PROMPT =
  "Open or advance the current bookkeeping period on the standing books room: gather the period's " +
  "statements and receipts, import with provenance, categorize and match every transaction or surface " +
  "it as an exception, reconcile the balance, and prepare the Outcome Packet for owner review. Never " +
  "fabricate a transaction; the reconciled period is owner-gated on the real statement export.";
