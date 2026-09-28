import type { ExistingRemoteTask, RemoteTaskSubmitAuth } from "./mcp-task-submit";
import { prisma, type Prisma } from "@dpf/db";
import { isRecord } from "./shared/coerce";
import { isCurrentOAuthExecutionAuthority, OAUTH_EXECUTION_AUTHORITY_SELECT } from "./auth/oauth-tokens";
import { parseResourceWaitProjection } from "./mcp-task-capacity-contract";
import { sendMcpTaskRunExecutionEvent } from "./queue/mcp-task-run-events";

/** Only called after exact request, current caller and review admission checks. */
export async function recoverExpiredOAuthReview(
  existing: ExistingRemoteTask, token: RemoteTaskSubmitAuth,
): Promise<boolean> {
  const meta = isRecord(existing.a2aMetadata) ? existing.a2aMetadata : {};
  const progress = isRecord(existing.progressPayload) ? existing.progressPayload : {};
  const binding = isRecord(meta.initiativeReviewBinding) ? meta.initiativeReviewBinding : {};
  const wait = parseResourceWaitProjection(progress);
  if (existing.status !== "failed" || token.source !== "oauth" || meta.tokenSource !== "oauth"
    || existing.userId !== token.userId || progress.errorCode !== "authorization_revoked"
    || progress.oauthExpiryRecovery || progress.terminalWriterWait || progress.terminalWriterEscalation
    || !wait || !existing.completedAt || typeof meta.apiTokenId !== "string"
    || typeof binding.writerToolName !== "string") return false;
  const original = await prisma.mcpApiToken.findUnique({ where: { id: meta.apiTokenId },
    select: OAUTH_EXECUTION_AUTHORITY_SELECT });
  if (!original || original.userId !== token.userId || !original.oauthFamilyKey
    || meta.taskAuthorityKey !== `oauth-family:${original.oauthFamilyKey}`
    || !original.expiresAt || original.expiresAt > existing.completedAt
    || !await isCurrentOAuthExecutionAuthority(original)) return false;
  const [writer, envelope] = await Promise.all([
    prisma.toolExecution.findFirst({ where: { taskRunId: existing.taskRunId, toolName: binding.writerToolName }, select: { id: true } }),
    prisma.coworkerActionEnvelope.findFirst({ where: { taskRunId: existing.taskRunId }, select: { id: true } }),
  ]);
  if (writer || envelope) return false;
  const now = new Date();
  const priorDispatch = isRecord(progress.dispatch) ? progress.dispatch : {};
  const attempt = Number(priorDispatch.attempt);
  if (!Number.isSafeInteger(attempt) || attempt < 1) return false;
  const eventId = `mcp-task-run:${existing.taskRunId}:execute:${attempt + 1}`;
  const reserved = await prisma.taskRun.updateMany({ where: {
    taskRunId: existing.taskRunId, userId: token.userId, status: "failed", updatedAt: existing.updatedAt,
  }, data: {
    status: "submitted", completedAt: null,
    progressPayload: { ...progress,
      error: null, errorCode: null, summary: "Review recovery reserved with current connection authority.",
      resourceWait: { ...wait, nextAttemptAt: now.toISOString() },
      dispatch: { ...priorDispatch, schemaVersion: 1, kind: "external-mcp-task", state: "pending",
        attempt: attempt + 1, eventId, requestedAt: now.toISOString() },
      oauthExpiryRecovery: { priorStatus: "failed", priorCompletedAt: existing.completedAt.toISOString(),
        priorErrorCode: progress.errorCode, requestedAt: now.toISOString(), authenticatedTokenId: token.tokenId },
    } as Prisma.InputJsonValue,
  } });
  if (reserved.count !== 1) return false;
  // The persisted outbox remains authoritative if delivery fails. No attempt
  // counter is reset, and a second exact replay cannot reserve this failure.
  try { await sendMcpTaskRunExecutionEvent(existing.taskRunId, eventId); } catch { /* reconciler owns outbox */ }
  return true;
}
