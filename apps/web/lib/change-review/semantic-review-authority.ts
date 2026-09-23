import { prisma, type Prisma } from "@dpf/db";
import { can } from "@/lib/permissions";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { resolveServerOwnedAsyncOperationAuthority } from "@/lib/inference/async-operation-authority";
import { isCurrentOAuthExecutionAuthority, OAUTH_EXECUTION_AUTHORITY_SELECT } from "@/lib/auth/oauth-tokens";
import type { SemanticReviewRequest } from "./semantic-review-request";

/** Re-evaluate durable actor references against current authority before dispatch. */
export async function verifySemanticReviewAuthority(packet: SemanticReviewRequest, taskRunId: string,
  db: Pick<Prisma.TransactionClient, "user" | "mcpApiToken" | "taskRun" | "workroom" | "agent" | "authorityBinding"> = prisma,
): Promise<boolean> {
  const { actor } = packet;
  const user = await currentUserContext(actor.userId, db);
  if (!user || !can(user, "view_platform")) return false;

  if (actor.authSource === "pat" || actor.authSource === "oauth") {
    if (!actor.apiTokenId) return false;
    const token = await db.mcpApiToken.findFirst({
      where: { id: actor.apiTokenId, userId: actor.userId, agentId: actor.agentId, revokedAt: null,
        ...(actor.authSource === "oauth" ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }) },
      select: { scope: true, capability: true, scopes: true, ...OAUTH_EXECUTION_AUTHORITY_SELECT },
    });
    const scope = token?.scope ?? token?.capability;
    if (!token || (scope !== "write" && scope !== "admin")
      || !isToolAllowedByGrants("review_semantic_change", token.scopes)) return false;
    // Audience was checked on admission; this immutable actor names that same
    // token row. Recheck current human, consent and client authority before work.
    if (actor.authSource === "oauth" && !await isCurrentOAuthExecutionAuthority(token, db)) return false;
  } else if (actor.authSource !== null && actor.authSource !== "session-jwt") {
    return false;
  }
  if (actor.agentId && !isToolAllowedByGrants("review_semantic_change",
    await getAgentToolGrantsAsync(actor.agentId))) return false;
  try {
    await resolveServerOwnedAsyncOperationAuthority({ db,
      target: { kind: "task-run", taskRunId },
      actor: { userId: actor.userId, agentId: actor.agentId, principalId: null, isSuperuser: user.isSuperuser },
    });
    return true;
  } catch { return false; }
}
