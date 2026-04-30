export const GAID_AUTHORIZATION_CLASS_ORDER = [
  "observe",
  "analyze",
  "create",
  "update",
  "approve",
  "execute",
  "delegate",
  "administer",
  "cross-boundary",
] as const;

export type GaidAuthorizationClass = (typeof GAID_AUTHORIZATION_CLASS_ORDER)[number];

const CROSS_BOUNDARY_GRANTS = new Set([
  "external_registry_search",
  "consumer_onboard",
  "consumer_write",
  "contract_write",
  "entitlement_provision",
  "iac_execute",
  "order_create",
  "order_write",
  "product_instance_write",
  "service_offer_write",
  "subscription_write",
]);

const ANALYZE_GRANTS = new Set([
  "backlog_triage",
  "deliberation_create",
  "deliberation_read",
  "dependency_audit",
  "gap_analysis_create",
  "gap_analysis_read",
  "regulatory_compliance_check",
  "risk_score_create",
  "scoring_model_read",
  "tool_evaluation_create",
  "tool_evaluation_read",
  "tool_evaluation_write",
  "trust_boundary_map",
  "vulnerability_scan",
]);

const APPROVE_GRANTS = new Set<string>([]);
const DELEGATE_GRANTS = new Set<string>([]);

function classifyGrant(grantKey: string): GaidAuthorizationClass[] {
  const classes = new Set<GaidAuthorizationClass>();
  const isAdminGrant = grantKey.startsWith("admin_") || grantKey === "agent_control_read";

  if (grantKey.endsWith("_read") || grantKey.includes("_read")) {
    classes.add("observe");
  }

  if (ANALYZE_GRANTS.has(grantKey)) {
    classes.add("analyze");
  }

  if (grantKey.endsWith("_create")) {
    classes.add("create");
  }

  if (grantKey.endsWith("_write") && !isAdminGrant) {
    classes.add("create");
    classes.add("update");
  }

  if (grantKey.includes("execute") || grantKey.startsWith("sandbox_") || grantKey === "build_promote") {
    classes.add("execute");
  }

  if (isAdminGrant) {
    classes.add("administer");
  }

  if (APPROVE_GRANTS.has(grantKey)) {
    classes.add("approve");
  }

  if (DELEGATE_GRANTS.has(grantKey)) {
    classes.add("delegate");
  }

  if (CROSS_BOUNDARY_GRANTS.has(grantKey)) {
    classes.add("cross-boundary");
  }

  return [...classes];
}

export function mapLocalPolicyToPortableClasses(grantKeys: string[]): GaidAuthorizationClass[] {
  const discovered = new Set<GaidAuthorizationClass>();

  for (const grantKey of grantKeys) {
    for (const authClass of classifyGrant(grantKey)) {
      discovered.add(authClass);
    }
  }

  return GAID_AUTHORIZATION_CLASS_ORDER.filter((authClass) => discovered.has(authClass));
}
