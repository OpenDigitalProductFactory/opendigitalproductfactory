export const DISCOVERY_TRIAGE_AGENT_ID = "inventory-specialist";
export const DISCOVERY_TRIAGE_TASK_ID = "discovery-taxonomy-gap-triage-daily";
export const DISCOVERY_TRIAGE_TASK_TITLE = "Discovery Taxonomy Gap Triage";
export const DISCOVERY_TRIAGE_ROUTE_CONTEXT = "/platform/tools/discovery";
export const DISCOVERY_TRIAGE_SCHEDULE = "0 8 * * *";
export const DISCOVERY_TRIAGE_DEFAULT_TIMEZONE = "UTC";
export const DISCOVERY_TRIAGE_SCHEDULED_JOB_NAME = `Agent: ${DISCOVERY_TRIAGE_TASK_TITLE}`;

export function buildDiscoveryTriageScheduledPrompt(): string {
  return [
    "Run the daily discovery taxonomy gap triage pass for the digital product estate.",
    "Invoke run_discovery_triage once with trigger cadence before writing any summary.",
    "Report executed versus skipped status, processed count, decisions created, auto-attributed count, human-review count, taxonomy-gap count, needs-more-evidence count, escalation queue depth, and repeat-unresolved count.",
    "Call out the single highest-priority follow-up for humans when the run shows ambiguity, missing evidence, or taxonomy gaps.",
    "Do not invent taxonomy nodes, device identities, or backlog items.",
  ].join(" ");
}
