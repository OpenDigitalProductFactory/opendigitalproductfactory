import { describe, expect, it } from "vitest";
import { buildSetupSnippets } from "./mcp-setup-snippets";

const BASE = "http://localhost:3000";
const TOKEN = "dpfmcp_TESTTOKEN";

describe("buildSetupSnippets", () => {
  it("claudeCode has mcpServers.dpf with http type, correct url, and env-backed auth header", () => {
    const { claudeCode } = buildSetupSnippets(TOKEN, BASE);
    const parsed = JSON.parse(claudeCode) as Record<string, unknown>;
    const dpf = (parsed.mcpServers as Record<string, unknown>).dpf as Record<string, unknown>;
    expect(dpf.type).toBe("http");
    expect(dpf.url).toBe(`${BASE}/api/mcp/v1`);
    expect((dpf.headers as Record<string, string>).Authorization).toBe("Bearer ${DPF_MCP_BEARER_TOKEN}");
    expect(claudeCode).not.toContain(TOKEN);
  });

  it("vscode has servers.dpf (not mcpServers) with the same env-backed http entry", () => {
    const { vscode } = buildSetupSnippets(TOKEN, BASE);
    const parsed = JSON.parse(vscode) as Record<string, unknown>;
    expect("mcpServers" in parsed).toBe(false);
    const dpf = (parsed.servers as Record<string, unknown>).dpf as Record<string, unknown>;
    expect(dpf.type).toBe("http");
    expect(dpf.url).toBe(`${BASE}/api/mcp/v1`);
    expect((dpf.headers as Record<string, string>).Authorization).toBe("Bearer ${env:DPF_MCP_BEARER_TOKEN}");
    expect(vscode).not.toContain(TOKEN);
  });

  it("codex uses bearer_token_env_var instead of embedding the secret", () => {
    const { codex } = buildSetupSnippets(TOKEN, BASE);
    expect(codex).toContain("[mcp_servers.dpf]");
    expect(codex).toContain(`url = "${BASE}/api/mcp/v1"`);
    expect(codex).toContain('bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"');
    expect(codex).not.toContain(TOKEN);
  });

  it("env and runtime refresh snippets carry the full plaintext token", () => {
    const t = "dpfmcp_UNIQUETOKEN";
    const { envPowerShell, runtimeRefreshPowerShell } = buildSetupSnippets(t, BASE);
    expect(envPowerShell).toBe(
      "[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_UNIQUETOKEN', 'User')",
    );
    expect(runtimeRefreshPowerShell).toContain(`${BASE}/api/mcp/token/refresh`);
    expect(runtimeRefreshPowerShell).toContain(`"token":"${t}"`);
  });

  it("constructs the url from a non-localhost baseUrl", () => {
    const { claudeCode, runtimeRefreshPowerShell } = buildSetupSnippets(TOKEN, "https://dpf.example.com");
    expect(claudeCode).toContain("https://dpf.example.com/api/mcp/v1");
    expect(runtimeRefreshPowerShell).toContain("https://dpf.example.com/api/mcp/token/refresh");
  });

  it("JSON setup outputs are valid JSON", () => {
    const { claudeCode, codex, vscode } = buildSetupSnippets(TOKEN, BASE);
    expect(() => JSON.parse(claudeCode)).not.toThrow();
    expect(codex).toContain("[mcp_servers.dpf]");
    expect(() => JSON.parse(vscode)).not.toThrow();
  });

  it("syncCommand contains the seed script path", () => {
    const { syncCommand } = buildSetupSnippets(TOKEN, BASE);
    expect(syncCommand).toContain("seed-worktree-mcp.ps1");
  });
});
