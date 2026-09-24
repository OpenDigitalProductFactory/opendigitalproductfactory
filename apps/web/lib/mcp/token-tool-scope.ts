// What an MCP credential's scope admits, in one place (BI-12E5DD91).
//
// The MCP route checks this on every tools/call; the approved-request runner
// re-checks it when a person's approval finally lets a parked external call
// run. Two private copies of this rule would drift, and the second one is the
// one a later scope change would miss.
import type { McpTokenScope } from "@/lib/auth/mcp-api-token";
import type { ToolDefinition } from "@/lib/mcp-tools";
import { expandGrants } from "@/lib/tak/agent-grants";

export function normalizeTokenScope(token: { scope: string; capability: string }): McpTokenScope {
  if (token.scope === "admin" || token.scope === "write" || token.scope === "read") {
    return token.scope;
  }
  return token.capability === "write" ? "write" : "read";
}

export function requiredTokenScopeForTool(
  tool: ToolDefinition | undefined,
  requiredGrants: readonly string[],
): McpTokenScope {
  if (requiredGrants.some((grant) => grant.startsWith("admin_"))) return "admin";
  return tool?.sideEffect ? "write" : "read";
}

export function tokenScopeSatisfies(actual: McpTokenScope, required: McpTokenScope): boolean {
  if (required === "read") return true;
  if (required === "write") return actual === "write" || actual === "admin";
  return actual === "admin";
}

/**
 * Whether the credential's coarse scope and granular grants both admit the
 * tool. Grants are expanded through GRANT_IMPLICATIONS, so an implying grant
 * satisfies the finer grant it implies, exactly as the agent-grant layer does.
 */
export function tokenAdmitsTool(
  tool: ToolDefinition | undefined,
  requiredGrants: readonly string[] | undefined,
  token: { scope: string; capability: string; scopes: readonly string[] },
): boolean {
  if (!requiredGrants?.length) return false;
  if (!tokenScopeSatisfies(normalizeTokenScope(token), requiredTokenScopeForTool(tool, requiredGrants))) {
    return false;
  }
  const expanded = expandGrants([...token.scopes]);
  return requiredGrants.some((grant) => expanded.includes(grant));
}
