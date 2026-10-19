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
import type { GovernedExecuteArgs } from "@/lib/mcp-governed-execute-types";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import type { UserContext } from "@/lib/permissions";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";

export type StandingConnection = {
  token: ApprovalCredential;
  userContext: UserContext;
  context: NonNullable<GovernedExecuteArgs["context"]>;
};

type StandingConnectionRow = Awaited<ReturnType<typeof loadCandidateRows>>[number];

async function loadCandidateRows(where: { userId: string; agentId?: string }, take: number) {
  return prisma.mcpApiToken.findMany({
    where: { kind: "oauth_access", revokedAt: null, ...where },
    orderBy: { createdAt: "desc" },
    take,
    select: { ...OAUTH_EXECUTION_AUTHORITY_SELECT, id: true, scope: true, capability: true, scopes: true },
  });
}

async function firstLiveConnection(
  rows: readonly StandingConnectionRow[],
  userId: string,
  toolName: string,
  callerClient: string,
): Promise<StandingConnection | null> {
  const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === toolName);
  for (const row of rows) {
    if (!tokenAdmitsTool(tool, getToolGrantMapping()[toolName], row)) continue;
    if (!await isCurrentOAuthExecutionAuthority(row)) continue;
    const userContext = await currentUserContext(userId);
    if (!userContext) return null;
    const token = row as ApprovalCredential;
    // The connection's own assistant carries the request; a row without one
    // cannot delegate and is skipped by the admission check above.
    return { token, userContext, context: approvalExecutionContext(token, row.agentId ?? "", callerClient) };
  }
  return null;
}

export async function findStandingConnection(
  userId: string,
  agentId: string,
  toolName: string,
  callerClient: string,
): Promise<StandingConnection | null> {
  return firstLiveConnection(await loadCandidateRows({ userId, agentId }, 5), userId, toolName, callerClient);
}

/**
 * BI-926A7E90 §4: a Build Studio room's assistant is the admitted Build Studio
 * coworker, which holds no OAuth connection of its own. The platform then sends
 * on ANY live connection of the room's requesting user that admits the tool,
 * newest first, preferring the assistants named in `preferAgentIds` (the
 * operator's external CLIs) so the audit trail stays predictable. The returned
 * context names the connection's own agent, so the room can record which
 * assistant carried the request. No grant is widened: `request_coworker` still
 * intersects the reviewer's grants with the person's capabilities at execution.
 */
export async function findStandingConnectionForUser(
  userId: string,
  toolName: string,
  callerClient: string,
  options: { preferAgentIds?: readonly string[] } = {},
): Promise<StandingConnection | null> {
  const rows = await loadCandidateRows({ userId }, 10);
  const preferred = options.preferAgentIds ?? [];
  const rank = (row: StandingConnectionRow) => {
    const index = row.agentId ? preferred.indexOf(row.agentId) : -1;
    return index === -1 ? preferred.length : index;
  };
  const ordered = [...rows].sort((left, right) => rank(left) - rank(right));
  return firstLiveConnection(ordered.filter((row) => Boolean(row.agentId)), userId, toolName, callerClient);
}
