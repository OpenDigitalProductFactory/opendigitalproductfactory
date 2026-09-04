export const HIVE_SCOUT_AGENT_ID = "external-catalog-scout";
export const HIVE_SCOUT_TASK_ID = "external-catalog-scout-weekly";
export const HIVE_SCOUT_TASK_TITLE = "External Catalog Scout";
export const HIVE_SCOUT_ROUTE_CONTEXT = "/platform/ai/operations";
export const HIVE_SCOUT_SCHEDULE = "17 8 * * *";
export const HIVE_SCOUT_DEFAULT_TIMEZONE = "UTC";
export const HIVE_SCOUT_SCHEDULED_JOB_NAME = `Agent: ${HIVE_SCOUT_TASK_TITLE}`;

export function buildHiveScoutScheduledPrompt(): string {
  return [
    "Run the daily external catalog scout pass for autonomous coworker archetype discovery.",
    "Invoke run_hive_scout_ingest once before writing any summary.",
    "If the call fails, do not call run_hive_scout_ingest again with the same arguments. Report the failure and the single next action instead.",
    "Report how many external catalog entries were parsed, how many gaps were detected, how many backlog suggestions were created, how many duplicates were skipped, and how many items were deferred for human review.",
    "Call out the highest-value follow-up when the run finds ambiguous patterns or new coworker opportunities.",
    "Then review the marketSources material in the same tool result: fetched excerpts from the approved product/market source list, each backed by a citable source URL (BI-B8E4317D).",
    "For each source whose material changed, ask one question: what does this product or release make effortless that our platform's model would not catch?",
    "File at most two governed backlog suggestions per run via create_backlog_item; each must cite its source URL and frame a concrete challenge to an existing DPF spec or surface — a release digest or news summary is not a finding.",
    "Where a finding amends doctrine, reference the governing spec path under docs/superpowers/specs/ in the suggestion body.",
    "Suggestions land in triage; never auto-promote them. If nothing clears the bar, state that explicitly rather than forcing a finding.",
    "Report how many market sources were fetched, how many changed, and how many failed.",
    "Do not vendor code, import repositories, or auto-create coworkers, and never copy code or content from a scanned source into the platform.",
  ].join(" ");
}
