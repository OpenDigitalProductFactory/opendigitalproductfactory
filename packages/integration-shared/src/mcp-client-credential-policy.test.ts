import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mcpClientBearerHeaderRequired, type McpClient, type McpAuthMode } from "./mcp-client-credential-policy";

describe("MCP credential selection", () => {
  it.each(["https://dpf.example/api/mcp/v1", "http://127.0.0.1:3000/api/mcp/v1", "http://localhost:3000/api/mcp/v1", "http://[::1]:3000/api/mcp/v1"])("defaults Codex to OAuth on %s", (endpoint) => {
    expect(mcpClientBearerHeaderRequired(endpoint, "codex")).toBe(false);
  });
  it("keeps explicit legacy credentials even on HTTPS", () => {
    expect(mcpClientBearerHeaderRequired("https://dpf.example/api/mcp/v1", "codex", "legacy")).toBe(true);
  });
  it.each(["http://remote.example/api/mcp/v1", "not a URL", "http://localhost.example/api/mcp/v1"])("requires compatibility for %s", (endpoint) => {
    expect(mcpClientBearerHeaderRequired(endpoint, "codex")).toBe(true);
  });
  it("does not infer Grok OAuth support from Codex", () => {
    expect(mcpClientBearerHeaderRequired("https://dpf.example/api/mcp/v1", "grok")).toBe(true);
  });
});

it("agrees with the updater fixture matrix", () => {
  const cases = JSON.parse(readFileSync(resolve(__dirname, "../../dpf-skill-pack/scripts/mcp-credential-policy-cases.json"), "utf8")) as Array<{endpoint: string; client: McpClient; mode: McpAuthMode; required: boolean}>;
  for (const c of cases) expect(mcpClientBearerHeaderRequired(c.endpoint, c.client, c.mode), JSON.stringify(c)).toBe(c.required);
});
