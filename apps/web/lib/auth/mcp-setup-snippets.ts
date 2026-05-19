// Pure helper — no Next.js server context required.
// Single source of truth for .mcp.json / .vscode/mcp.json snippet generation.
// Used by apps/web/lib/actions/mcp-tokens.ts (server action) and
// apps/web/scripts/issue-mcp-token.ts (CLI).

export type McpSnippetFormat = "claude-code" | "codex" | "vscode" | "raw";

export const MCP_BEARER_TOKEN_ENV_VAR = "DPF_MCP_BEARER_TOKEN";

export type McpSetupSnippets = {
  claudeCode: string;
  codex: string;
  vscode: string;
  syncCommand: string;
  envPowerShell: string;
  runtimeRefreshPowerShell: string;
};

function psSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildSetupSnippets(plaintext: string, baseUrl: string): McpSetupSnippets {
  const url = `${baseUrl}/api/mcp/v1`;
  const refreshUrl = `${baseUrl}/api/mcp/token/refresh`;
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
  // VS Code: .vscode/mcp.json uses servers (not mcpServers)
  const vscode = JSON.stringify({ servers: { dpf: vscodeHttpEntry } }, null, 2);
  const syncCommand = ".\\scripts\\seed-worktree-mcp.ps1";
  const envPowerShell = `[System.Environment]::SetEnvironmentVariable('${MCP_BEARER_TOKEN_ENV_VAR}', '${psSingleQuoted(plaintext)}', 'User')`;
  const refreshBody = JSON.stringify({ token: plaintext });
  const runtimeRefreshPowerShell =
    `Invoke-RestMethod -Method Post -Uri '${psSingleQuoted(refreshUrl)}' ` +
    `-ContentType 'application/json' -Body '${psSingleQuoted(refreshBody)}'`;
  return {
    claudeCode,
    codex,
    vscode,
    syncCommand,
    envPowerShell,
    runtimeRefreshPowerShell,
  };
}
