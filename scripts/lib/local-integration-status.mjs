// The closed set of terminal statuses a local-CI gate run may report.
//
// BI-C59AC8AF. This set had four copies: the producer (classifyGateOutcome in
// sandbox-freshness.mjs), the MCP tool schema enum, the handler's runtime
// validation array, and the recorder's TypeScript union. #4703 added
// `blocked_child_signal_death` to the producer alone, so a build child killed by
// a signal reported a status the recorder rejected with `invalid_status`. The
// write was dropped, the lease released terminal with a null evidenceRecordId,
// and — because the gate key hashes the integration TREE, not the commit — that
// tree could never be gated again. Re-committing the same content reproduces the
// same key and the same refusal.
//
// Lives in scripts/lib so both planes read one array: the .mjs gate scripts
// import it directly, and apps/web imports it the same way the platform-runtime
// modules already import capability-state-hash.mjs and transition-signing.mjs.
//
// A `blocked_*` status is INFRASTRUCTURE evidence, never a product verdict.
// Adding one here is half the change: give it a branch in classifyGateOutcome
// and the parity test in sandbox-freshness.test.mjs will hold the two together.
export const LOCAL_INTEGRATION_STATUSES = Object.freeze([
  "passed",
  "failed",
  "conflict",
  "blocked_sandbox_drift",
  "blocked_control_plane_starvation",
  "blocked_child_signal_death",
]);

/** True when `value` is a status the recorder will accept. */
export function isLocalIntegrationStatus(value) {
  return LOCAL_INTEGRATION_STATUSES.includes(value);
}

/**
 * The status to record when the portal rejects `status` as unknown.
 *
 * An older portal cannot know a status a newer gate emits, and the gate must
 * still leave evidence — an unrecorded run is what bricks the tree. `failed` is
 * the honest floor: it is never mistaken for a pass, and the prefixed summary
 * keeps the real class legible to a human reading the record.
 */
export function fallbackStatusForUnknown(status) {
  return {
    status: "failed",
    summaryPrefix: `[${String(status).toUpperCase()} — not product evidence]`,
  };
}
