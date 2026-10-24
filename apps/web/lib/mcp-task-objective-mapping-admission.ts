import { Prisma, prisma } from "@dpf/db";

import {
  isObjectiveMappingAdmissionRefusal,
  prepareObjectiveMappingSubmissionAdmission,
  type ObjectiveMappingAdmissionGuard,
} from "@/lib/backlog/initiative-readiness/objective-mapping-submission-admission";

import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import {
  err,
  ok,
  type ActionFailure,
  type ActionSuccess,
} from "@/lib/shared/action-result";

type PreparedAdmission = {
  admissionGuard: ObjectiveMappingAdmissionGuard;
  transactionIsolationLevel: Prisma.TransactionIsolationLevel;
};

type RefusalResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError: true;
};

function refusalResult(input: {
  message: string;
  code: string;
  reason: string;
  taskRunId?: string;
}): RefusalResult {
  return {
    content: [{ type: "text", text: input.message }],
    structuredContent: {
      error: input.code,
      reason: input.reason,
      ...(input.taskRunId ? { taskRunId: input.taskRunId } : {}),
    },
    isError: true,
  };
}

/** Convert the parsed remote packet into the server-owned atomic admission hook. */
export async function prepareRemoteObjectiveMappingAdmission(input: {
  taskRunId: string;
  parsed: {
    agentId: string;
    objective: string;
    title: string;
    idempotencyKey: string;
    initiativeReviewBinding?: InitiativeReviewBinding;
  };
  requiredToolNames: string[];
}): Promise<ActionSuccess<{ admission: PreparedAdmission | null }> | (
  ActionFailure & { result: RefusalResult }
)> {
  if (input.parsed.initiativeReviewBinding?.gate !== "objective-mapping") return ok({ admission: null });
  const binding = input.parsed.initiativeReviewBinding;
  if (!binding.workroomRef || !binding.eligibleEvidenceActivityIds) {
    const result = refusalResult({
        message: "Objective-mapping admission requires the exact server-issued Workroom and bounded evidence binding.",
        code: "objective_mapping_admission_refused",
        reason: "invalid-server-request-key",
      });
    return { ...err(result.content[0]!.text), result };
  }
  const prepared = await prepareObjectiveMappingSubmissionAdmission({
    expectedTaskRunId: input.taskRunId,
    packet: {
      targetAgent: input.parsed.agentId,
      objective: input.parsed.objective,
      questionPacketSummary: input.parsed.title,
      requiredToolNames: input.requiredToolNames,
      requestKey: input.parsed.idempotencyKey,
      binding: {
        ...binding,
        gate: "objective-mapping",
        workroomRef: binding.workroomRef,
        eligibleEvidenceActivityIds: binding.eligibleEvidenceActivityIds,
      },
    },
  });
  if (!prepared.ok) {
    const result = refusalResult({
        message: prepared.refusal.message,
        code: prepared.refusal.code,
        reason: prepared.refusal.reason,
        taskRunId: prepared.refusal.taskRunId,
      });
    return { ...err(result.content[0]!.text), result };
  }
  return ok({
    admission: {
      admissionGuard: prepared.data.admissionGuard,
      // The BacklogItem row lock is the serialization primitive. A waiter
      // must see the winner after acquiring the lock, not an older snapshot.
      transactionIsolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  });
}

export function remoteObjectiveMappingAdmissionErrorResult(error: unknown): RefusalResult | null {
  if (!isObjectiveMappingAdmissionRefusal(error)) return null;
  return refusalResult({
    message: error.message,
    code: error.code,
    reason: error.reason,
    taskRunId: error.taskRunId,
  });
}

/** Revalidate an existing TaskRun before any replay path can spend authority. */
export async function revalidateRemoteObjectiveMappingReplay(
  admission: PreparedAdmission | null,
): Promise<RefusalResult | null> {
  if (!admission) return null;
  try {
    await prisma.$transaction(
      (tx) => admission.admissionGuard(tx),
      { isolationLevel: admission.transactionIsolationLevel },
    );
    return null;
  } catch (error) {
    return remoteObjectiveMappingAdmissionErrorResult(error) ?? refusalResult({
      message: "Objective-mapping replay admission failed closed before authority was spent.",
      code: "objective_mapping_admission_refused",
      reason: "objective-mapping-history-unavailable",
    });
  }
}
