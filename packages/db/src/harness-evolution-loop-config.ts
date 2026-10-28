// The standing harness evolution loop (BI-49BC21C1; spec
// docs/superpowers/specs/2026-10-28-harness-evolution-loop-design.md).
//
// Detectors had filed ~1,370 improvement items with ~28 closed when this was
// filed: detection exists, closure does not. Improvement is owned by each
// Workroom; this task is the daily aggregator. It records each ring-0 room's
// recurring misses on that room as harness-edit candidates and rolls them up
// for promotion. It is a platform job, not a client cron (WWMD DI-E6FA02FCC221).
//
// Config lives here beside demand-scoring-steward-config.ts because the seed
// (packages/db) and the deterministic executor (apps/web) both need the kind,
// and neither may import the other.

export const HARNESS_EVOLUTION_LOOP_TASK_ID = "harness-evolution-loop-daily";

/** AI Ops Engineer: owns platform tool efficiency and its improvement signals. */
export const HARNESS_EVOLUTION_LOOP_AGENT_ID = "platform-engineer";

export const HARNESS_EVOLUTION_LOOP_TASK_TITLE = "Record each Workroom's recurring misses as harness-edit candidates (daily)";

export const HARNESS_EVOLUTION_LOOP_ROUTE_CONTEXT = "/platform/ai/skills";

/** Daily 04:17 UTC — after the overnight detectors, before the morning work. */
export const HARNESS_EVOLUTION_LOOP_SCHEDULE = "17 4 * * *";

export const HARNESS_EVOLUTION_LOOP_DEFAULT_TIMEZONE = "UTC";

export const HARNESS_EVOLUTION_LOOP_SCHEDULED_JOB_NAME = "Harness Evolution Loop Daily";

export const HARNESS_EVOLUTION_LOOP_TASK_KIND = "harness-evolution-loop";

/**
 * Seeded taskConfig, written on create only so an operator's tuning survives
 * re-seeding. The executor clamps every cap. `seedItemIds` is the ring-0 platform queue:
 * the plumbing failures mined from 86 Claude sessions on 2026-10-28 and filed
 * under EP-C00F61F4. An id an install does not hold is skipped and reported.
 */
export const HARNESS_EVOLUTION_LOOP_DEFAULT_CONFIG = {
  maxRooms: 50,
  maxCandidatesPerRoom: 3,
  maxCandidates: 50,
  maxProbeReplays: 20,
  tokenCap: 200_000,
  lookbackDays: 7,
  minRecurrence: 2,
  seedItemIds: [
    "BI-2C73B434",
    "BI-5DD46FDA",
    "BI-C8BEFC26",
    "BI-F17F2188",
    "BI-DF34D948",
    "BI-83D2BD01",
    "BI-0733742C",
    "BI-D66DE7A3",
    "BI-A8679D84",
  ],
} as const;

/**
 * Recorded for the operator reading the schedule, not sent to a model. The
 * orchestration is deterministic; the run never edits a harness file itself.
 */
export const HARNESS_EVOLUTION_LOOP_PROMPT =
  "For each active ring-0 delivery Workroom, record the room's own recurring misses (failed coworker "
  + "tool calls and miss-kind room activity, human interactions included) on the room as harness-edit "
  + "candidates with their trajectory evidence. Roll them up: name cross-room recurrences for promotion, "
  + "list shape-level flow signals and the ring-0 platform queue, and record the budget and spend. "
  + "Deterministic: no model judgement, and it never edits a harness file; adoption goes through a "
  + "probe in the room and governed change.";
