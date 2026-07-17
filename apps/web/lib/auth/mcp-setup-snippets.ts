// Pure helper — no Next.js server context required.
// Single source of truth for .mcp.json / .vscode/mcp.json snippet generation.
// Used by apps/web/lib/actions/mcp-tokens.ts (server action) and
// apps/web/scripts/issue-mcp-token.ts (CLI).

export type McpSnippetFormat = "claude-code" | "codex" | "grok" | "antigravity" | "vscode" | "raw";

export const MCP_BEARER_TOKEN_ENV_VAR = "DPF_MCP_BEARER_TOKEN";

export type McpSetupSnippets = {
  claudeCode: string;
  codex: string;
  grok: string;
  antigravity: string;
  vscode: string;
  syncCommand: string;
  envPowerShell: string;
  /** POSIX shell line for ~/.zshenv / ~/.bash_profile (login + non-login shells). */
  envPosix: string;
  /** macOS launchctl line so GUI-launched apps (e.g. Codex.app) inherit the var. */
  envLaunchctl: string;
  runtimeRefreshPowerShell: string;
};

function psSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

// POSIX single-quote escaping: close the quote, emit an escaped quote, reopen.
// Tokens are `dpfmcp_...` (no quotes in practice) but escape defensively so the
// installer never writes a malformed shell line.
function shSingleQuoted(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function normalizeLocalClientBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol === "http:" && (hostname === "localhost" || hostname === "::1" || hostname === "[::1]")) {
      parsed.hostname = "127.0.0.1";
      return parsed.toString().replace(/\/+$/, "");
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

export function buildSetupSnippets(plaintext: string, baseUrl: string): McpSetupSnippets {
  const clientBaseUrl = normalizeLocalClientBaseUrl(baseUrl);
  const url = `${clientBaseUrl}/api/mcp/v1`;
  const refreshUrl = `${clientBaseUrl}/api/mcp/token/refresh`;
  const httpEntry = {
    type: "http",
    url,
    headers: { Authorization: `Bearer \${${MCP_BEARER_TOKEN_ENV_VAR}}` },
  };
  const vscodeHttpEntry = {
    type: "http",
    url,
    headers: { Authorization: `Bearer \${env:${MCP_BEARER_TOKEN_ENV_VAR}}` },
  };
  // Claude Code: .mcp.json uses the mcpServers key.
  const claudeCode = JSON.stringify({ mcpServers: { dpf: httpEntry } }, null, 2);
  const codex = [
    "[mcp_servers.dpf]",
    `url = "${url}"`,
    `bearer_token_env_var = "${MCP_BEARER_TOKEN_ENV_VAR}"`,
  ].join("\n");
  // Grok: identical TOML shape to Codex (Grok CLI/desktop reads a config.toml).
  // Cross-platform locations (Grok CLI behavior may evolve — these are the common patterns in 2026):
  //   macOS/Linux: ~/.grok/config.toml or <project>/.grok/config.toml
  //   Windows: %USERPROFILE%\.grok\config.toml  (or %APPDATA%\grok\config.toml — check `grok --help` or xAI docs)
  // The TOML content itself is the same on all platforms.
  const grok = [
    "# Grok (xAI) MCP server configuration",
    "# macOS/Linux: ~/.grok/config.toml  (or <project>/.grok/config.toml)",
    "# Windows:     %USERPROFILE%\\.grok\\config.toml  (or %APPDATA%\\grok\\config.toml)",
    "[mcp_servers.dpf]",
    `url = "${url}"`,
    `bearer_token_env_var = "${MCP_BEARER_TOKEN_ENV_VAR}"`,
  ].join("\n");
  // Antigravity (Google): VS Code / Windsurf-derived agentic IDE. Its MCP config
  // is a JSON block keyed by `mcpServers` (same shape as Claude Code's .mcp.json),
  // consumed by both the IDE and the `agy` CLI. EP-ANTIGRAVITY-001 evidence gate
  // (BI-47A81FEB): confirm the exact config path against a live install before
  // this is automated in the bootstrap — the common 2026 locations are:
  //   macOS/Linux: ~/.antigravity/mcp_config.json  (or the in-IDE MCP settings)
  //   Windows:     %USERPROFILE%\.antigravity\mcp_config.json
  // The JSON content itself is identical across platforms.
  const antigravity = JSON.stringify({ mcpServers: { dpf: httpEntry } }, null, 2);
  // VS Code: .vscode/mcp.json uses servers (not mcpServers)
  const vscode = JSON.stringify({ servers: { dpf: vscodeHttpEntry } }, null, 2);
  const syncCommand = ".\\scripts\\seed-worktree-mcp.ps1";
  const envPowerShell = `[System.Environment]::SetEnvironmentVariable('${MCP_BEARER_TOKEN_ENV_VAR}', '${psSingleQuoted(plaintext)}', 'User')`;
  const envPosix = `export ${MCP_BEARER_TOKEN_ENV_VAR}='${shSingleQuoted(plaintext)}'`;
  const envLaunchctl = `launchctl setenv ${MCP_BEARER_TOKEN_ENV_VAR} '${shSingleQuoted(plaintext)}'`;
  const refreshBody = JSON.stringify({ token: plaintext });
  const runtimeRefreshPowerShell =
    `Invoke-RestMethod -Method Post -Uri '${psSingleQuoted(refreshUrl)}' ` +
    `-ContentType 'application/json' -Body '${psSingleQuoted(refreshBody)}'`;
  return {
    claudeCode,
    codex,
    grok,
    antigravity,
    vscode,
    syncCommand,
    envPowerShell,
    envPosix,
    envLaunchctl,
    runtimeRefreshPowerShell,
  };
}
