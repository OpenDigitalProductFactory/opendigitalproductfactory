import { createHash, randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { ToolDefinition } from "@/lib/mcp-tool-types";
import type { InferenceDeadEndOutcome } from "@/lib/tak/inference-dead-ends";
import { isRecord } from "@/lib/shared/coerce";
import { redactDiagnosticEvidenceText } from "@/lib/shared/diagnostic-evidence-redaction";
import { createTaskMessage } from "@/lib/tak/task-records";
import { withReadEvidencePolicy } from "@/lib/tak/read-evidence-policy";
import { createInAppAdapter } from "@/lib/communications/in-app-adapter";
import { createCommunicationDispatcher } from "@/lib/communications/dispatcher";
import { recordDeliveryAttempt } from "@/lib/communications/delivery-evidence";
import type { CommunicationDeliveryResult, SendCommunicationInput } from "@/lib/communications/channel-types";
import { computeNextCronRun, isOneShotCron } from "@/lib/operate/cron-next-run";
import { assertCurrentScheduledReportingContext } from "./scheduled-reporting-authority";
import { isScheduledReportingRead, parseScheduledReport, readScheduledReportingState, type ScheduledReportingState } from "./scheduled-reporting-contract";

type ReportingStatus = NonNullable<ScheduledReportingState["lastRun"]>["status"];
export type ScheduledReportingRunInput = { taskId: string; userId: string; taskRunId: string; threadId: string; agentId: string; scopeDigest: string;
  content: string; admittedTools: readonly ToolDefinition[]; failure?: InferenceDeadEndOutcome; now?: Date };
type RunInput = ScheduledReportingRunInput;
type Dispatch = (tx: Prisma.TransactionClient, input: SendCommunicationInput) => Promise<CommunicationDeliveryResult>;
type Dependencies = { db?: typeof prisma; dispatch?: Dispatch };
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const safeReportFailures = new Set([
  "Scheduled report exceeds its size limit.", "Scheduled report must be one JSON object.",
  "Scheduled report is malformed or lacks required evidence selectors.",
  "A discovery or unadmitted tool cannot substantiate an observation.",
  "The scheduled observations include unverified or failed calls.", "A required fresh successful observation is missing.",
  "Resolution does not match the current observed condition.", "The owner notice was not delivered.",
  "The owner notice lacks its linked delivery evidence.", "Existing reporting notice cannot be verified.",
]);

/** Carry the existing read-only execution policy through native continuations.
 * A transport unable to enforce this surface must refuse before execution.
 * Format inspection alone never earns completion; settlement verifies DB reads. */
export function runScheduledReportingLoop<T extends { content: string }>(tools: readonly ToolDefinition[], run: () => Promise<T>) {
  return withReadEvidencePolicy({ toolNames: tools.filter(isScheduledReportingRead).map(tool => tool.name), inspect: async content => {
    try { parseScheduledReport(content); return { complete: true, message: "Report format accepted; persisted observations still require settlement." }; }
    catch { return { complete: false, message: "A bounded observation report with evidence selectors is required." }; }
  } }, run);
}

const dispatchInApp: Dispatch = (tx, input) => createCommunicationDispatcher([createInAppAdapter(tx)], {
  recordDelivery: attempt => recordDeliveryAttempt(attempt, tx),
}).send(input);

async function loadCurrent(tx: Prisma.TransactionClient, input: RunInput) {
  const rows = await tx.$queryRaw<Array<{ taskId: string }>>`SELECT "taskId" FROM "ScheduledAgentTask" WHERE "taskId" = ${input.taskId} AND "ownerUserId" = ${input.userId} FOR UPDATE`;
  if (rows.length !== 1) throw new Error("Scheduled reporting task is unavailable.");
  const task = await tx.scheduledAgentTask.findUnique({ where: { taskId: input.taskId } });
  const run = await tx.taskRun.findUnique({ where: { taskRunId: input.taskRunId } });
  if (!task || !run || task.ownerUserId !== input.userId || run.userId !== input.userId
    || task.taskRunId !== run.taskRunId || run.threadId !== input.threadId) throw new Error("Scheduled reporting execution changed.");
  return { task, run, state: readScheduledReportingState(task.taskConfig) };
}

function assertAdmission(task: Record<string, unknown>, run: Record<string, unknown>, input: RunInput) {
  const binding = assertCurrentScheduledReportingContext(task, run, input.userId, {
    taskRunId: input.taskRunId, threadId: input.threadId, agentId: input.agentId,
  });
  if (binding.scopeDigest !== input.scopeDigest) throw new Error("Scheduled reporting scope changed.");
}

async function verifyCondition(tx: Prisma.TransactionClient, input: RunInput, condition: NonNullable<ScheduledReportingState["condition"]>) {
  const notification = await tx.notification.findFirst({ where: { id: condition.notificationId, userId: input.userId }, select: { id: true } });
  const delivery = await tx.communicationDeliveryAttempt.findMany({ where: { attemptId: condition.attemptId,
    providerMessageId: condition.notificationId, targetId: condition.taskRunId, targetType: "agent-thread", channelType: "in-app", status: "sent" },
    select: { attemptId: true }, take: 2 });
  const origin = await tx.taskRun.findUnique({ where: { taskRunId: condition.taskRunId }, select: { userId: true, a2aMetadata: true } });
  const metadata = isRecord(origin?.a2aMetadata) ? origin.a2aMetadata : null;
  const source = isRecord(metadata?.sourceRef) ? metadata.sourceRef : null;
  if (!notification || delivery.length !== 1 || origin?.userId !== input.userId
    || source?.kind !== "scheduled-task" || source.id !== input.taskId) throw new Error("Existing reporting notice cannot be verified.");
}

async function recordHistory(tx: Prisma.TransactionClient, input: RunInput, run: { id: string; contextId: string | null },
  summary: string, metadata: Record<string, unknown>) {
  await createTaskMessage({ taskRunId: input.taskRunId, taskRunRecordId: run.id, contextId: run.contextId,
    role: "agent", content: summary, metadata: { source: "scheduled-reporting", taskId: input.taskId, ...metadata } }, tx);
  await tx.agentMessage.create({ data: { threadId: input.threadId, role: "assistant", content: summary,
    agentId: input.agentId, taskType: "scheduled-task-summary" } });
}

async function persistOutcome(tx: Prisma.TransactionClient, input: RunInput,
  task: { taskConfig: unknown; schedule: string }, state: ScheduledReportingState, status: ReportingStatus, summary: string,
  reportDigest: string, evidence: Array<{ toolExecutionId: string; resultDigest: string }>, now: Date, decisionBrief?: string) {
  const parked = status === "input-required" || status === "auth-required";
  const nextRunAt = parked || isOneShotCron(task.schedule) ? null : computeNextCronRun(task.schedule, now);
  const runChanged = await tx.taskRun.updateMany({ where: { taskRunId: input.taskRunId, userId: input.userId, status: "working" },
    data: { status, completedAt: parked ? null : now, progressPayload: { summary, ...(decisionBrief ? { decisionBrief } : {}), scheduledReporting: { status, summary, evidence,
      conditionId: state.condition?.conditionId ?? null, reportDigest } } } });
  if (runChanged.count !== 1) throw new Error("Scheduled reporting run already settled or changed.");
  const config = isRecord(task.taskConfig) ? task.taskConfig : {};
  const changed = await tx.scheduledAgentTask.updateMany({ where: { taskId: input.taskId, ownerUserId: input.userId, taskRunId: input.taskRunId },
    data: { lastRunAt: now, lastStatus: parked ? "proposed" : status === "failed" ? "error" : "ok",
      lastError: status === "failed" ? summary : null, lastThreadId: input.threadId, nextRunAt, attempts: 0,
      ...(isOneShotCron(task.schedule) && !parked ? { isActive: false } : {}),
      taskConfig: { ...config, routineReportingState: { ...state, lastRun: { taskRunId: input.taskRunId, reportDigest, status, summary } } } as Prisma.InputJsonValue } });
  if (changed.count !== 1) throw new Error("Scheduled reporting task changed before settlement.");
  // Same transaction and current-run fence as the task. A mirror error cannot be hidden.
  await tx.scheduledJob.updateMany({ where: { jobId: input.taskId }, data: { lastRunAt: now,
    lastStatus: parked ? "proposed" : status === "failed" ? "error" : "ok", lastError: status === "failed" ? summary : null,
    nextRunAt, ...(parked || isOneShotCron(task.schedule) ? { schedule: "disabled" } : {}) } });
}

/** Only server-owned runtime outcomes and successful same-run reads can settle a report. */
export async function settleScheduledReportingRun(input: RunInput, dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  const now = input.now ?? new Date();
  const report = input.failure ? null : parseScheduledReport(input.content);
  const reportDigest = digest({ content: input.content, failure: input.failure ?? null });
  return db.$transaction(async tx => {
    const { task, run, state } = await loadCurrent(tx, input);
    // Reconcile a lost acknowledgement as a historical result, never another send.
    if (state.lastRun?.taskRunId === input.taskRunId && state.lastRun.reportDigest === reportDigest
      && run.status === state.lastRun.status) return { status: state.lastRun.status, reused: true };
    assertAdmission(task, run, input);
    if (state.condition) await verifyCondition(tx, input, state.condition);
    const evidence: Array<{ toolExecutionId: string; resultDigest: string }> = [];
    if (report) {
      const admitted = new Map(input.admittedTools.filter(isScheduledReportingRead).map(tool => [tool.name, tool]));
      if (report.evidenceToolNames.some(name => !admitted.has(name) || ["load_tools", "search_tool_marketplace"].includes(name))) {
        throw new Error("A discovery or unadmitted tool cannot substantiate an observation.");
      }
      const calls = await tx.toolExecution.findMany({ where: { taskRunId: input.taskRunId, userId: input.userId,
        agentId: input.agentId, threadId: input.threadId, createdAt: { gte: run.startedAt, lte: now } },
        select: { id: true, toolName: true, success: true, result: true }, take: 201 });
      if (calls.length > 200 || calls.some(call => !call.success)) throw new Error("The scheduled observations include unverified or failed calls.");
      for (const name of report.evidenceToolNames) {
        const observed = calls.filter(call => call.toolName === name && isRecord(call.result) && call.result.success === true
          && call.result.requiresApproval !== true && !call.result.error);
        if (!observed.length) throw new Error("A required fresh successful observation is missing.");
        evidence.push(...observed.map(call => ({ toolExecutionId: call.id, resultDigest: digest(call.result) })));
      }
    }
    const status: ReportingStatus = input.failure ? input.failure.kind === "credentials" ? "auth-required" : "failed"
      : report!.state === "needs-decision" ? "input-required" : "completed";
    const summary = redactDiagnosticEvidenceText(input.failure?.message ?? report!.summary).trim().slice(0, 2000) || "The scheduled observation could not be verified.";
    const history = [summary, report?.recommendation, report?.decisionBrief].filter(Boolean).join("\n\n");
    if (report?.state === "resolved") {
      if (!state.condition || report.conditionId !== state.condition.conditionId) throw new Error("Resolution does not match the current observed condition.");
      await tx.notification.updateMany({ where: { id: state.condition.notificationId, userId: input.userId }, data: { read: true } });
      state.condition = null;
    }
    if (!state.condition && (report?.state === "actionable" || status === "input-required" || status === "auth-required")) {
      const delivered = await (dependencies.dispatch ?? dispatchInApp)(tx, { channel: "in-app",
        target: { targetType: "agent-thread", targetId: input.taskRunId, recipientUserId: input.userId },
        title: status === "auth-required" ? "Your watch needs sign-in" : status === "input-required" ? "Your watch needs a decision" : "Your watch found a change",
        body: history, urgency: status === "completed" ? "routine" : "priority", deepLink: `/api/internal/tasks/${encodeURIComponent(input.taskRunId)}` });
      if (delivered.status !== "sent" || !delivered.providerMessageId) throw new Error("The owner notice was not delivered.");
      const notification = await tx.notification.findFirst({ where: { id: delivered.providerMessageId, userId: input.userId }, select: { id: true } });
      const attempts = await tx.communicationDeliveryAttempt.findMany({ where: { providerMessageId: delivered.providerMessageId,
        targetId: input.taskRunId, targetType: "agent-thread", channelType: "in-app", status: "sent" }, select: { attemptId: true }, take: 2 });
      if (!notification || attempts.length !== 1) throw new Error("The owner notice lacks its linked delivery evidence.");
      state.condition = { conditionId: randomUUID(), notificationId: notification.id, attemptId: attempts[0]!.attemptId, taskRunId: input.taskRunId };
    }
    await recordHistory(tx, input, run, history, { status, evidence, reportDigest, conditionId: state.condition?.conditionId ?? null });
    await persistOutcome(tx, input, task, state, status, summary, reportDigest, evidence, now, report?.decisionBrief);
    return { status, reused: false };
  }, { maxWait: 5000, timeout: 20000 });
}

/** A late failure never overwrites a parked/settled run, a newer run or a changed commission. */
export async function failScheduledReportingRun(input: RunInput, error: string, dependencies: Dependencies = {}) {
  const db = dependencies.db ?? prisma;
  return db.$transaction(async tx => {
    const { task, run, state } = await loadCurrent(tx, input);
    if (run.status !== "working") return false;
    assertAdmission(task, run, input);
    const summary = safeReportFailures.has(error) ? redactDiagnosticEvidenceText(error)
      : "The scheduled observation or report could not be verified. Review this run's recorded evidence before continuing.";
    await recordHistory(tx, input, run, summary, { status: "failed" });
    await persistOutcome(tx, input, task, state, "failed", summary, digest({ failedRun: input.taskRunId }), [], input.now ?? new Date());
    return true;
  }, { maxWait: 5000, timeout: 20000 });
}
