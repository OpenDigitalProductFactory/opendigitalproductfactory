import { prisma, type Prisma } from "@dpf/db";
import { can } from "@/lib/permissions";
import { resolveWorkforcePlatformRole } from "@/lib/govern/auth-utils";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { resolveServerOwnedAsyncOperationAuthority } from "@/lib/inference/async-operation-authority";
import type { SemanticReviewRequest } from "./semantic-review-request";

/** Re-evaluate durable actor references against current authority before dispatch. */
export async function verifySemanticReviewAuthority(packet: SemanticReviewRequest, taskRunId: string,
  db: Pick<Prisma.TransactionClient, "user" | "mcpApiToken" | "taskRun" | "workroom"> = prisma,
): Promise<boolean> {
  const { actor } = packet;
  const user = await db.user.findUnique({ where: { id: actor.userId },
    select: { isActive: true, isSuperuser: true, groups: { include: { platformRole: true } } } });
  if (!user?.isActive || !can({ userId: actor.userId, isSuperuser: user.isSuperuser,
    platformRole: resolveWorkforcePlatformRole(user.groups) }, "view_platform")) return false;

  if (actor.authSource === "pat") {
    if (!actor.apiTokenId) return false;
    const token = await db.mcpApiToken.findFirst({
      where: { id: actor.apiTokenId, userId: actor.userId, agentId: actor.agentId, revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { scope: true, capability: true, scopes: true },
    });
    const scope = token?.scope ?? token?.capability;
    if (!token || (scope !== "write" && scope !== "admin")
      || !isToolAllowedByGrants("review_semantic_change", token.scopes)) return false;
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
