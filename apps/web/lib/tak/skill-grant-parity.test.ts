// BI-3BF3CBDF: a shipped DPF skill must not direct an external coding agent to
// a tool that agent cannot reach. The Surface A `allowed-tools` line is what
// Claude Code, Codex and Grok load; if a tool named there is ungranted to the
// AGT-EXT-* coworkers, the skill dead-ends at load_tools with
// agent-grant-missing. That is how record_decision_outcome and
// propose_improvement stayed unreachable from every external session while
// dpf-record-decision-outcome and dpf-route-learning-to-commons told agents to
// call them.

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import agentRegistryData from "../../../../packages/db/data/agent_registry.json";
import { TOOL_TO_GRANTS, isToolAllowedByGrants } from "./agent-grants";

const SKILLS_ROOT = path.resolve(__dirname, "../../../../packages/dpf-skill-pack/skills");
const EXTERNAL_AGENTS = ["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"] as const;

// Gaps that predate this guard. BI-E0F19DBA closed every one: each tool was
// either granted to the external agents (EXTERNAL_DEVELOPMENT_GRANTS in
// packages/db/src/coworker-grants.ts) or dropped from a skill's Surface A
// allowed-tools because that step is in-portal only. This list may only
// shrink; it is empty, so a new gap fails the test.
const KNOWN_GAPS: Record<string, string> = {};

type RegistryAgent = { agent_id: string; config_profile?: { tool_grants?: string[] } };

function agentGrants(agentId: string): string[] {
  const data = agentRegistryData as unknown as { agents?: RegistryAgent[] } | RegistryAgent[];
  const agents = Array.isArray(data) ? data : (data.agents ?? []);
  const agent = agents.find((a) => a.agent_id === agentId);
  if (!agent) throw new Error(`${agentId} missing from agent_registry.json`);
  return agent.config_profile?.tool_grants ?? [];
}

function surfaceAToolsBySkill(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const dir of fs.readdirSync(SKILLS_ROOT)) {
    const file = path.join(SKILLS_ROOT, dir, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, "utf8").match(/^allowed-tools:(.*)$/m)?.[1] ?? "";
    const tools = [...line.matchAll(/mcp__dpf__([a-z0-9_]+)/g)]
      .map((m) => m[1])
      .filter((tool) => tool in TOOL_TO_GRANTS);
    if (tools.length > 0) out.set(dir, tools);
  }
  return out;
}

function unreachableTools(agentId: string): Map<string, string[]> {
  const held = agentGrants(agentId);
  const gaps = new Map<string, string[]>();
  for (const [skill, tools] of surfaceAToolsBySkill()) {
    for (const tool of tools) {
      if (isToolAllowedByGrants(tool, held)) continue;
      gaps.set(tool, [...(gaps.get(tool) ?? []), skill]);
    }
  }
  return gaps;
}

describe("shipped DPF skills only direct external agents to tools they can reach", () => {
  it("finds the skills it guards", () => {
    expect(surfaceAToolsBySkill().size).toBeGreaterThan(10);
  });

  for (const agentId of EXTERNAL_AGENTS) {
    it(`${agentId} reaches every Surface A tool outside the known gaps`, () => {
      const unexpected = [...unreachableTools(agentId)].filter(([tool]) => !(tool in KNOWN_GAPS));
      expect(Object.fromEntries(unexpected)).toEqual({});
    });

    it(`${agentId} can record decision outcomes and propose improvements`, () => {
      const held = agentGrants(agentId);
      expect(isToolAllowedByGrants("record_decision_outcome", held)).toBe(true);
      expect(isToolAllowedByGrants("propose_improvement", held)).toBe(true);
    });

    // BI-E0F19DBA: the gap was closed by dropping these from Surface A, not by
    // granting them. They change coworker authority and stay in-portal.
    it(`${agentId} cannot establish coworkers or change their grants`, () => {
      const held = agentGrants(agentId);
      expect(isToolAllowedByGrants("establish_coworker", held)).toBe(false);
      expect(isToolAllowedByGrants("manage_coworker_tool_grant", held)).toBe(false);
    });
  }

  it("lists no known gap that has since become reachable", () => {
    const stillUnreachable = new Set(unreachableTools("AGT-EXT-CLAUDE").keys());
    const stale = Object.keys(KNOWN_GAPS).filter((tool) => !stillUnreachable.has(tool));
    expect(stale).toEqual([]);
  });
});
