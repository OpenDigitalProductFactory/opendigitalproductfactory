// BI-12E5DD91 — the one place an MCP request becomes connection-delegation
// steering. Only an OAuth access token whose consent binding the resolver
// accepted on this request, and which names an assistant, qualifies. A PAT, a
// session JWT or an unbound connection yields nothing, so the escalation gate
// sees `none` exactly as before. A client-credentials token qualifies only
// when the operator bound the client to an approved assistant and the token
// carries that consent binding (BI-79D26E39).
import type { GovernedExecuteContext } from "@/lib/mcp-governed-execute-types";

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
