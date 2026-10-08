// Approval convergence A2 inventory (BI-C8EC05C9; AC-INVENTORY).
//
// Runs against the live tool registry. A request converted from a proposal to
// an envelope must stay provable and correctly timed, so for every tool a
// proposal can reach — a proposal-mode tool, or a side-effecting non-artifact
// tool a propose boundary diverts (propose-interception.ts) — this pins:
//   - consequence → approval window (spec D7), with no per-call narrowing;
//   - which tools carry `writeOnly` (secret) inputs and so cannot be queued
//     under a propose boundary (waiver W5);
//   - that the audit row keeps the arguments the platform runner must prove
//     (auditClass is not metrics_only, or retainAuditParameters);
//   - the overlap with policy-projectable actions, which a propose boundary
//     neutralises by setting policyProjectionAllowed: false.
import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { shouldProposeToolCall } from "@/lib/proactivity/propose-interception";
import { INITIATIVE_READINESS_LANES } from "@/lib/tak/initiative-readiness-tool-grants";
import { classifyConsequentialTool } from "@/lib/tak/consequential-tool-policy";
import { deriveAuditClassForTool } from "@/lib/tool-audit-helpers";

import {
  APPROVAL_DECISION_WINDOW_MS,
  DURABLE_APPROVAL_LIFETIME_MS,
  approvalLifetimeMs,
} from "./approval-lifetime";

const PROPOSAL_MODE = PLATFORM_TOOLS.filter((tool) => tool.executionMode === "proposal");
const PROPOSAL_REACHABLE = PLATFORM_TOOLS.filter(
  (tool) => tool.executionMode === "proposal" || shouldProposeToolCall(tool, true),
);

function hasWriteOnlyInput(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const record = schema as Record<string, unknown>;
  if (record["writeOnly"] === true) return true;
  return Object.values(record).some((value) => hasWriteOnlyInput(value));
}

/** Spec D7: the declared consequence of each tool the live pending rows name, and its window. */
const D7_TABLE: Array<[string, "outward" | null, number]> = [
  ["run_hive_scout_ingest", "outward", APPROVAL_DECISION_WINDOW_MS],
  ["contribute_to_hive", "outward", APPROVAL_DECISION_WINDOW_MS],
  ["contribute_finding_to_hive", "outward", APPROVAL_DECISION_WINDOW_MS],
  ["run_discovery_triage", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["record_workroom_evidence", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["set_task_goal", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["surface_act", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["promote_to_build_studio", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["analyze_mcp_call_efficiency", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["propose_improvement", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["propose_skill_improvement", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["wiki_ingest", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["publish_wiki_overlay_pages", null, DURABLE_APPROVAL_LIFETIME_MS],
  ["start_deliberation", null, DURABLE_APPROVAL_LIFETIME_MS],
];

describe("approval convergence inventory — the live registry", () => {
  it("reaches a non-trivial set of tools, every proposal-mode tool among them", () => {
    expect(PROPOSAL_MODE.map((tool) => tool.name).sort()).toEqual([
      "contribute_finding_to_hive",
      "contribute_to_hive",
      "propose_improvement",
      "propose_skill_improvement",
      "publish_wiki_overlay_pages",
      "start_deliberation",
      "wiki_ingest",
    ]);
    expect(PROPOSAL_REACHABLE.length).toBeGreaterThan(PROPOSAL_MODE.length);
  });

  it.each(D7_TABLE)("D7: %s declares %s and waits %i ms", (name, consequence, windowMs) => {
    const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === name);
    expect(tool, `${name} is not registered`).toBeDefined();
    expect(PROPOSAL_REACHABLE).toContain(tool);
    expect(tool!.consequence ?? null).toBe(consequence);
    // No per-call narrowing: the declared consequence is the call's consequence.
    expect(tool!.consequenceForCall).toBeUndefined();
    expect(classifyConsequentialTool({ tool: tool!, toolName: name }).consequential).toBe(consequence !== null);
    expect(approvalLifetimeMs(tool!.consequence ?? null)).toBe(windowMs);
  });

  it("knows exactly which reachable tools take a secret (writeOnly) input", () => {
    expect(
      PROPOSAL_REACHABLE.filter((tool) => hasWriteOnlyInput(tool.inputSchema)).map((tool) => tool.name).sort(),
    ).toEqual(["configure_and_test_discovery_connection", "configure_gateway_scan"]);
  });

  it("keeps the arguments of every reachable tool on its audit row", () => {
    const unprovable = PROPOSAL_REACHABLE.filter(
      (tool) => deriveAuditClassForTool(tool.name) === "metrics_only" && tool.retainAuditParameters !== true,
    ).map((tool) => tool.name);
    expect(unprovable).toEqual([]);
  });

  it("no proposal-mode tool is policy-projectable", () => {
    const projectable = new Set(Object.keys(INITIATIVE_READINESS_LANES));
    expect(PROPOSAL_MODE.filter((tool) => projectable.has(tool.name))).toEqual([]);
  });

  it("names the projectable writers a propose boundary can reach (neutralised by policyProjectionAllowed: false)", () => {
    const projectable = new Set(Object.keys(INITIATIVE_READINESS_LANES));
    expect(PROPOSAL_REACHABLE.filter((tool) => projectable.has(tool.name)).map((tool) => tool.name).sort())
      .toEqual([...projectable].sort());
  });
});
