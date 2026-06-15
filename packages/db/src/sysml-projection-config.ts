// packages/db/src/sysml-projection-config.ts
// Parity Engine: shared identity for the nightly SysML-projection reconcile.
// Imported by the seed (packages/db) and the scheduler branch (apps/web) so both
// agree on the task id. The deterministic handler lives in apps/web's scheduler
// (executeScheduledAgentTask early-branches on this task id and runs
// reconcileSysmlProjections without an LLM loop), mirroring the data-model mirror.

export const SYSML_PROJECTION_TASK_ID = "sysml-projection-nightly";
export const SYSML_PROJECTION_AGENT_ID = "AGT-WS-EA"; // Enterprise Architect
export const SYSML_PROJECTION_TASK_TITLE = "SysML Projection Reconcile (nightly)";
export const SYSML_PROJECTION_ROUTE_CONTEXT = "/ea";
export const SYSML_PROJECTION_SCHEDULE = "0 4 * * *"; // 04:00 UTC daily (after the data-model mirror at 03:00)
export const SYSML_PROJECTION_DEFAULT_TIMEZONE = "UTC";
export const SYSML_PROJECTION_SCHEDULED_JOB_NAME = "SysML Projection Nightly";
export const SYSML_PROJECTION_PROMPT =
  "Reconcile the auto-extracted SysML projections (MCP tool authority, AI coworker workforce) into the EA graph. " +
  "Deterministic — re-derives from the source registries and runs without an LLM loop.";
