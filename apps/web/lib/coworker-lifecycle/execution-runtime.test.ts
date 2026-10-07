import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadInPlatformAgentIds, runsInPlatform } from "./execution-runtime";

describe("execution runtime (BI-C1781121)", () => {
  it("only a declared in_process runtime runs in the platform", () => {
    expect(runsInPlatform("in_process")).toBe(true);
    expect(runsInPlatform("external_cli")).toBe(false);
    expect(runsInPlatform(null)).toBe(false);
    expect(runsInPlatform(undefined)).toBe(false);
  });

  it("loads the in-platform subset of the given agents in one read", async () => {
    const findMany = vi.fn(async () => [
      { agentId: "AGT-WS-BUILD", executionConfig: { executionType: "in_process" } },
      { agentId: "AGT-EXT-CLAUDE", executionConfig: { executionType: "external_cli" } },
      { agentId: "AGT-NO-CONFIG", executionConfig: null },
    ]);
    const ids = await loadInPlatformAgentIds({ agent: { findMany } }, ["AGT-WS-BUILD", "AGT-EXT-CLAUDE", "AGT-NO-CONFIG", "AGT-WS-BUILD"]);
    expect([...ids]).toEqual(["AGT-WS-BUILD"]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(await loadInPlatformAgentIds({ agent: { findMany } }, [])).toEqual(new Set());
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("agrees with the registry: the external CLI participants are exactly the agents that do not run in-platform", () => {
    const registry = JSON.parse(readFileSync(resolve(__dirname, "../../../../packages/db/data/agent_registry.json"), "utf8")) as {
      agents: Array<{ agent_id: string; config_profile?: { execution_runtime?: { type?: string } } }>;
    };
    const external = registry.agents
      .filter((agent) => !runsInPlatform(agent.config_profile?.execution_runtime?.type ?? "in_process"))
      .map((agent) => agent.agent_id)
      .sort();
    expect(external).toEqual(["AGT-EXT-CLAUDE", "AGT-EXT-CODEX", "AGT-EXT-GROK"]);
  });
});
