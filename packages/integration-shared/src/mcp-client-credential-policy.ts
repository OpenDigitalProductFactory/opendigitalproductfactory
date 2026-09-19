/**
 * Whether a DPF MCP client config for `endpoint` must carry the bearer-header
 * fallback (BI-46B636B0).
 *
 * OAuth support is client-specific. Codex loopback OAuth is verified; other
 * clients retain their existing compatibility behavior until verified.
 * A generated configuration is not evidence of authenticated readiness.
 *
 * Both writers of the client config (the portal's setup snippets and the
 * toolchain bootstrap planner) consult this one predicate; the SessionStart
 * health hooks apply the same rule to diagnose a config that cannot
 * authenticate.
 */
export type McpClient = "codex" | "claude" | "vscode" | "grok" | "antigravity";
export type McpAuthMode = "oauth" | "legacy";

export function mcpClientBearerHeaderRequired(endpoint: string, client: McpClient = "claude", authMode: McpAuthMode = "oauth"): boolean {
  if (authMode === "legacy" || client === "grok") return true;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return true;
  }
  if (parsed.username || parsed.password) return true;
  if (parsed.protocol === "https:") return false;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  return !(client === "codex" && parsed.protocol === "http:" && loopback);
}

/**
 * The public OAuth scopes a DPF development client pins when it authorizes
 * over https (BI-3D2FD68C).
 *
 * The portal deliberately advertises only `dpf.read` in its protected-resource
 * metadata (the MCP spec's "minimal set for basic functionality"), and Claude
 * Code requests exactly the advertised scope when nothing is pinned.
 * Progressive disclosure then hides every write tool, so the designed
 * `insufficient_scope` step-up never fires: a client that only follows the
 * advertisement is read-only for good. The supported client-side answer is
 * the per-server `oauth.scopes` pin, which the consent screen lists as named
 * checkboxes the operator approves.
 *
 * The set is the smallest that covers platform-development work: backlog,
 * workroom, evidence and lease writes (`dpf.work`) and execution evidence
 * (`dpf.build`). `dpf.business`, `dpf.operate` and `dpf.admin` are consent
 * decisions an operator makes on purpose, never a default a bootstrap makes
 * for them. Every value must be a member of the portal's public scope
 * vocabulary; `apps/web/lib/auth/mcp-setup-snippets.test.ts` asserts that.
 *
 * Both writers of the Claude Code client config (the portal's setup snippets
 * and the toolchain bootstrap planner) consult this one constant, and the
 * skill pack's Python generator mirrors it.
 */
export const MCP_CLIENT_OAUTH_SCOPE_PIN = "dpf.read dpf.work dpf.build";

/**
 * The `oauth.scopes` value a client entry for `endpoint` carries: the pin when
 * the client is Claude Code and its credential path is OAuth (no bearer header
 * required for that client and mode), nothing otherwise. Only Claude Code
 * reads `oauth.scopes`; Codex, Grok, VS Code and Antigravity have no such
 * field, so a pin there would be noise at best and a parse error at worst.
 */
export function mcpClientOAuthScopePin(
  endpoint: string,
  client: McpClient = "claude",
  authMode: McpAuthMode = "oauth",
): string | null {
  if (client !== "claude") return null;
  return mcpClientBearerHeaderRequired(endpoint, client, authMode) ? null : MCP_CLIENT_OAUTH_SCOPE_PIN;
}
