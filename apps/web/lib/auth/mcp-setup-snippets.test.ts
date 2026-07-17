import { describe, expect, it } from "vitest";
import { buildSetupSnippets } from "./mcp-setup-snippets";

const BASE = "http://localhost:3000";
const LOCAL_MCP_URL = "http://127.0.0.1:3000/api/mcp/v1";
const LOCAL_REFRESH_URL = "http://127.0.0.1:3000/api/mcp/token/refresh";
const TOKEN = "dpfmcp_TESTTOKEN";

describe("buildSetupSnippets", () => {
  it("claudeCode has mcpServers.dpf with http type, correct url, and env-backed auth header", () => {
    const { claudeCode } = buildSetupSnippets(TOKEN, BASE);
    const parsed = JSON.parse(claudeCode) as Record<string, unknown>;
    const dpf = (parsed.mcpServers as Record<string, unknown>).dpf as Record<string, unknown>;
    expect(dpf.type).toBe("http");
    expect(dpf.url).toBe(LOCAL_MCP_URL);
    expect((dpf.headers as Record<string, string>).Authorization).toBe("Bearer ${DPF_MCP_BEARER_TOKEN}");
    expect(claudeCode).not.toContain(TOKEN);
  });

  it("vscode has servers.dpf (not mcpServers) with the same env-backed http entry", () => {
    const { vscode } = buildSetupSnippets(TOKEN, BASE);
    const parsed = JSON.parse(vscode) as Record<string, unknown>;
    expect("mcpServers" in parsed).toBe(false);
    const dpf = (parsed.servers as Record<string, unknown>).dpf as Record<string, unknown>;
    expect(dpf.type).toBe("http");
    expect(dpf.url).toBe(LOCAL_MCP_URL);
    expect((dpf.headers as Record<string, string>).Authorization).toBe("Bearer ${env:DPF_MCP_BEARER_TOKEN}");
    expect(vscode).not.toContain(TOKEN);
  });

  it("codex uses bearer_token_env_var instead of embedding the secret", () => {
    const { codex } = buildSetupSnippets(TOKEN, BASE);
    expect(codex).toContain("[mcp_servers.dpf]");
    expect(codex).toContain(`url = "${LOCAL_MCP_URL}"`);
    expect(codex).toContain('bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"');
    expect(codex).not.toContain(TOKEN);
  });

  it("grok produces the same TOML shape as codex (for ~/.grok/config.toml) and is documented", () => {
    const { grok } = buildSetupSnippets(TOKEN, BASE);
    expect(grok).toContain("[mcp_servers.dpf]");
    expect(grok).toContain(`url = "${LOCAL_MCP_URL}"`);
    expect(grok).toContain('bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"');
    expect(grok).toContain("Grok (xAI) MCP server configuration");
    expect(grok).not.toContain(TOKEN);
  });

  it("antigravity produces a JSON mcpServers.dpf block (http, env-backed auth) and never embeds the secret", () => {
    const { antigravity } = buildSetupSnippets(TOKEN, BASE);
    const parsed = JSON.parse(antigravity) as {
      mcpServers?: { dpf?: { type?: string; url?: string; headers?: { Authorization?: string } } };
    };
    expect(parsed.mcpServers?.dpf?.type).toBe("http");
    expect(parsed.mcpServers?.dpf?.url).toBe(LOCAL_MCP_URL);
    expect(parsed.mcpServers?.dpf?.headers?.Authorization).toBe("Bearer ${DPF_MCP_BEARER_TOKEN}");
    expect(antigravity).not.toContain(TOKEN);
  });

  it("env and runtime refresh snippets carry the full plaintext token", () => {
    const t = "dpfmcp_UNIQUETOKEN";
    const { envPowerShell, runtimeRefreshPowerShell } = buildSetupSnippets(t, BASE);
    expect(envPowerShell).toBe(
      "[System.Environment]::SetEnvironmentVariable('DPF_MCP_BEARER_TOKEN', 'dpfmcp_UNIQUETOKEN', 'User')",
    );
    expect(runtimeRefreshPowerShell).toContain(LOCAL_REFRESH_URL);
    expect(runtimeRefreshPowerShell).toContain(`"token":"${t}"`);
  });

  it("envPosix is an export line carrying the full plaintext token", () => {
    const t = "dpfmcp_UNIQUETOKEN";
    const { envPosix } = buildSetupSnippets(t, BASE);
    expect(envPosix).toBe("export DPF_MCP_BEARER_TOKEN='dpfmcp_UNIQUETOKEN'");
  });

  it("envLaunchctl uses launchctl setenv so GUI-launched apps inherit the var", () => {
    const t = "dpfmcp_UNIQUETOKEN";
    const { envLaunchctl } = buildSetupSnippets(t, BASE);
    expect(envLaunchctl).toBe("launchctl setenv DPF_MCP_BEARER_TOKEN 'dpfmcp_UNIQUETOKEN'");
  });

  it("POSIX persistence lines single-quote-escape a token containing a quote", () => {
    // Defensive: a token must never break out of the shell single-quoted string.
    const t = "dpfmcp_a'b";
    const { envPosix, envLaunchctl } = buildSetupSnippets(t, BASE);
    expect(envPosix).toBe("export DPF_MCP_BEARER_TOKEN='dpfmcp_a'\\''b'");
    expect(envLaunchctl).toBe("launchctl setenv DPF_MCP_BEARER_TOKEN 'dpfmcp_a'\\''b'");
  });

  it("constructs the url from a non-localhost baseUrl", () => {
    const { claudeCode, runtimeRefreshPowerShell } = buildSetupSnippets(TOKEN, "https://dpf.example.com");
    expect(claudeCode).toContain("https://dpf.example.com/api/mcp/v1");
    expect(runtimeRefreshPowerShell).toContain("https://dpf.example.com/api/mcp/token/refresh");
  });

  it("preserves a non-localhost HTTP baseUrl for LAN installs", () => {
    const { claudeCode, runtimeRefreshPowerShell } = buildSetupSnippets(TOKEN, "http://192.168.0.200:3000");
    expect(claudeCode).toContain("http://192.168.0.200:3000/api/mcp/v1");
    expect(runtimeRefreshPowerShell).toContain("http://192.168.0.200:3000/api/mcp/token/refresh");
  });

  it("normalizes IPv6 loopback baseUrl to IPv4 for local clients", () => {
    const { claudeCode, runtimeRefreshPowerShell } = buildSetupSnippets(TOKEN, "http://[::1]:3000");
    expect(claudeCode).toContain(LOCAL_MCP_URL);
    expect(runtimeRefreshPowerShell).toContain(LOCAL_REFRESH_URL);
  });

  it("JSON setup outputs are valid JSON", () => {
    const { claudeCode, codex, grok, vscode } = buildSetupSnippets(TOKEN, BASE);
    expect(() => JSON.parse(claudeCode)).not.toThrow();
    expect(codex).toContain("[mcp_servers.dpf]");
    expect(grok).toContain("[mcp_servers.dpf]");
    expect(() => JSON.parse(vscode)).not.toThrow();
  });

  it("syncCommand contains the seed script path", () => {
    const { syncCommand } = buildSetupSnippets(TOKEN, BASE);
    expect(syncCommand).toContain("seed-worktree-mcp.ps1");
  });
});
