export const MCP_TOKEN_SCOPE_TIERS = ["read", "write", "admin"] as const;

export type McpTokenScopeTier = (typeof MCP_TOKEN_SCOPE_TIERS)[number];

export const READ_MCP_TOKEN_SCOPES = [
  "architecture_read",
  "backlog_read",
  "code_graph_read",
  "file_read",
  "spec_plan_read",
  "work_capsule_read",
] as const;

export const WRITE_MCP_TOKEN_SCOPES = [
  ...READ_MCP_TOKEN_SCOPES,
  "backlog_write",
  "work_capsule_write",
  "work_capsule_adopt",
] as const;

export const ADMIN_MCP_TOKEN_SCOPES = [
  ...WRITE_MCP_TOKEN_SCOPES,
  "admin_read",
  "admin_write",
] as const;

// Backward-compatible name for the standard read-scoped coding-agent grant set.
export const CODING_AGENT_MCP_TOKEN_SCOPES = READ_MCP_TOKEN_SCOPES;

function requestedScopesForTier(tier: McpTokenScopeTier): readonly string[] {
  if (tier === "admin") return ADMIN_MCP_TOKEN_SCOPES;
  if (tier === "write") return WRITE_MCP_TOKEN_SCOPES;
  return READ_MCP_TOKEN_SCOPES;
}

export function defaultMcpTokenScopes(
  availableScopes: readonly string[],
  tier: McpTokenScopeTier = "read",
): string[] {
  const available = new Set(availableScopes);
  return requestedScopesForTier(tier).filter((scope) => available.has(scope));
}
