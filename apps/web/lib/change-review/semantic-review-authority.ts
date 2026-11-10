import { prisma, type Prisma } from "@dpf/db";
import { can } from "@/lib/permissions";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { AsyncOperationAuthorizationError, resolveServerOwnedAsyncOperationAuthority } from "@/lib/inference/async-operation-authority";
import { inspectOAuthExecutionAuthority, OAUTH_EXECUTION_AUTHORITY_SELECT, type OAuthExecutionAuthorityDetail } from "@/lib/auth/oauth-tokens";
import type { SemanticReviewRequest } from "./semantic-review-request";

type AuthorityDatabase = Pick<Prisma.TransactionClient, "user" | "mcpApiToken" | "taskRun" | "workroom" | "agent" | "authorityBinding" | "oAuthRefreshToken">;
export type SemanticReviewAuthorityObservation = {
  detail?: OAuthExecutionAuthorityDetail;
  state: "allowed" | "denied" | "unavailable";
  reason: "authority-current" | "human-capability-denied" | "saved-token-unavailable"
    | "saved-token-scope-denied" | "oauth-authority-invalid" | "auth-source-unsupported"
    | "coworker-grant-denied" | "task-authority-denied" | "task-authority-unavailable";
};

/** Fixed categories only. Query errors propagate; observers must report unavailable. */
export async function inspectSemanticReviewAuthority(packet: SemanticReviewRequest, taskRunId: string,
  db: AuthorityDatabase = prisma,
): Promise<SemanticReviewAuthorityObservation> {
  const { actor } = packet;
  const user = await currentUserContext(actor.userId, db);
  if (!user || !can(user, "view_platform")) return { state: "denied", reason: "human-capability-denied" };

  if (actor.authSource === "pat" || actor.authSource === "oauth") {
    if (!actor.apiTokenId) return { state: "denied", reason: "saved-token-unavailable" };
    const token = await db.mcpApiToken.findFirst({
      where: { id: actor.apiTokenId, userId: actor.userId, agentId: actor.agentId, revokedAt: null,
        ...(actor.authSource === "oauth" ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }) },
      select: { scope: true, capability: true, scopes: true, ...OAUTH_EXECUTION_AUTHORITY_SELECT },
    });
    const scope = token?.scope ?? token?.capability;
    if (!token) return { state: "denied", reason: "saved-token-unavailable" };
    if ((scope !== "write" && scope !== "admin")
      || !isToolAllowedByGrants("review_semantic_change", token.scopes)) return { state: "denied", reason: "saved-token-scope-denied" };
    // Audience was checked on admission; this immutable actor names that same
    // token row. Recheck current human, consent and client authority before work.
    if (actor.authSource === "oauth") {
      const observation = await inspectOAuthExecutionAuthority(token, db);
      if (!observation.allowed) return { state: "denied", reason: "oauth-authority-invalid", detail: observation.detail };
    }
  } else if (actor.authSource !== null && actor.authSource !== "session-jwt") {
    return { state: "denied", reason: "auth-source-unsupported" };
  }
  if (actor.agentId && !isToolAllowedByGrants("review_semantic_change",
    await getAgentToolGrantsAsync(actor.agentId))) return { state: "denied", reason: "coworker-grant-denied" };
  try {
    await resolveServerOwnedAsyncOperationAuthority({ db,
      target: { kind: "task-run", taskRunId },
      actor: { userId: actor.userId, agentId: actor.agentId, principalId: null, isSuperuser: user.isSuperuser },
    });
    return { state: "allowed", reason: "authority-current" };
  } catch (error) {
    return error instanceof AsyncOperationAuthorizationError
      ? { state: "denied", reason: "task-authority-denied" }
      : { state: "unavailable", reason: "task-authority-unavailable" };
  }
}

/** Preserve execution's original boolean and exception behavior; diagnosis grants nothing. */
export async function verifySemanticReviewAuthority(packet: SemanticReviewRequest, taskRunId: string,
  db: AuthorityDatabase = prisma,
): Promise<boolean> {
  return (await inspectSemanticReviewAuthority(packet, taskRunId, db)).state === "allowed";
}
