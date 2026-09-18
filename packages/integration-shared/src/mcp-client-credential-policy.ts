/**
 * Whether a DPF MCP client config for `endpoint` must carry the bearer-header
 * fallback (BI-46B636B0).
 *
 * The MCP client runs OAuth only over https; on a plain-http endpoint the
 * authorization server is unreachable from the client no matter how healthy
 * it is server-side, and a pinned `headers.Authorization` disables OAuth. So
 * the two are exclusive and the URL scheme decides:
 *   - https  → no header; the client discovers the AS and authorizes itself.
 *   - http   → the `${DPF_MCP_BEARER_TOKEN}` header reference is the ONLY
 *              credential path; omitting it leaves the install with none.
 *
 * Both writers of the client config (the portal's setup snippets and the
 * toolchain bootstrap planner) consult this one predicate; the SessionStart
 * health hooks apply the same rule to diagnose a config that cannot
 * authenticate.
 */
export function mcpClientBearerHeaderRequired(endpoint: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return true;
  }
  return parsed.protocol !== "https:";
}
