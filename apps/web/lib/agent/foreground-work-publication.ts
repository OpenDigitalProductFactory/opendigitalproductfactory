import "server-only";
import { prisma, type Prisma } from "@dpf/db";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { isRecord } from "@/lib/shared/coerce";
import { captureTaskExecutionFence, sameTaskExecutionFence, taskExecutionEligible, type TaskExecutionFence } from "@/lib/shared/task-execution-fence";
import { createResourceWaitProjection } from "@/lib/mcp-task-capacity-contract";
import { foregroundExecutionContext } from "./foreground-work-context";
import { sanitizeFieldUpdates, type AgentFormAssistField } from "@/lib/agent-form-assist";

type Kind = "responded" | "approval-required" | "capacity-wait" | "blocked";
type Disposition = { kind: Kind; resourceWait?: Parameters<typeof createResourceWaitProjection>[0];
  formAssistUpdate?: Record<string, unknown>; systemMessageId?: string };
const stopped = () => new Error("Foreground publication is no longer admissible.");

/** Short writes share cancellation's TaskRun row lock, never an inference transaction. */
export async function withForegroundMutation<T>(write: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const scope = foregroundExecutionContext();
  if (!scope) return write(prisma);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${scope.taskRunId} FOR UPDATE`;
    const run = await tx.taskRun.findUnique({ where: { taskRunId: scope.taskRunId } });
    const metadata = isRecord(run?.a2aMetadata) ? run.a2aMetadata : null;
    const request = isRecord(metadata?.foregroundRequest) ? metadata.foregroundRequest : null;
    const deadline = Date.parse(scope.deadlineAt);
    if (!run || run.archivedAt || run.source !== "coworker" || run.userId !== scope.userId
      || run.threadId !== scope.threadId || run.initiatingAgentId !== scope.agentId
      || metadata?.trigger !== "interactive" || request?.schemaVersion !== 1 || request.deadlineAt !== scope.deadlineAt
      || !taskExecutionEligible({ status: run.status, progressPayload: run.progressPayload,
        requestDigest: metadata.requestDigest, executionFence: scope.fence })) throw stopped();
    const [human, thread] = await Promise.all([
      currentUserContext(scope.userId, tx),
      tx.agentThread.findUnique({ where: { id: scope.threadId }, select: { userId: true } }),
    ]);
    // Authority reads and lock waits may consume the original allowance.
    if (!human || thread?.userId !== scope.userId || !Number.isFinite(deadline) || Date.now() >= deadline) throw stopped();
    const result = await write(tx);
    if (Date.now() >= deadline) throw stopped(); // Roll back writes that cross the immutable deadline.
    return result;
  });
}

/** Message, result linkage and disposition are accepted in the same transaction. */
export async function publishForegroundMessage<T extends { id: string }>(
  write: (db: Prisma.TransactionClient) => Promise<T>, disposition?: Disposition,
): Promise<T> {
  const scope = foregroundExecutionContext();
  return withForegroundMutation(async db => {
    if (scope && disposition?.formAssistUpdate && JSON.stringify(disposition.formAssistUpdate).length > 50_000) throw stopped();
    const message = await write(db);
    if (!scope) return message;
    const persisted = await db.agentMessage.findUnique({ where: { id: message.id }, select: { threadId: true, taskRunId: true } });
    if (persisted?.threadId !== scope.threadId || persisted.taskRunId !== scope.taskRunId) throw stopped();
    if (!disposition) return message; // An auxiliary notice is not completion.
    const run = await db.taskRun.findUnique({ where: { taskRunId: scope.taskRunId } });
    const progress = isRecord(run?.progressPayload) ? run.progressPayload : {};
    const metadata = isRecord(run?.a2aMetadata) ? run.a2aMetadata : {};
    const request = isRecord(metadata.foregroundRequest) ? metadata.foregroundRequest : {};
    const extras = isRecord(request.extras) ? request.extras : {};
    const form = isRecord(extras.formAssistContext) ? extras.formAssistContext : {};
    let formAssistUpdate: Record<string, unknown> | null = null;
    if (disposition.formAssistUpdate) {
      if (typeof form.formId !== "string" || !form.formId || form.formId.length > 200 || !Array.isArray(form.fields)) throw stopped();
      const fields: AgentFormAssistField[] = form.fields.flatMap(field => isRecord(field) && typeof field.key === "string"
        && ["text", "textarea", "number", "select"].includes(String(field.type))
        ? [{ key: field.key, label: field.key, type: field.type as AgentFormAssistField["type"] }] : []);
      formAssistUpdate = sanitizeFieldUpdates(disposition.formAssistUpdate, fields);
      if (!formAssistUpdate) throw stopped();
    }
    const attempt = progress.foregroundAttempt;
    if (!Number.isSafeInteger(attempt) || Number(attempt) < 1) throw stopped();
    const pending = disposition.kind === "capacity-wait" && disposition.resourceWait
      ? createResourceWaitProjection(disposition.resourceWait, Number(attempt)) : null;
    if (disposition.kind === "capacity-wait" && !pending) throw stopped();
    const summary = pending
      ? "Your request is retained. DPF will retry when provider capacity permits, within its original recovery window. You do not need to resend."
      : disposition.kind === "approval-required" ? "The proposed action is waiting for your approval in this conversation."
      : disposition.kind === "responded" ? "Coworker response saved. Business-result acceptance is separate."
      : "Your request is retained but needs attention before it can continue.";
    const acceptedAt = new Date();
    const retainedContent = pending ? `${summary}\n\nJob: ${scope.taskRunId}` : null;
    if (retainedContent) {
      const updated = await db.agentMessage.updateMany({ where: { id: message.id, threadId: scope.threadId, taskRunId: scope.taskRunId, role: "system" }, data: { content: retainedContent } });
      if (updated.count !== 1) throw stopped();
    }
    if (disposition.systemMessageId) {
      const notice = await db.agentMessage.findUnique({ where: { id: disposition.systemMessageId }, select: { taskRunId: true, threadId: true, role: true } });
      if (notice?.taskRunId !== scope.taskRunId || notice.threadId !== scope.threadId || notice.role !== "system") throw stopped();
    }
    const saved = await db.taskRun.updateMany({ where: { taskRunId: scope.taskRunId, status: "working" }, data: {
      status: disposition.kind === "responded" ? "completed" : "input-required",
      completedAt: disposition.kind === "responded" ? acceptedAt : null,
      progressPayload: { ...progress, ...(pending ? { resourceWait: pending } : {}),
        foregroundOutcome: disposition.kind, summary, nextActor: pending ? "platform" : "owner", resultMessageId: message.id,
        foregroundPublication: { schemaVersion: 1, messageId: message.id, kind: disposition.kind,
          acceptedAt: acceptedAt.toISOString(), executionFence: scope.fence,
          ...(formAssistUpdate ? { formAssistUpdate, formAssistFormId: form.formId } : {}),
          ...(disposition.systemMessageId ? { systemMessageId: disposition.systemMessageId } : {}),
        },
        ...(disposition.kind === "blocked" ? { executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown", observedAt: acceptedAt.toISOString() } } : {}),
      } as Prisma.InputJsonValue,
    } });
    if (saved.count !== 1) throw stopped();
    return retainedContent ? { ...message, content: retainedContent } : message;
  });
}

/** A committed response survives worker-return interruption; this never dispatches or revives a task. */
export async function readForegroundPublication(taskRunId: string, fence: TaskExecutionFence | null, messageId?: string) {
  const run = await prisma.taskRun.findUnique({ where: { taskRunId } });
  const progress = isRecord(run?.progressPayload) ? run.progressPayload : {};
  const metadata = isRecord(run?.a2aMetadata) ? run.a2aMetadata : {};
  const request = isRecord(metadata.foregroundRequest) ? metadata.foregroundRequest : {};
  const publication = isRecord(progress.foregroundPublication) ? progress.foregroundPublication : null;
  if (!run || run.archivedAt || publication?.schemaVersion !== 1 || typeof publication.messageId !== "string"
    || (messageId && publication.messageId !== messageId) || progress.resultMessageId !== publication.messageId
    || !sameTaskExecutionFence(fence, publication.executionFence)
    || !sameTaskExecutionFence(fence, captureTaskExecutionFence(progress, metadata.requestDigest))
    || typeof publication.acceptedAt !== "string" || typeof request.deadlineAt !== "string"
    || !Number.isFinite(Date.parse(publication.acceptedAt)) || !Number.isFinite(Date.parse(request.deadlineAt))
    || Date.parse(publication.acceptedAt) >= Date.parse(request.deadlineAt)) return null;
  const [human, thread] = await Promise.all([
    currentUserContext(run.userId),
    prisma.agentThread.findUnique({ where: { id: run.threadId ?? "" }, select: { userId: true } }),
  ]);
  if (!human || thread?.userId !== run.userId) return null;
  if (isRecord(publication.formAssistUpdate)) {
    const extras = isRecord(request.extras) ? request.extras : {};
    const form = isRecord(extras.formAssistContext) ? extras.formAssistContext : {};
    if (typeof publication.formAssistFormId !== "string" || publication.formAssistFormId !== form.formId) return null;
  }
  const kind = publication.kind;
  if (!["responded", "approval-required", "capacity-wait", "blocked"].includes(String(kind))
    || run.status !== (kind === "responded" ? "completed" : "input-required") || progress.foregroundOutcome !== kind) return null;
  const message = await prisma.agentMessage.findUnique({ where: { id: publication.messageId }, select: { threadId: true, taskRunId: true, role: true } });
  if (publication.systemMessageId) {
    if (typeof publication.systemMessageId !== "string") return null;
    const notice = await prisma.agentMessage.findUnique({ where: { id: publication.systemMessageId }, select: { taskRunId: true, threadId: true, role: true } });
    if (notice?.taskRunId !== taskRunId || notice.threadId !== run.threadId || notice.role !== "system") return null;
  }
  return message?.threadId === run.threadId && message.taskRunId === taskRunId
    && (kind === "approval-required" ? message.role === "assistant" : kind === "capacity-wait" ? message.role === "system" : ["assistant", "system"].includes(message.role))
    ? { kind: kind as Kind, agentMessageId: publication.messageId,
      ...(isRecord(publication.formAssistUpdate) ? { formAssistUpdate: publication.formAssistUpdate } : {}),
      ...(typeof publication.formAssistFormId === "string" ? { formAssistFormId: publication.formAssistFormId } : {}),
      ...(typeof publication.systemMessageId === "string" ? { systemMessageId: publication.systemMessageId } : {}),
    } : null;
}
