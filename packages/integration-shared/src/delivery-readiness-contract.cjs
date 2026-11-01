"use strict";
// Dependency-free CommonJS so dependency-free policy scripts (node --test without
// an installed workspace), the bootstrap package and the web program share one
// contract. Types live in delivery-readiness-contract.d.cts.

/** Required author-to-verification workflow; discovery never grants authority. */
const DELIVERY_WORKFLOW_TOOLS = Object.freeze([
  "wiki_query", "principle_decide", "get_backlog_item", "claim_backlog_item_for_work",
  "claim_workroom_scope", "record_plan_backlog_coverage", "record_initiative_evidence",
  "find_related_tests", "write_sandbox_file", "run_sandbox_command", "request_coworker",
  "list_nonprod_environment_leases", "claim_nonprod_environment_lease",
  "renew_nonprod_environment_lease", "release_nonprod_environment_lease",
  "issue_ux_verification_sign_in", "list_coworker_offers", "request_coworker_engagement",
  "record_workroom_evidence", "record_local_integration_result", "review_semantic_change",
  "retry_semantic_review",
]);

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
const object = value =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : undefined;

function deliveryReadinessFromDiscovery(value) {
  const envelope = object(value);
  const result = object(envelope?.result) ?? envelope;
  let payload = object(result?.structuredContent) ?? result;
  if (Array.isArray(result?.content)) {
    const text = result.content.map(object).find(row => row?.type === "text" && typeof row.text === "string")?.text;
    try { payload = object(JSON.parse(String(text))) ?? payload; } catch { /* malformed evidence grants nothing */ }
  }
  const rows = Array.isArray(payload?.status) ? payload.status.map(object) : [];
  const report = { ready: false, missingTokenTools: [], missingCoworkerTools: [], unavailableTools: [] };
  for (const name of DELIVERY_WORKFLOW_TOOLS) {
    const matches = rows.filter(row => row?.name === name);
    const row = matches[0];
    if (matches.length !== 1 || row?.serverHasTool !== true) { report.unavailableTools.push(name); continue; }
    if (row.tokenGranted === false) report.missingTokenTools.push(name);
    if (row.agentGranted === false) report.missingCoworkerTools.push(name);
    // The server emits exactly null when no coworker layer applies (legacy
    // human credential). It is not a grant: explicit server callability still
    // proves the effective token, role, clearance and applicable agent checks.
    if (typeof row.tokenGranted !== "boolean"
        || (row.agentGranted !== null && typeof row.agentGranted !== "boolean")
        || row.callableByName !== true) report.unavailableTools.push(name);
  }
  report.ready = !report.missingTokenTools.length && !report.missingCoworkerTools.length && !report.unavailableTools.length;
  return report;
}

exports.DELIVERY_WORKFLOW_TOOLS = DELIVERY_WORKFLOW_TOOLS;
exports.deliveryReadinessFromDiscovery = deliveryReadinessFromDiscovery;
