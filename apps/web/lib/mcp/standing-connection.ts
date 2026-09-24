import "server-only";

// A person's own live connection, for work the platform does on their behalf
// without a fresh approval (BI-A835D300).
//
// When the platform sends a request an author's client would have sent, it
// sends it through that author's newest connection that queued work may still
// continue on (isCurrentOAuthExecutionAuthority: the client, the person, the
// consent and a current or rotated access token are all still live), and only
// when that connection admits the tool. The execution context is the one the
// MCP route builds, so every check that applies to the client applies here.
import { prisma } from "@dpf/db";

import {
  isCurrentOAuthExecutionAuthority,
  OAUTH_EXECUTION_AUTHORITY_SELECT,
} from "@/lib/auth/oauth-tokens";
import { approvalExecutionContext, type ApprovalCredential } from "@/lib/coworker/approved-request-credential";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { tokenAdmitsTool } from "@/lib/mcp/token-tool-scope";
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import type { UserContext } from "@/lib/permissions";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";

export type StandingConnection = {
  token: ApprovalCredential;
  userContext: UserContext;
  context: NonNullable<GovernedExecuteArgs["context"]>;
};

export async function findStandingConnection(
  userId: string,
  agentId: string,
  toolName: string,
  callerClient: string,
): Promise<StandingConnection | null> {
  const rows = await prisma.mcpApiToken.findMany({
    where: { kind: "oauth_access", userId, agentId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { ...OAUTH_EXECUTION_AUTHORITY_SELECT, id: true, scope: true, capability: true, scopes: true },
  });
  const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === toolName);
  for (const row of rows) {
    if (!tokenAdmitsTool(tool, getToolGrantMapping()[toolName], row)) continue;
    if (!await isCurrentOAuthExecutionAuthority(row)) continue;
    const userContext = await currentUserContext(userId);
    if (!userContext) return null;
    const token = row as ApprovalCredential;
    return { token, userContext, context: approvalExecutionContext(token, agentId, callerClient) };
  }
  return null;
}
