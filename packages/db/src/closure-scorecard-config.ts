// The standing closure scorecard (BI-97C56E20, epic EP-C00F61F4).
//
// Owner, 2026-11-25: "What happened to the work we incorporated to improve the
// efficiency of every run? ... what is our measure and investment there? It
// seems little happens on its own." On that day the platform had filed 456
// improvement signals and closed none, verified 1 of 1,386 improvement
// proposals, and completed 1 of 534 Build Studio builds. Detection and filing
// existed; nothing measured whether work closed.
//
// This task is that measure. Each day it records the trailing week's
// started-vs-finished counts for every place platform work can stall, beside
// the same counts a week earlier. It is deterministic SQL and pure arithmetic:
// no model turn, no writes outside its own TaskRun.
//
// Config lives here beside harness-evolution-loop-config.ts because the seed
// (packages/db) and the deterministic executor (apps/web) both need it, and
// neither may import the other.

export const CLOSURE_SCORECARD_TASK_ID = "closure-scorecard-daily";

/** AI Ops Engineer: owns platform efficiency and its improvement signals. */
export const CLOSURE_SCORECARD_AGENT_ID = "platform-engineer";

export const CLOSURE_SCORECARD_TASK_TITLE = "Closure scorecard: is platform work finishing? (daily, trailing week)";

export const CLOSURE_SCORECARD_ROUTE_CONTEXT = "/platform/ai/skills";

/** Daily 06:29 UTC — after the acceptance sweep (05:00) and harness loop (04:17). */
export const CLOSURE_SCORECARD_SCHEDULE = "29 6 * * *";

export const CLOSURE_SCORECARD_DEFAULT_TIMEZONE = "UTC";

export const CLOSURE_SCORECARD_SCHEDULED_JOB_NAME = "Closure Scorecard Daily";

export const CLOSURE_SCORECARD_TASK_KIND = "closure-scorecard";

/**
 * Recorded for the operator reading the schedule, not sent to a model. The
 * executor is deterministic SQL and pure measures; there is no LLM in the run.
 */
export const CLOSURE_SCORECARD_PROMPT =
  "Measure whether platform work is finishing over the trailing 7 days, against the 7 days before: "
  + "Build Studio builds started vs completed or merged vs abandoned and stranded; improvement signals "
  + "and proposals filed vs closed; owner-attention reports routed to an agent vs reaching the owner "
  + "vs held; decisions with and without a recommendation; awaiting-acceptance items owned here vs "
  + "owned by a peer install, with age; queue arrivals vs completions; and self-filed backlog items "
  + "filed vs done. Deterministic: no model judgement and no writes beyond its own run record.";
