export const CODING_AGENT_MCP_TOKEN_SCOPES = [
  "architecture_read",
  "backlog_read",
  "code_graph_read",
  "file_read",
  "spec_plan_read",
] as const;

export function defaultMcpTokenScopes(availableScopes: readonly string[]): string[] {
  const available = new Set(availableScopes);
  return CODING_AGENT_MCP_TOKEN_SCOPES.filter((scope) => available.has(scope));
}
