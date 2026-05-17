// Pure helper — no Next.js server context required.
// Single source of truth for .mcp.json / .vscode/mcp.json snippet generation.
// Used by apps/web/lib/actions/mcp-tokens.ts (server action) and
// apps/web/scripts/issue-mcp-token.ts (CLI).

export type McpSnippetFormat = "claude-code" | "codex" | "vscode" | "raw";

export type McpSetupSnippets = {
  claudeCode: string;
  codex: string;
  vscode: string;
  syncCommand: string;
};

export function buildSetupSnippets(plaintext: string, baseUrl: string): McpSetupSnippets {
  const url = `${baseUrl}/api/mcp/v1`;
  const httpEntry = {
    type: "http",
    url,
    headers: { Authorization: `Bearer ${plaintext}` },
  };
  // Claude Code and Codex: .mcp.json uses the mcpServers key
  const claudeCode = JSON.stringify({ mcpServers: { dpf: httpEntry } }, null, 2);
  const codex = JSON.stringify({ mcpServers: { dpf: httpEntry } }, null, 2);
  // VS Code: .vscode/mcp.json uses servers (not mcpServers)
  const vscode = JSON.stringify({ servers: { dpf: httpEntry } }, null, 2);
  const syncCommand = ".\\scripts\\seed-worktree-mcp.ps1";
  return { claudeCode, codex, vscode, syncCommand };
}
