import { prisma, type Prisma } from "@dpf/db";
import { reserveTaskRunGenerationWorking } from "./observability/heartbeat";
import { INITIATIVE_CORRECTABLE_ERRORS } from "./backlog/initiative-readiness/disposition-contract";
import { remoteTaskRequestMatches } from "./mcp-task-capacity-contract";
import type { ExistingRemoteTask, RemoteTaskSubmitParams } from "./mcp-task-submit";
import type { createInitiativeReviewTerminalToolPolicy } from "./tak/terminal-tool-policy";
import type { PersistedTerminalReaderExecution } from "./mcp-task-terminal-writer-context";
import { recoverTerminalWriterEscalation } from "./mcp-task-terminal-writer-escalation";
import { parseTerminalWriterWait, type TerminalWriterWait } from "./mcp-task-replay-projection";
function optionalString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }

export async function persistedTerminalReaderExecutions(
  taskRunId: string,
): Promise<PersistedTerminalReaderExecution[]> {
  return prisma.toolExecution.findMany({
    where: {
      taskRunId,
      toolName: "read_source_at_version",
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      toolName: true,
      parameters: true,
      result: true,
      success: true,
      createdAt: true,
    },
  }) as Promise<PersistedTerminalReaderExecution[]>;
}
function approvalEnvelopeIdFromWriterAttempt(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  if (row["success"] !== false || row["error"] !== "approval_required") return null;
  const data = row["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return optionalString((data as Record<string, unknown>)["envelopeId"]);
}

export async function reserveTerminalWriterReplay(input: {
  existing: ExistingRemoteTask;
  parsed: RemoteTaskSubmitParams;
  terminalToolPolicy: NonNullable<ReturnType<typeof createInitiativeReviewTerminalToolPolicy>>;
}): Promise<{
  wait: TerminalWriterWait;
  readerExecutions: PersistedTerminalReaderExecution[];
  bootstrapReaderEvidence: boolean;
} | null> {
  if (!remoteTaskRequestMatches(input.existing.a2aMetadata, input.parsed)) return null;
  if (recoverTerminalWriterEscalation(input.existing.progressPayload)) return null;

  const existingWait = parseTerminalWriterWait(input.existing.progressPayload);
  const isProjectedWait = existingWait !== null
    && ["input-required", "stalled", "failed"].includes(input.existing.status);
  const isRecoverableCompletedExit = input.existing.status === "completed" && !existingWait;
  if (!isProjectedWait && !isRecoverableCompletedExit) return null;
  if (existingWait && existingWait.writerToolName !== input.terminalToolPolicy.writerToolName) return null;

  const [readerExecutions, successfulWriter, writerAttempt] = await Promise.all([
    persistedTerminalReaderExecutions(input.existing.taskRunId),
    prisma.toolExecution.findFirst({
      where: {
        taskRunId: input.existing.taskRunId,
        toolName: input.terminalToolPolicy.writerToolName,
        success: true,
      },
      select: { id: true },
    }),
    prisma.toolExecution.findFirst({
      where: {
        taskRunId: input.existing.taskRunId,
        toolName: input.terminalToolPolicy.writerToolName,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, success: true, result: true, parameters: true },
    }),
  ]);
  if (successfulWriter) return null;
  const bootstrapReaderEvidence = readerExecutions.length === 0;
  if (bootstrapReaderEvidence && !isProjectedWait) return null;

  if (writerAttempt) {
    const proposalEnvelopeId = writerAttempt.success === false
      ? approvalEnvelopeIdFromWriterAttempt(writerAttempt.result)
      : null;
    if (proposalEnvelopeId) {
      const declinedProposalEnvelope = await prisma.coworkerActionEnvelope.findFirst({
        where: {
          id: proposalEnvelopeId,
          taskRunId: input.existing.taskRunId,
          manifestActionId: input.terminalToolPolicy.writerToolName,
          status: "declined",
        },
        select: { id: true },
      });
      if (declinedProposalEnvelope?.id !== proposalEnvelopeId) return null;
    } else if (
      writerAttempt.success !== false
      || !existingWait
      || !["input-required", "stalled", "failed"].includes(input.existing.status)
    ) return null;
  }

  const progress = input.existing.progressPayload && typeof input.existing.progressPayload === "object"
    && !Array.isArray(input.existing.progressPayload)
    ? input.existing.progressPayload as Record<string, unknown>
    : {};
  const now = new Date().toISOString();
  const wait: TerminalWriterWait = {
    schemaVersion: 1,
    kind: "missing-terminal-writer",
    writerToolName: input.terminalToolPolicy.writerToolName,
    resumeMode: "same-taskrun",
    attempt: existingWait ? existingWait.attempt + 1 : 2,
    observedAt: now,
    dispatchContract: "required-tool-call",
    ...(writerAttempt?.success === false && writerAttempt.result && typeof writerAttempt.result === "object"
      && !Array.isArray(writerAttempt.result)
      && INITIATIVE_CORRECTABLE_ERRORS.has(String((writerAttempt.result as Record<string, unknown>).error ?? ""))
      ? { validationFailure: {
          error: String((writerAttempt.result as Record<string, unknown>).error),
          message: String((writerAttempt.result as Record<string, unknown>).message ?? "Receipt validation failed."),
          ...(writerAttempt.parameters ? { proposal: writerAttempt.parameters } : {}),
        } } : {}),
  };
  const reserved = await reserveTaskRunGenerationWorking({
    taskRunId: input.existing.taskRunId,
    expectedStatus: input.existing.status,
    updatedAt: input.existing.updatedAt,
    progressPayload: {
      ...progress,
      terminalWriterWait: wait,
      ...(isRecoverableCompletedExit ? { recoveredFromCompletedRouteExit: true } : {}),
      resumeReservedAt: now,
    } as Prisma.InputJsonValue,
  });
  return reserved
    ? { wait, readerExecutions, bootstrapReaderEvidence }
    : null;
}
