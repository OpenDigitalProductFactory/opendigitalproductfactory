import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import { isRecord } from "@/lib/shared/coerce";
import { EXECUTION_UNCERTAIN_MESSAGE, executionUncertaintyFromError, hasExecutionUncertainty } from "@/lib/shared/execution-uncertainty";
import { classifyDispatchFailure } from "@/lib/inference/dispatch-failure-class";
import { taskExecutionEligible, type TaskExecutionFence } from "@/lib/shared/task-execution-fence";
import type { InferenceDeadEndOutcome } from "./inference-dead-ends";
import { currentReassessmentExecution } from "@/lib/routing/reassessment-execution-scope";
import { currentReadEvidencePolicy } from "./read-evidence-policy";

export const UNVERIFIED_EVIDENCE_ARTIFACT = "unverified-evidence-draft";
export type EvidenceDraftRetention =
  | { state: "stored"; artifactId: string }
  | { state: "unavailable"; reason: "missing-task-binding" | "task-binding-mismatch" | "restricted-execution" | "write-failed" | "execution-uncertain" };
export type EvidenceRecoveryDiagnostics = {
  /** Internal model output; never forward as factual response content. */
  withheldContent?: string;
  evidenceFailure?: { observedToolExecutions: number; observedSuccessfulToolExecutions: number;
    recoveryNudges: number; retention: EvidenceDraftRetention };
};

export async function evidenceRecoveryFailure(input: {
  taskRunId?: string | null; taskExecutionFence?: TaskExecutionFence | null;
  userId: string; agentId: string; threadId: string; message: string;
  drafts: string[]; toolResults?: unknown[]; observedToolExecutions: number; observedSuccessfulToolExecutions: number; recoveryNudges: number;
}): Promise<EvidenceRecoveryDiagnostics & { failure: InferenceDeadEndOutcome }> {
  const withheldContent = input.drafts.join("\n\n");
  const uncertain = input.toolResults?.find(value => isRecord(value) && value.success !== true
    && (hasExecutionUncertainty(value) || hasExecutionUncertainty(value.data)
      || value.error === "execution_uncertain" || value.error === "execution-uncertain"
      || classifyDispatchFailure(value).code === "execution-uncertain"));
  const failure: InferenceDeadEndOutcome = uncertain
    ? { kind: "execution-uncertain", message: EXECUTION_UNCERTAIN_MESSAGE,
      executionUncertainty: executionUncertaintyFromError(uncertain) }
    : { kind: "evidence-unavailable", message: input.message };
  const retention: EvidenceDraftRetention = uncertain
    ? { state: "unavailable", reason: "execution-uncertain" }
    : await retainUnverifiedEvidenceDraft({ taskRunId: input.taskRunId,
    taskExecutionFence: input.taskExecutionFence, userId: input.userId,
    agentId: input.agentId, threadId: input.threadId, withheldContent });
  return { failure, withheldContent,
    evidenceFailure: { observedToolExecutions: input.observedToolExecutions,
      observedSuccessfulToolExecutions: input.observedSuccessfulToolExecutions, recoveryNudges: input.recoveryNudges, retention } };
}

/** Diagnostic output only. Never select a nearby or historical task for a chat. */
export async function retainUnverifiedEvidenceDraft(input: {
  taskRunId?: string | null; taskExecutionFence?: TaskExecutionFence | null;
  userId: string; agentId: string; threadId: string; withheldContent: string;
}): Promise<EvidenceDraftRetention> {
  if (currentReassessmentExecution() || currentReadEvidencePolicy()) return { state: "unavailable", reason: "restricted-execution" };
  if (!input.taskRunId || !input.taskExecutionFence) return { state: "unavailable", reason: "missing-task-binding" };
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${input.taskRunId} FOR UPDATE`;
      const task = await tx.taskRun.findUnique({ where: { taskRunId: input.taskRunId! }, select: {
        id: true, userId: true, currentAgentId: true, threadId: true, archivedAt: true,
        status: true, progressPayload: true, a2aMetadata: true,
      } });
      if (!task || task.userId !== input.userId || task.threadId !== input.threadId || task.archivedAt
        || !task.currentAgentId || resolveCanonicalAgentId(task.currentAgentId) !== resolveCanonicalAgentId(input.agentId)
        || !taskExecutionEligible({ status: task.status, progressPayload: task.progressPayload,
          requestDigest: isRecord(task.a2aMetadata) ? task.a2aMetadata.requestDigest : null,
          executionFence: input.taskExecutionFence })) return { state: "unavailable", reason: "task-binding-mismatch" };
      const artifactId = `ta_unverified_${createHash("sha256").update(JSON.stringify({ ...input })).digest("hex")}`;
      await tx.taskArtifact.upsert({ where: { artifactId }, update: {}, create: {
        id: randomUUID(), artifactId, taskRunId: task.id, producerAgentId: input.agentId,
        name: "Unverified draft — not evidence",
        description: "Evidence recovery failed. The withheld draft is diagnostic material and must not be acted on as fact.",
        parts: [{ type: UNVERIFIED_EVIDENCE_ARTIFACT, mimeType: "application/json", data: {
          state: "unverified", threadId: input.threadId, draft: input.withheldContent,
        } }],
        metadata: { kind: UNVERIFIED_EVIDENCE_ARTIFACT, state: "unverified", usableAsEvidence: false },
      } });
      return { state: "stored", artifactId };
    }, { isolationLevel: "Serializable" });
  } catch {
    return { state: "unavailable", reason: "write-failed" };
  }
}
