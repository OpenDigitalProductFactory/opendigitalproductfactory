// The standing weekly client-capability re-verification (BI-64795FD0).
//
// Client capabilities change roughly weekly. This task reads each client's
// declared official sources and the CLI versions the updater reports, and
// files at most one proposal item per client. It never edits the profile
// (packages/dpf-skill-pack/client-capabilities.json); that changes only by a
// reviewed PR with a live probe.
//
// Config lives here beside demand-scoring-steward-config.ts because the seed
// (packages/db) and the deterministic executor (apps/web) both need it, and
// neither may import the other. Same shape as DEMAND_SCORING_STEWARD_*.

export const CLIENT_CAPABILITY_REVERIFY_TASK_ID = "client-capability-reverify-weekly";

/** Enterprise Architect: owns the client capability parity tracker. */
export const CLIENT_CAPABILITY_REVERIFY_AGENT_ID = "AGT-WS-EA";

export const CLIENT_CAPABILITY_REVERIFY_TASK_TITLE = "Re-verify agent client capabilities (weekly)";

export const CLIENT_CAPABILITY_REVERIFY_ROUTE_CONTEXT = "/ops/self-upgrade";

/** Tuesday 04:17 UTC, after the weekend's client releases have settled. */
export const CLIENT_CAPABILITY_REVERIFY_SCHEDULE = "17 4 * * 2";

export const CLIENT_CAPABILITY_REVERIFY_DEFAULT_TIMEZONE = "UTC";

export const CLIENT_CAPABILITY_REVERIFY_SCHEDULED_JOB_NAME = "Client Capability Re-verification Weekly";

export const CLIENT_CAPABILITY_REVERIFY_TASK_KIND = "client-capability-reverify";

/**
 * Recorded for the operator reading the schedule, not sent to a model. The
 * executor is deterministic: it fetches declared pages and compares snapshots.
 */
export const CLIENT_CAPABILITY_REVERIFY_PROMPT =
  "Read each client's declared official release notes and docs (sources[] in "
  + "packages/dpf-skill-pack/client-capabilities.json) and the CLI versions the updater reports. "
  + "File or update at most one backlog item per client, keyed client-capability:<client>@<version>, "
  + "quoting each changed passage, the field it affects and the proposed check. "
  + "Never edits the profile, the credential policy or any client configuration. "
  + "A failing source marks the client verificationStale; two failed runs in a row raise one notification. "
  + "Deterministic: no model judgement.";
