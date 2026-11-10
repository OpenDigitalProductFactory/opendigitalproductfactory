// BI-378D3659: the capability report and the runtime must answer "can this
// coworker reach this tool?" the same way. The runtime treats a tool's required
// grants as ALTERNATIVES after GRANT_IMPLICATIONS expansion (isToolAllowedByGrants);
// the report (scripts/measure-capability-completeness.mjs) demanded every grant,
// so it under-reported reachability. The script cannot import TypeScript, so it
// mirrors the rule — and this test runs the same fixtures through both.

import { describe, expect, it } from "vitest";

import agentRegistryData from "../../../../packages/db/data/agent_registry.json";
import {
  canCall,
  expandGrants as scriptExpandGrants,
  grantsSatisfy as scriptGrantsSatisfy,
} from "../../../../scripts/measure-capability-completeness.mjs";
import {
  GRANT_IMPLICATIONS,
  TOOL_TO_GRANTS,
  expandGrants,
  grantsSatisfyRequirement,
  isToolAllowedByGrants,
} from "./agent-grants";

const IMPLICATIONS = new Map(Object.entries(GRANT_IMPLICATIONS).map(([k, v]) => [k, [...v]]));
const TOOLS = new Map(Object.entries(TOOL_TO_GRANTS));

function scriptReachable(required: string[], held: string[]): boolean {
  return scriptGrantsSatisfy(required, scriptExpandGrants(held, IMPLICATIONS));
}

const FIXTURES: Array<{ name: string; required: string[]; held: string[]; reachable: boolean }> = [
  { name: "holds the first alternative", required: ["web_search", "registry_read"], held: ["web_search"], reachable: true },
  { name: "holds the second alternative", required: ["web_search", "registry_read"], held: ["registry_read"], reachable: true },
  { name: "holds both alternatives", required: ["web_search", "registry_read"], held: ["web_search", "registry_read"], reachable: true },
  { name: "holds neither alternative", required: ["web_search", "registry_read"], held: ["file_read"], reachable: false },
  { name: "holds the grant only by implication", required: ["build_evidence"], held: ["backlog_write"], reachable: true },
  { name: "implication is one-way", required: ["backlog_write"], held: ["build_evidence"], reachable: false },
  { name: "an empty requirement is universal", required: [], held: [], reachable: true },
  { name: "holds nothing", required: ["registry_read"], held: [], reachable: false },
];

describe("grant reachability: script mirrors the runtime predicate", () => {
  it.each(FIXTURES)("$name", ({ required, held, reachable }) => {
    expect(grantsSatisfyRequirement(required, held)).toBe(reachable);
    expect(scriptReachable(required, held)).toBe(reachable);
  });

  it("canCall reports alternatives as reachable and names them all when none is held", () => {
    const tools = new Map([["probe", ["web_search", "registry_read"]]]);
    expect(canCall("probe", scriptExpandGrants(["registry_read"], IMPLICATIONS), tools).reachable).toBe(true);
    const denied = canCall("probe", scriptExpandGrants(["file_read"], IMPLICATIONS), tools);
    expect(denied).toMatchObject({ reachable: false, missingGrants: ["web_search", "registry_read"] });
  });

  it("isToolAllowedByGrants is the same predicate applied to the tool's mapping", () => {
    for (const [tool, required] of TOOLS) {
      for (const fixture of FIXTURES) {
        expect(isToolAllowedByGrants(tool, fixture.held)).toBe(grantsSatisfyRequirement(required, fixture.held));
      }
    }
  });

  it("agrees with the runtime for every registry agent's grants across every tool", () => {
    const agents = (agentRegistryData as { agents: Array<{ agent_id: string; config_profile?: { tool_grants?: string[] } }> }).agents;
    let compared = 0;
    for (const agent of agents) {
      const held = agent.config_profile?.tool_grants ?? [];
      const scriptExpanded = scriptExpandGrants(held, IMPLICATIONS);
      expect([...scriptExpanded].sort(), agent.agent_id).toEqual(expandGrants(held).sort());
      for (const tool of TOOLS.keys()) {
        expect(canCall(tool, scriptExpanded, TOOLS).reachable, `${agent.agent_id} → ${tool}`)
          .toBe(isToolAllowedByGrants(tool, held));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
