import { describe, it, expect } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  // BI-46B636B0: the header is the only credential path over plain http; over
  // https it would disable the client's OAuth, so it is omitted there.
  it("omits the bearer header for an https endpoint so OAuth takes over", () => {
    const plan = planMcpClientConfig(REPO, "https://dpf.example.com/api/mcp/v1", null, null);
    const mcp = JSON.parse(plan.writes.find((w) => w.path.endsWith("/.mcp.json"))!.content) as Record<string, any>;
    const vs = JSON.parse(plan.writes.find((w) => w.path.endsWith("/.vscode/mcp.json"))!.content) as Record<string, any>;
    expect(mcp.mcpServers.dpf.url).toBe("https://dpf.example.com/api/mcp/v1?tier=full");
    expect("headers" in mcp.mcpServers.dpf).toBe(false);
    expect("headers" in vs.servers.dpf).toBe(false);
  });

  it("the tracked .mcp.json is exactly what the planner writes for the default endpoint (no drift in either direction)", () => {
    // #5416 hand-edited the tracked file; the planner then disagreed and the
    // next bootstrap would have silently rewritten it. Pin them together.
    const tracked = readFileSync(join(__dirname, "..", "..", "..", "..", "..", ".mcp.json"), "utf8");
    const plan = planMcpClientConfig(REPO, ENDPOINT, tracked, null);
    expect(plan.writes.map((w) => w.path)).toEqual(["/Users/dev/dpf/.vscode/mcp.json"]);
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


it("preserves unrelated JSON servers while removing only managed OAuth-blocking headers", () => {
  const original = JSON.stringify({mcpServers: {other: {url: "https://other.example"}, dpf: {url: "https://old.example", timeout: 45, headers: {Authorization: "Bearer ${DPF_MCP_BEARER_TOKEN}", "X-Tenant": "sample"}}}});
  const plan = planMcpClientConfig("/tmp/repo", "https://dpf.example/api/mcp/v1", original, null);
  const content = JSON.parse(plan.writes.find(w => w.path.endsWith("/.mcp.json"))!.content);
  expect(content.mcpServers.other.url).toBe("https://other.example");
  expect(content.mcpServers.dpf.timeout).toBe(45);
  expect(content.mcpServers.dpf.headers).toEqual({"X-Tenant": "sample"});
  expect(planMcpClientConfig("/tmp/repo", "https://dpf.example/api/mcp/v1", JSON.stringify(content, null, 2), plan.writes.find(w => w.path.endsWith("/.vscode/mcp.json"))!.content).writes).toEqual([]);
});

it("preserves custom credentials and headers when compatibility is required", () => {
  const original = JSON.stringify({mcpServers: {dpf: {headers: {Authorization: "Bearer ${MY_TOKEN}", "X-Tenant": "sample"}}}});
  const plan = planMcpClientConfig("/tmp/repo", "http://127.0.0.1:3000/api/mcp/v1", original, null);
  expect(JSON.parse(plan.writes[0].content).mcpServers.dpf.headers).toEqual({Authorization: "Bearer ${MY_TOKEN}", "X-Tenant": "sample"});
});
