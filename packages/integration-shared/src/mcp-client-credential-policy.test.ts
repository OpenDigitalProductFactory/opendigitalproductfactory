import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MCP_CLIENT_OAUTH_SCOPE_PIN,
  mcpClientBearerHeaderRequired,
  mcpClientOAuthScopePin,
  type McpAuthMode,
  type McpClient,
} from "./mcp-client-credential-policy";

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

// BI-3D2FD68C: the pin and the header are the two halves of one rule. The
// client and its credential path decide whether OAuth runs at all; the pin is
// what makes Claude Code's OAuth path grant more than the advertised read scope.
describe("mcpClientOAuthScopePin", () => {
  it("pins the development scopes for Claude Code on https", () => {
    expect(mcpClientOAuthScopePin("https://localhost/api/mcp/v1?tier=full")).toBe(MCP_CLIENT_OAUTH_SCOPE_PIN);
    expect(mcpClientOAuthScopePin("https://localhost/api/mcp/v1?tier=full", "claude", "oauth")).toBe(MCP_CLIENT_OAUTH_SCOPE_PIN);
  });

  it("pins nothing for Claude Code on http, where the header is the credential", () => {
    expect(mcpClientOAuthScopePin("http://127.0.0.1:3000/api/mcp/v1")).toBeNull();
  });

  it("pins nothing under explicit legacy credentials, even on https", () => {
    expect(mcpClientOAuthScopePin("https://localhost/api/mcp/v1", "claude", "legacy")).toBeNull();
  });

  it("pins nothing for clients that have no oauth.scopes field, even where they run OAuth", () => {
    expect(mcpClientOAuthScopePin("http://127.0.0.1:3000/api/mcp/v1", "codex")).toBeNull();
    expect(mcpClientOAuthScopePin("https://dpf.example/api/mcp/v1", "codex")).toBeNull();
    expect(mcpClientOAuthScopePin("https://dpf.example/api/mcp/v1", "vscode")).toBeNull();
    expect(mcpClientOAuthScopePin("https://dpf.example/api/mcp/v1", "grok")).toBeNull();
    expect(mcpClientOAuthScopePin("https://dpf.example/api/mcp/v1", "antigravity")).toBeNull();
  });

  it("pins nothing on an unparseable endpoint, matching the header's fail-safe", () => {
    expect(mcpClientOAuthScopePin("not a url")).toBeNull();
  });

  it("is a space-separated RFC 6749 scope string of dpf.* scopes", () => {
    const scopes = MCP_CLIENT_OAUTH_SCOPE_PIN.split(" ");
    expect(scopes).toEqual(["dpf.read", "dpf.work", "dpf.build"]);
    for (const scope of scopes) expect(scope).toMatch(/^dpf\.[a-z]+$/);
  });
});
