/** Required author-to-verification workflow; discovery never grants authority. */
export const DELIVERY_WORKFLOW_TOOLS = [
  "wiki_query", "principle_decide", "get_backlog_item", "claim_backlog_item_for_work",
  "claim_workroom_scope", "record_plan_backlog_coverage", "record_initiative_evidence",
  "find_related_tests", "write_sandbox_file", "run_sandbox_command", "request_coworker",
  "list_nonprod_environment_leases", "claim_nonprod_environment_lease",
  "renew_nonprod_environment_lease", "release_nonprod_environment_lease",
  "issue_ux_verification_sign_in", "list_coworker_offers", "request_coworker_engagement",
  "record_workroom_evidence", "record_local_integration_result", "review_semantic_change",
  "retry_semantic_review",
] as const;

export type DeliveryReadinessReport = {
  ready: boolean;
  missingTokenTools: string[];
  missingCoworkerTools: string[];
  unavailableTools: string[];
};
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function deliveryReadinessFromDiscovery(value: unknown): DeliveryReadinessReport {
  const envelope = object(value);
  const result = object(envelope?.result) ?? envelope;
  let payload = object(result?.structuredContent) ?? result;
  if (Array.isArray(result?.content)) {
    const text = result.content.map(object).find(row => row?.type === "text" && typeof row.text === "string")?.text;
    try { payload = object(JSON.parse(String(text))) ?? payload; } catch { /* malformed evidence grants nothing */ }
  }
  const rows = Array.isArray(payload?.status) ? payload.status.map(object) : [];
  const report: DeliveryReadinessReport = { ready: false, missingTokenTools: [], missingCoworkerTools: [], unavailableTools: [] };
  for (const name of DELIVERY_WORKFLOW_TOOLS) {
    const matches = rows.filter(row => row?.name === name);
    const row = matches[0];
    if (matches.length !== 1 || row?.serverHasTool !== true) { report.unavailableTools.push(name); continue; }
    if (row.tokenGranted === false) report.missingTokenTools.push(name);
    if (row.agentGranted === false) report.missingCoworkerTools.push(name);
    if (typeof row.tokenGranted !== "boolean" || typeof row.agentGranted !== "boolean"
        || (row.tokenGranted && row.agentGranted && row.callableByName !== true)) report.unavailableTools.push(name);
  }
  report.ready = !report.missingTokenTools.length && !report.missingCoworkerTools.length && !report.unavailableTools.length;
  return report;
}
