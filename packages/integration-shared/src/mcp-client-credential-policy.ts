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
