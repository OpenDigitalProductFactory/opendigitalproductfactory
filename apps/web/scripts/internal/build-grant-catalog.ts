/**
 * Bootstrap script — builds packages/db/data/grant_catalog.json from the
 * current registry + agent-grants.ts. Run once when wiring the tool-grant
 * audit; thereafter the catalog is hand-edited like any data file.
 *
 * Usage:
 *   pnpm --filter web exec tsx scripts/internal/build-grant-catalog.ts \
 *     > ../../packages/db/data/grant_catalog.json
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}
const ROOT = repoRoot();

const reg = JSON.parse(readFileSync(join(ROOT, "packages/db/data/agent_registry.json"), "utf8")) as {
  agents: Array<{ config_profile?: { tool_grants?: string[] } }>;
};

const grantsSrc = readFileSync(join(ROOT, "apps/web/lib/tak/agent-grants.ts"), "utf8");

const regGrants = new Set<string>();
for (const a of reg.agents) for (const g of a.config_profile?.tool_grants ?? []) regGrants.add(g);

const block = grantsSrc.match(/TOOL_TO_GRANTS:[^=]*= \{([\s\S]*?)\n\};/);
const grantToTools: Record<string, string[]> = {};
if (block) {
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*([a-zA-Z0-9_]+):\s*\[([^\]]*)\]/);
    if (!m) continue;
    const tool = m[1];
    const gs = m[2].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    for (const g of gs) {
      (grantToTools[g] ??= []).push(tool);
    }
  }
}

const PREFIX_TO_CATEGORY: Array<[string, string]> = [
  ["backlog_", "backlog"],
  ["portfolio_", "portfolio"],
  ["policy_", "governance"],
  ["strategy_", "governance"],
  ["budget_", "governance"],
  ["decision_record_", "governance"],
  ["adr_", "governance"],
  ["evidence_", "governance"],
  ["audit_report_", "governance"],
  ["violation_report_", "governance"],
  ["guardrail_", "governance"],
  ["conway_", "governance"],
  ["data_governance_", "governance"],
  ["regulatory_", "governance"],
  ["constraint_", "governance"],
  ["credential_scan", "governance"],
  ["license_check", "governance"],
  ["supply_chain_", "governance"],
  ["vulnerability_", "governance"],
  ["trust_boundary_", "governance"],
  ["dependency_", "governance"],
  ["agent_control_", "governance"],
  ["role_registry_", "governance"],
  ["scoring_model_", "governance"],
  ["spec_plan_", "governance"],
  ["risk_score_", "governance"],
  ["investment_proposal_", "evaluate"],
  ["scope_agreement_", "evaluate"],
  ["rationalization_report_", "evaluate"],
  ["gap_analysis_", "evaluate"],
  ["criteria_", "evaluate"],
  ["roadmap_", "explore"],
  ["architecture_", "explore"],
  ["ea_graph_", "explore"],
  ["contract_", "explore"],
  ["build_plan_", "integrate"],
  ["build_promote", "integrate"],
  ["integration_test_", "integrate"],
  ["sbom_", "integrate"],
  ["acceptance_package_", "integrate"],
  ["release_gate_", "integrate"],
  ["release_plan_", "integrate"],
  ["rollback_plan_", "integrate"],
  ["runbook_", "integrate"],
  ["iac_", "deploy"],
  ["deployment_plan_", "deploy"],
  ["resource_reservation_", "deploy"],
  ["service_offer_", "release"],
  ["catalog_publish", "release"],
  ["change_event_", "release"],
  ["consumer_", "consume"],
  ["order_", "consume"],
  ["subscription_", "consume"],
  ["entitlement_", "consume"],
  ["product_instance_", "consume"],
  ["chargeback_", "consume"],
  ["financial_", "consume"],
  ["incident_", "operate"],
  ["telemetry_", "operate"],
  ["sla_compliance_", "operate"],
  ["escalation_", "operate"],
  ["retention_record_", "operate"],
  ["schedule_", "operate"],
  ["pbi_status_", "operate"],
  ["prod_status_", "operate"],
  ["clip_route", "operate"],
  ["finding_", "detect"],
  ["tool_evaluation_", "platform"],
  ["tool_verdict_", "platform"],
  ["evidence_chain_", "platform"],
  ["file_read", "platform"],
  ["external_registry_search", "platform"],
  ["registry_read", "registry"],
];

function categorize(key: string): string {
  for (const [p, c] of PREFIX_TO_CATEGORY) {
    if (key === p || key.startsWith(p)) return c;
  }
  return "uncategorized";
}

function describe(key: string): string {
  const parts = key.split("_");
  const verb = parts[parts.length - 1];
  const noun = parts.slice(0, -1).join(" ");
  const verbMap: Record<string, string> = {
    read: "Read",
    write: "Create or update",
    create: "Create",
    execute: "Execute",
    validate: "Validate",
    publish: "Publish",
    triage: "Triage",
    map: "Map",
    emit: "Emit",
    check: "Check",
    scan: "Scan",
    verify: "Verify",
    search: "Search",
    provision: "Provision",
    trigger: "Trigger",
    onboard: "Onboard",
    promote: "Promote",
  };
  if (verbMap[verb] && noun) return `${verbMap[verb]} ${noun}.`;
  return key.replace(/_/g, " ") + ".";
}

const sortedKeys = [...regGrants].sort();
const out = {
  version: "1.0.0",
  generated_at: "2026-04-28",
  notes:
    "Catalog of grant keys referenced by packages/db/data/agent_registry.json. honored_by_tools is empty when no tool in apps/web/lib/mcp-tools.ts (via apps/web/lib/tak/agent-grants.ts TOOL_TO_GRANTS) checks the grant — those are aspirational grants that do not yet authorize any platform action. The tool-grant audit's GRANT-002 surfaces them as findings; backfill PRs either implement the tool or remove the grant from the registry. Descriptions are heuristic placeholders generated from the grant key — refine by hand during reconciliation.",
  grants: sortedKeys.map((key) => ({
    key,
    description: describe(key),
    category: categorize(key),
    sensitivity: "internal" as const,
    honored_by_tools: grantToTools[key] ? [...grantToTools[key]].sort() : [],
    implies: [],
  })),
};

console.log(JSON.stringify(out, null, 2));
