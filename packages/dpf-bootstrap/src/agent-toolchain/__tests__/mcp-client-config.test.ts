import { describe, it, expect } from "vitest";

import { planMcpClientConfig } from "../mcp-client-config";

const REPO = "/Users/dev/dpf";
const ENDPOINT = "http://127.0.0.1:3000/api/mcp/v1";
const FULL_ENDPOINT = `${ENDPOINT}?tier=full`;

describe("planMcpClientConfig", () => {
  it("writes both files for a fresh contributor (no existing config)", () => {
    const plan = planMcpClientConfig(REPO, ENDPOINT, null, null);
    expect(plan.writes.map((w) => w.path)).toEqual([
      "/Users/dev/dpf/.mcp.json",
      "/Users/dev/dpf/.vscode/mcp.json",
    ]);
  });

  it(".mcp.json is env-backed (mcpServers.dpf, no secret embedded)", () => {
    const plan = planMcpClientConfig(REPO, ENDPOINT, null, null);
    const mcp = plan.writes.find((w) => w.path.endsWith("/.mcp.json"))!;
    const parsed = JSON.parse(mcp.content) as Record<string, any>;
    expect(parsed.mcpServers.dpf.type).toBe("http");
    expect(parsed.mcpServers.dpf.url).toBe(FULL_ENDPOINT);
    expect(parsed.mcpServers.dpf.headers.Authorization).toBe("Bearer ${DPF_MCP_BEARER_TOKEN}");
    expect(mcp.content).not.toMatch(/dpfmcp_/);
  });

  it(".vscode/mcp.json uses servers (not mcpServers) and the env: form", () => {
    const plan = planMcpClientConfig(REPO, ENDPOINT, null, null);
    const vs = plan.writes.find((w) => w.path.endsWith("/.vscode/mcp.json"))!;
    const parsed = JSON.parse(vs.content) as Record<string, any>;
    expect("mcpServers" in parsed).toBe(false);
    expect(parsed.servers.dpf.url).toBe(ENDPOINT);
    expect(parsed.servers.dpf.headers.Authorization).toBe("Bearer ${env:DPF_MCP_BEARER_TOKEN}");
  });

  it("is idempotent: zero writes when both files already match the desired content", () => {
    const first = planMcpClientConfig(REPO, ENDPOINT, null, null);
    const mcp = first.writes.find((w) => w.path.endsWith("/.mcp.json"))!.content;
    const vs = first.writes.find((w) => w.path.endsWith("/.vscode/mcp.json"))!.content;

    const second = planMcpClientConfig(REPO, ENDPOINT, mcp, vs);
    expect(second.writes).toEqual([]);
    expect(second.rationale).toMatch(/already converged/);
  });

  it("normalizes a repoRoot with trailing slashes (ReDoS-safe strip, no double slash)", () => {
    const plan = planMcpClientConfig("/Users/dev/dpf///", ENDPOINT, null, null);
    expect(plan.writes.map((w) => w.path)).toEqual([
      "/Users/dev/dpf/.mcp.json",
      "/Users/dev/dpf/.vscode/mcp.json",
    ]);
  });

  it("rewrites only the drifted file (endpoint changed in .mcp.json)", () => {
    const fresh = planMcpClientConfig(REPO, ENDPOINT, null, null);
    const goodVscode = fresh.writes.find((w) => w.path.endsWith("/.vscode/mcp.json"))!.content;

    const plan = planMcpClientConfig(REPO, ENDPOINT, '{"mcpServers":{"dpf":{"url":"http://old"}}}', goodVscode);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].path).toBe("/Users/dev/dpf/.mcp.json");
  });
});
