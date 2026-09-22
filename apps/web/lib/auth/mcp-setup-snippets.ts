// Pure helper — no Next.js server context required.
// Single source of truth for .mcp.json / .vscode/mcp.json snippet generation.
// Used by apps/web/lib/actions/mcp-tokens.ts (server action) and
// apps/web/scripts/issue-mcp-token.ts (CLI).

import { withDpfMcpCatalogTier } from "@dpf/integration-shared/mcp-catalog-tier";
import {
  mcpClientBearerHeaderRequired,
  mcpClientOAuthScopePin,
  type McpAuthMode,
} from "@dpf/integration-shared/mcp-client-credential-policy";

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

// This entry point follows explicit PAT issuance. Interactive generators default to OAuth.
export function buildSetupSnippets(plaintext: string, baseUrl: string, authMode: McpAuthMode = "legacy"): McpSetupSnippets {
  const clientBaseUrl = normalizeLocalClientBaseUrl(baseUrl);
  const url = `${clientBaseUrl}/api/mcp/v1`;
  const lazyHostUrl = withDpfMcpCatalogTier(url, "full");
  const refreshUrl = `${clientBaseUrl}/api/mcp/token/refresh`;
  // BI-46B636B0: the header fallback is the only credential path over plain
  // http (the client refuses OAuth there); over https it would disable OAuth.
  const headerRequired = mcpClientBearerHeaderRequired(url, "claude", authMode);
  const httpEntry = {
    type: "http",
    url,
    ...(headerRequired ? { headers: { Authorization: `Bearer \${${MCP_BEARER_TOKEN_ENV_VAR}}` } } : {}),
  };
  const lazyHostHttpEntry = { ...httpEntry, url: lazyHostUrl };
  const vscodeHttpEntry = {
    type: "http",
    url,
    ...(mcpClientBearerHeaderRequired(url, "vscode", authMode) ? { headers: { Authorization: `Bearer \${env:${MCP_BEARER_TOKEN_ENV_VAR}}` } } : {}),
  };
  // Claude Code: .mcp.json uses the mcpServers key. BI-3D2FD68C: Claude Code
  // alone understands `oauth.scopes`; without the pin an https consent grants
  // only the advertised read scope and every write tool stays out of reach.
  const scopePin = mcpClientOAuthScopePin(url, "claude", authMode);
  const claudeCodeEntry = {
    ...lazyHostHttpEntry,
    ...(scopePin ? { oauth: { scopes: scopePin } } : {}),
  };
  const claudeCode = JSON.stringify({ mcpServers: { dpf: claudeCodeEntry } }, null, 2);
  const codex = [
    "[mcp_servers.dpf]",
    `url = "${lazyHostUrl}"`,
    ...(mcpClientBearerHeaderRequired(url, "codex", authMode) ? [`bearer_token_env_var = "${MCP_BEARER_TOKEN_ENV_VAR}"`] : []),
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
    ...(mcpClientBearerHeaderRequired(url, "grok", authMode) ? [`bearer_token_env_var = "${MCP_BEARER_TOKEN_ENV_VAR}"`] : []),
  ].join("\n");
  // Antigravity (Google): VS Code / Windsurf-derived agentic IDE. Its MCP config
  // is a JSON block keyed by `mcpServers` (same shape as Claude Code's .mcp.json),
  // consumed by both the IDE and the `agy` CLI. EP-ANTIGRAVITY-001 evidence gate
  // (BI-47A81FEB): confirm the exact config path against a live install before
  // this is automated in the bootstrap — the common 2026 locations are:
  //   macOS/Linux: ~/.antigravity/mcp_config.json  (or the in-IDE MCP settings)
  //   Windows:     %USERPROFILE%\.antigravity\mcp_config.json
  // The JSON content itself is identical across platforms.
  const antigravity = JSON.stringify({ mcpServers: { dpf: { type: "http", url, ...(mcpClientBearerHeaderRequired(url, "antigravity", authMode) ? { headers: { Authorization: `Bearer \${${MCP_BEARER_TOKEN_ENV_VAR}}` } } : {}) } } }, null, 2);
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

// ── client_credentials clients (BI-EDB67A2B) ────────────────────────────────
//
// The headless credential is NOT a bearer for the MCP transport: it is
// exchanged at /api/oauth/token for a short-lived access token. The gate
// scripts read it from ONE of two places, and this is the single statement of
// both — scripts/lib/mcp-credential.mjs resolves the same file path and env
// names (kept in lockstep by its tests, not by import: the script has no build
// step and cannot import the web bundle).

export const MCP_CLIENT_ID_ENV_VAR = "DPF_MCP_CLIENT_ID";
export const MCP_CLIENT_SECRET_ENV_VAR = "DPF_MCP_CLIENT_SECRET";
/** Home-relative on purpose: outside every checkout, so it can never be committed. */
export const MCP_CLIENT_CREDENTIALS_FILE = "~/.dpf/mcp-client-credentials.json";

export type McpCredentialsClientSnippets = {
  /** Where the gate looks by default. */
  credentialsFilePath: string;
  /** The exact file body: {"clientId","clientSecret"}. */
  credentialsFileJson: string;
  /** One POSIX line that writes the file with owner-only permissions. */
  writeFilePosix: string;
  /** One PowerShell line that writes the file. */
  writeFilePowerShell: string;
  /** Environment-variable alternative for CI secret stores. */
  envPosix: string;
  envPowerShell: string;
};

export function buildCredentialsClientSnippets(clientId: string, clientSecret: string): McpCredentialsClientSnippets {
  const credentialsFileJson = JSON.stringify({ clientId, clientSecret }, null, 2);
  const writeFilePosix =
    `mkdir -p ~/.dpf && umask 077 && printf '%s\n' '${shSingleQuoted(credentialsFileJson.replace(/\n\s*/g, " "))}' > ${MCP_CLIENT_CREDENTIALS_FILE}`;
  const writeFilePowerShell =
    `New-Item -ItemType Directory -Force "$HOME\\.dpf" | Out-Null; Set-Content -Path "$HOME\\.dpf\\mcp-client-credentials.json" -Value '${psSingleQuoted(credentialsFileJson.replace(/\n\s*/g, " "))}'`;
  const envPosix = `export ${MCP_CLIENT_ID_ENV_VAR}='${shSingleQuoted(clientId)}' ${MCP_CLIENT_SECRET_ENV_VAR}='${shSingleQuoted(clientSecret)}'`;
  const envPowerShell =
    `[System.Environment]::SetEnvironmentVariable('${MCP_CLIENT_ID_ENV_VAR}', '${psSingleQuoted(clientId)}', 'User'); ` +
    `[System.Environment]::SetEnvironmentVariable('${MCP_CLIENT_SECRET_ENV_VAR}', '${psSingleQuoted(clientSecret)}', 'User')`;
  return { credentialsFilePath: MCP_CLIENT_CREDENTIALS_FILE, credentialsFileJson, writeFilePosix, writeFilePowerShell, envPosix, envPowerShell };
}
