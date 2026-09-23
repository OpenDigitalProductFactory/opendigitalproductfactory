// BI-12E5DD91 — the one place an MCP request becomes connection-delegation
// steering. Only an OAuth access token whose consent binding the resolver
// accepted on this request, and which names an assistant, qualifies. A PAT, a
// session JWT, a client-credentials token or an unbound connection yields
// nothing, so the escalation gate sees `none` exactly as before.
import type { GovernedExecuteContext } from "@/lib/mcp-governed-execute";

export function connectionDelegationFor(token: {
  source?: string;
  agentId: string | null;
  authorityBindingId?: string | null;
  oauthIdentitySetupRequired?: boolean;
}): Pick<GovernedExecuteContext, "connectionDelegation"> {
  if (token.source !== "oauth") return {};
  if (token.oauthIdentitySetupRequired) return {};
  const authorityBindingId = token.authorityBindingId?.trim();
  const agentId = token.agentId?.trim();
  if (!authorityBindingId || !agentId) return {};
  return { connectionDelegation: { authorityBindingId, agentId } };
}
