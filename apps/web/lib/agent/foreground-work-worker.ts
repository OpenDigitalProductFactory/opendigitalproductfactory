import "server-only";
import { prisma, type Prisma } from "@dpf/db";
import { randomUUID } from "node:crypto";
import { isRecord } from "@/lib/shared/coerce";
import { agentEventBus } from "@/lib/agent-event-bus";
import { withForegroundWork } from "./foreground-work-context";
import { createResourceWaitProjection, parseResourceWaitProjection, resourceWaitDue, RESOURCE_WAIT_MAX_ATTEMPTS } from "@/lib/mcp-task-capacity-contract";

import { foregroundRequestDigest } from "./foreground-request-digest";
import { FOREGROUND_WORK_EVENT, FOREGROUND_BUILD_HANDOFF_BLOCKED } from "./foreground-work-contract";
import { hasExecutionUncertainty } from "@/lib/shared/execution-uncertainty";
import { captureTaskExecutionFence } from "@/lib/shared/task-execution-fence";
import { readForegroundPublication } from "./foreground-work-publication";

const uncertain = () => ({ schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown", observedAt: new Date().toISOString() });
function deliverPublication(threadId: string, taskRunId: string, saved: NonNullable<Awaited<ReturnType<typeof readForegroundPublication>>>) {
  agentEventBus.emit(threadId, { type: "done", agentMessageId: saved.agentMessageId,
    ...(saved.formAssistUpdate ? { formAssistUpdate: saved.formAssistUpdate, formAssistFormId: saved.formAssistFormId, taskRunId } : {}),
    ...(saved.systemMessageId ? { systemMessageId: saved.systemMessageId } : {}),
  });
}

async function retainNotice(run: { taskRunId: string; threadId: string | null; routeContext: string | null }, content: string) {
  if (!run.threadId) return;
  const id = `foreground-attention-${run.taskRunId}`;
  await prisma.agentMessage.upsert({ where: { id },
    create: { id, threadId: run.threadId, routeContext: run.routeContext, taskRunId: run.taskRunId, role: "system", content },
    update: { content },
  });
}

type BlockableRun = { id: string; taskRunId: string; status: string; updatedAt: Date; threadId: string | null; routeContext: string | null };
async function blockRetainedWork(run: BlockableRun, progress: Record<string, unknown>, summary: string) {
  const { resourceWait: _wait, ...retained } = progress;
  const saved = await prisma.taskRun.updateMany({ where: { id: run.id, status: run.status, updatedAt: run.updatedAt }, data: {
    status: "input-required", progressPayload: { ...retained, foregroundOutcome: "blocked", summary, nextActor: "owner" } as Prisma.InputJsonValue,
  } });
  if (saved.count === 1) await retainNotice(run, `Your request is retained. ${summary}`);
  return { kind: "blocked" };
}
const invalidCapacitySummary = "The retained capacity state needs reconciliation before another attempt.";

/** Execute one fenced generation. Unknown outcomes are held, never replayed. */
export async function executeForegroundWork(taskRunId: string) {
  const run = await prisma.taskRun.findUnique({ where: { taskRunId } });
  const metadata = isRecord(run?.a2aMetadata) ? run.a2aMetadata : null;
  const request = isRecord(metadata?.foregroundRequest) ? metadata.foregroundRequest : null;
  if (!run || run.source !== "coworker" || metadata?.trigger !== "interactive" || request?.schemaVersion !== 1) return { kind: "not-foreground" };
  if (run.archivedAt) return { kind: "not-due" };
  const progress = isRecord(run.progressPayload) ? run.progressPayload : {};
  if (run.status === "completed") {
    const published = await readForegroundPublication(taskRunId, captureTaskExecutionFence(progress, metadata?.requestDigest));
    if (!published || !run.threadId) return { kind: "not-due" };
    deliverPublication(run.threadId, taskRunId, published);
    return { kind: published.kind };
  }
  const wait = parseResourceWaitProjection(progress);
  if (run.status !== "submitted" && !(run.status === "input-required" && "resourceWait" in progress)) return { kind: "not-due" };
  const now = new Date();
  const block = (summary: string) => blockRetainedWork(run, progress, summary);
  if ("resourceWait" in progress && !wait) return block(invalidCapacitySummary);
  if (hasExecutionUncertainty(progress)) return block("The existing execution needs reconciliation before another attempt.");
  if (!run.threadId || !run.routeContext || !run.initiatingAgentId) return block("The retained request has incomplete execution identity. Reconcile its original conversation.");
  const deadline = typeof request.deadlineAt === "string" ? Date.parse(request.deadlineAt) : NaN;
  if (!Number.isFinite(deadline) || deadline <= now.getTime() || (wait?.attempt ?? 0) >= RESOURCE_WAIT_MAX_ATTEMPTS) {
    return block("The recovery window ended. Your request is retained; a provider recovery decision is needed.");
  }
  if (wait && !resourceWaitDue(wait, now)) return { kind: "not-due" };
  const message = await prisma.agentMessage.findFirst({
    where: { id: String(request.userMessageId), threadId: run.threadId, taskRunId, role: "user" },
    select: { id: true, content: true },
  });
  if (!message) return block("The retained job no longer matches its original message. Reconcile the conversation before retrying.");
  const extras = isRecord(request.extras) ? request.extras : {};
  const coworkerMode = request.coworkerMode === "act" ? "act" : "advise";
  if (foregroundRequestDigest({ userId: run.userId, agentId: run.initiatingAgentId,
    threadId: run.threadId, userMessageId: message.id, routeContext: run.routeContext,
    content: message.content, coworkerMode, extras, deadlineAt: String(request.deadlineAt) }) !== metadata?.requestDigest) {
    return block("The retained request changed after admission. Review the original scope before continuing.");
  }
  const claim = randomUUID();
  const activeProgress = { foregroundAttempt: (wait?.attempt ?? 0) + 1, dispatch: { claimedAt: claim }, summary: "The coworker is working on your retained request." };
  const acquired = await prisma.taskRun.updateMany({
    where: { id: run.id, status: run.status, updatedAt: run.updatedAt },
    data: { status: "working", startedAt: now, lastHeartbeatAt: now, progressPayload: activeProgress },
  });
  if (acquired.count !== 1) return { kind: "busy" };
  const settle = (status: string, payload: Prisma.InputJsonValue) => prisma.taskRun.updateMany({
    where: { id: run.id, status: "working", progressPayload: { path: ["dispatch", "claimedAt"], equals: claim } },
    data: { status, progressPayload: payload, ...(status === "completed" ? { completedAt: new Date() } : {}) },
  });
  agentEventBus.clearCancel(run.threadId);
  agentEventBus.markActive(run.threadId);
  const executionFence = captureTaskExecutionFence(activeProgress, metadata?.requestDigest);
  const acceptedPublication = async (messageId?: string) => {
    const saved = await readForegroundPublication(taskRunId, executionFence, messageId);
    if (!saved) return null;
    deliverPublication(run.threadId!, taskRunId, saved);
    return { kind: saved.kind };
  };
  let turnStarted = false;
  try {
    const { sendMessage } = await import("@/lib/actions/agent-coworker");
    const result = await withForegroundWork(taskRunId, () => {
      turnStarted = true;
      return sendMessage({
      ...extras,
      threadId: run.threadId!, routeContext: run.routeContext!, content: message.content,
      acceptedUserMessageId: message.id, coworkerMode,
      });
    }, executionFence);
    const published = await acceptedPublication("agentMessage" in result ? result.agentMessage.id : undefined);
    if (published) return published;
    if ("error" in result) {
      const buildHandoff = result.error === FOREGROUND_BUILD_HANDOFF_BLOCKED;
      const summary = buildHandoff ? result.error : "The retained request could not execute under current authority. Review its conversation before retrying.";
      const saved = await settle("input-required", { ...activeProgress, foregroundOutcome: "blocked", summary, nextActor: buildHandoff ? "platform" : "owner" });
      if (saved.count !== 1) return { kind: "superseded" };
      await retainNotice(run, summary);
      agentEventBus.emit(run.threadId, { type: "done", error: "The request is retained but could not execute." });
      return { kind: "blocked" };
    }
    const pending = result.resourceWait ? createResourceWaitProjection(result.resourceWait, activeProgress.foregroundAttempt) : null;
    const awaitingApproval = result.pendingApproval === true;
    const completed = !pending && !awaitingApproval && result.agentMessage.role === "assistant";
    const summary = pending
      ? "Your request is retained. DPF will retry when provider capacity permits, within its original recovery window. You do not need to resend."
      : awaitingApproval ? "The proposed action is waiting for your approval in this conversation."
      : completed ? "Coworker response saved. Business-result acceptance is separate." : "Your request is retained but needs attention before it can continue.";
    const saved = await settle(completed ? "completed" : pending ? "submitted" : "input-required", {
      ...activeProgress,
      ...(pending ? { resourceWait: pending } : {}),
      foregroundOutcome: pending ? "capacity-wait" : awaitingApproval ? "approval-required" : completed ? "responded" : "blocked",
      ...(!pending && !completed && !awaitingApproval ? { executionUncertainty: uncertain() } : {}),
      summary, nextActor: pending ? "platform" : "owner", resultMessageId: result.agentMessage.id,
    } as Prisma.InputJsonValue);
    if (saved.count !== 1) return { kind: "superseded" };
    if (pending) await prisma.agentMessage.updateMany({
      where: { id: result.agentMessage.id, threadId: run.threadId, taskRunId, role: "system" },
      data: { content: `${summary}\n\nJob: ${taskRunId}` },
    });
    agentEventBus.emit(run.threadId, { type: "done", agentMessageId: result.agentMessage.id,
      ...(result.systemMessage ? { systemMessageId: result.systemMessage.id } : {}),
      ...(result.formAssistUpdate ? { formAssistUpdate: result.formAssistUpdate } : {}),
    });
    return { kind: pending ? "capacity-wait" : awaitingApproval ? "approval-required" : completed ? "responded" : "blocked" };
  } catch {
    const published = await acceptedPublication().catch(() => null);
    if (published) return published;
    const summary = turnStarted ? "Execution stopped without a confirmed outcome. The request is retained; reconcile existing results before retrying." : "Current execution authority is unavailable. The request remains saved.";
    const saved = await settle("input-required", { ...activeProgress, foregroundOutcome: turnStarted ? "execution-uncertain" : "blocked",
      ...(turnStarted ? { executionUncertainty: uncertain() } : {}),
      summary, nextActor: "owner" });
    if (saved.count !== 1) return { kind: "superseded" };
    await retainNotice(run, summary);
    agentEventBus.emit(run.threadId, { type: "done", error: turnStarted ? "Your request is retained. Its execution outcome needs reconciliation." : "Your request is retained. Current execution authority needs attention." });
    return { kind: turnStarted ? "execution-uncertain" : "blocked" };
  } finally {
    agentEventBus.markIdle(run.threadId);
  }
}

/** The existing queue reconciles lost wakes and due waits from retained rows. */
export async function reconcileForegroundWork() {
  const { jobs } = await import("@/lib/jobs");
  const now = new Date();
  const nowIso = now.toISOString();
  const interrupted = await prisma.taskRun.findMany({ where: { source: "coworker", status: { in: ["working", "stalled"] }, archivedAt: null,
    AND: [ { a2aMetadata: { path: ["foregroundRequest", "schemaVersion"], equals: 1 } },
      { a2aMetadata: { path: ["foregroundRequest", "deadlineAt"], lte: new Date().toISOString() } } ],
  }, orderBy: { updatedAt: "asc" }, take: 50, select: { id: true, taskRunId: true, threadId: true, routeContext: true, status: true, updatedAt: true, progressPayload: true } });
  for (const row of interrupted) {
    if (row.status !== "working" && row.status !== "stalled") continue;
    const result = await prisma.taskRun.updateMany({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt }, data: {
      status: "input-required", completedAt: null, progressPayload: { foregroundOutcome: "execution-uncertain", executionUncertainty: uncertain(), nextActor: "owner", summary: "The execution window ended without a confirmed outcome. Reconcile existing results before retrying." },
    } });
    if (result.count === 1) await retainNotice(row, "Your request is retained, but execution ended without a confirmed outcome. Existing results must be checked before another attempt.");
  }
  // Older projections used Date.parse, including non-ISO strings. Converge a
  // bounded batch before SQL eligibility; preserve that meaning and every fence.
  // A separate ready lane prevents fifty future legacy waits starving new work.
  const isoPattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$";
  type RetryRow = BlockableRun & { progressPayload: Prisma.JsonValue; a2aMetadata: Prisma.JsonValue };
  const legacy = await prisma.$queryRaw<RetryRow[]>`
    SELECT "id", "taskRunId", "status", "updatedAt", "threadId", "routeContext", "progressPayload", "a2aMetadata" FROM "TaskRun"
    WHERE "source" = 'coworker' AND "archivedAt" IS NULL
      AND "status" IN ('submitted', 'input-required')
      AND "a2aMetadata" #> '{foregroundRequest,schemaVersion}' = '1'::jsonb
      AND "a2aMetadata" ->> 'trigger' = 'interactive'
      AND "progressPayload" #>> '{resourceWait,kind}' = 'provider-capacity'
      AND "progressPayload" #>> '{resourceWait,nextAttemptAt}' IS NOT NULL
      AND NOT COALESCE(
        jsonb_typeof("progressPayload" #> '{resourceWait,nextAttemptAt}') = 'string'
        AND "progressPayload" #>> '{resourceWait,nextAttemptAt}' ~ ${isoPattern}
        AND pg_input_is_valid("progressPayload" #>> '{resourceWait,nextAttemptAt}', 'timestamptz'), false)
    ORDER BY "createdAt", "id" LIMIT 50
  `;
  for (const row of legacy) {
    const wait = parseResourceWaitProjection(row.progressPayload);
    if (!wait) {
      if (isRecord(row.progressPayload)) await blockRetainedWork(row, row.progressPayload, invalidCapacitySummary);
      continue;
    }
    const nextAttemptAt = resourceWaitDue(wait, now) ? nowIso : new Date(Date.parse(wait.nextAttemptAt!)).toISOString();
    await prisma.taskRun.updateMany({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
      data: { progressPayload: { ...(row.progressPayload as Prisma.JsonObject), resourceWait: { ...wait, nextAttemptAt } } as Prisma.InputJsonValue },
    });
  }
  // SQL NULL is the actual fresh-admission projection. Missing retry times are
  // due; unnormalized strings wait for the bounded convergence lane above.
  const rows = await prisma.$queryRaw<RetryRow[]>`
    SELECT "id", "taskRunId", "status", "updatedAt", "threadId", "routeContext", "progressPayload", "a2aMetadata" FROM "TaskRun"
    WHERE "source" = 'coworker' AND "archivedAt" IS NULL
      AND "a2aMetadata" #> '{foregroundRequest,schemaVersion}' = '1'::jsonb
      AND "a2aMetadata" ->> 'trigger' = 'interactive'
      AND (("status" = 'submitted' AND "progressPayload" IS NULL)
        OR ("status" IN ('submitted', 'input-required')
          AND "progressPayload" #>> '{resourceWait,kind}' = 'provider-capacity'
          AND ("a2aMetadata" #>> '{foregroundRequest,deadlineAt}' <= ${nowIso}
            OR "progressPayload" #> '{resourceWait,attempt}' >= to_jsonb(${RESOURCE_WAIT_MAX_ATTEMPTS}::int)
            OR "progressPayload" #>> '{resourceWait,nextAttemptAt}' IS NULL
            OR ("progressPayload" #>> '{resourceWait,nextAttemptAt}' ~ ${isoPattern}
              AND pg_input_is_valid("progressPayload" #>> '{resourceWait,nextAttemptAt}', 'timestamptz')
              AND "progressPayload" #>> '{resourceWait,nextAttemptAt}' <= ${nowIso}))))
    ORDER BY "createdAt", "id" LIMIT 50
  `;
  for (const row of rows) {
    const wait = parseResourceWaitProjection(row.progressPayload);
    if (!wait && isRecord(row.progressPayload) && "resourceWait" in row.progressPayload) {
      await blockRetainedWork(row, row.progressPayload, invalidCapacitySummary);
      continue;
    }
    if (row.status !== "submitted" && !wait) continue;
    const metadata = isRecord(row.a2aMetadata) ? row.a2aMetadata : {};
    const request = isRecord(metadata.foregroundRequest) ? metadata.foregroundRequest : {};
    const deadline = typeof request.deadlineAt === "string" ? Date.parse(request.deadlineAt) : NaN;
    if (wait && !resourceWaitDue(wait, new Date()) && wait.attempt < RESOURCE_WAIT_MAX_ATTEMPTS
      && Number.isFinite(deadline) && deadline > Date.now()) continue;
    await jobs.send({ name: FOREGROUND_WORK_EVENT, data: { taskRunId: row.taskRunId } });
  }
  return { inspected: rows.length };
}
