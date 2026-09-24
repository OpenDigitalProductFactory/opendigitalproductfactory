import "server-only";

// The credential an approved request runs under (BI-12E5DD91, BI-9FD11E5E).
//
// A person's approval is spent by the platform on the assistant's behalf, so
// the platform must first prove that the connection which asked is still the
// one it was: live, the same person and assistant, still admitting the tool,
// and for OAuth, a consent that still names that assistant. A direct call and
// a task-bound call are approved the same way and run under the same rules, so
// both runners use this one check and this one execution context.
import { resolveOAuthConsent } from "@/lib/auth/oauth-identity-binding";
import { connectionDelegationFor } from "@/lib/mcp/connection-delegation";
import { normalizeTokenScope, tokenAdmitsTool } from "@/lib/mcp/token-tool-scope";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { expandGrants, getToolGrantMapping } from "@/lib/tak/agent-grants";

export type ApprovalCredential = {
  id: string; userId: string; agentId: string | null; kind: string; revokedAt: Date | null;
  scope: string; capability: string; scopes: string[]; publicScopes: string[];
  authorityBindingId: string | null; oauthClientId: string | null; resource: string | null;
};

export type ApprovalCredentialDb = {
  mcpApiToken: { findUnique(args: unknown): Promise<ApprovalCredential | null> };
};

export type ApprovalCredentialRefusal = "credential-unavailable" | "consent-changed" | "scope-insufficient";

/**
 * The originating credential, if it may still carry out this approved request;
 * otherwise the reason it may not.
 *
 * `assistantAgentId` is the assistant the call was made as. A direct call is
 * made as the credential's own assistant; a task runs as the platform coworker
 * it asked for, so a task passes null and only the credential itself is held
 * to what it was.
 */
export async function verifyApprovalCredential(
  db: ApprovalCredentialDb,
  tokenId: string,
  request: { delegatingUserId: string; assistantAgentId: string | null; manifestActionId: string },
): Promise<ApprovalCredential | ApprovalCredentialRefusal> {
  const token = await db.mcpApiToken.findUnique({ where: { id: tokenId } });
  if (
    !token
    || token.revokedAt
    || token.userId !== request.delegatingUserId
    || (request.assistantAgentId !== null && token.agentId !== request.assistantAgentId)
  ) {
    return "credential-unavailable";
  }
  if (token.kind === "oauth_access") {
    if (!token.authorityBindingId || !token.oauthClientId || !token.resource) return "consent-changed";
    const consent = await resolveOAuthConsent({
      bindingId: token.authorityBindingId, userId: token.userId,
      clientId: token.oauthClientId, resource: token.resource, scopes: token.publicScopes,
    });
    // The consent must still name the assistant this connection was given to.
    if (!consent || consent.agentId !== token.agentId) return "consent-changed";
  }
  const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === request.manifestActionId);
  if (!tokenAdmitsTool(tool, getToolGrantMapping()[request.manifestActionId], token)) {
    return "scope-insufficient";
  }
  return token;
}

/** The same execution context the MCP route builds for this credential. */
export function approvalExecutionContext(
  token: ApprovalCredential,
  agentId: string,
  callerClient = "approval-completion",
): NonNullable<GovernedExecuteArgs["context"]> {
  const oauth = token.kind === "oauth_access";
  return {
    agentId,
    apiTokenId: token.id,
    callerClient,
    authSource: oauth ? "oauth" : "pat",
    tokenScope: normalizeTokenScope(token),
    tokenGrantScopes: expandGrants(token.scopes),
    ...connectionDelegationFor({
      source: oauth ? "oauth" : "pat",
      agentId: token.agentId,
      authorityBindingId: token.authorityBindingId,
    }),
  };
}
