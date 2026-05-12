export const HIVE_SCOUT_AGENT_ID = "external-catalog-scout";
export const HIVE_SCOUT_TASK_ID = "external-catalog-scout-weekly";
export const HIVE_SCOUT_TASK_TITLE = "External Catalog Scout";
export const HIVE_SCOUT_ROUTE_CONTEXT = "/platform/ai/operations";
export const HIVE_SCOUT_SCHEDULE = "17 8 * * 1";
export const HIVE_SCOUT_DEFAULT_TIMEZONE = "UTC";
export const HIVE_SCOUT_SCHEDULED_JOB_NAME = `Agent: ${HIVE_SCOUT_TASK_TITLE}`;

export function buildHiveScoutScheduledPrompt(): string {
  return [
    "Run the weekly external catalog scout pass for autonomous coworker archetype discovery.",
    "Invoke run_hive_scout_ingest once before writing any summary.",
    "Report how many external catalog entries were parsed, how many gaps were detected, how many backlog suggestions were created, how many duplicates were skipped, and how many items were deferred for human review.",
    "Call out the highest-value follow-up when the run finds ambiguous patterns or new coworker opportunities.",
    "Do not vendor code, import repositories, or auto-create coworkers.",
  ].join(" ");
}
