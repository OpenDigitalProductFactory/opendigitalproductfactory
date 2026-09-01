import { prisma } from "@dpf/db";

import {
  describeExternalApprovalLocation,
  isPendingEnvelopeVisibleToCaller,
  withExternalApprovalLocation,
  type ExternalApprovalLocation,
} from "./external-approval-location";

export async function loadExternalApprovalLocationForTaskRun(input: {
  taskRunId: string;
  callerUserId: string;
}): Promise<ExternalApprovalLocation | null> {
  if (!input.callerUserId) return null;
  const now = new Date();
  const row = await prisma.coworkerActionEnvelope.findFirst({
    where: {
      taskRunId: input.taskRunId,
      delegatingUserId: input.callerUserId,
      status: "proposed",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      delegatingUserId: true,
      taskRunId: true,
      status: true,
      expiresAt: true,
      rationale: true,
      manifestActionId: true,
    },
  });
  if (!row) return null;
  if (!isPendingEnvelopeVisibleToCaller(row, input.callerUserId, now)) return null;
  return describeExternalApprovalLocation({
    envelopeId: row.id,
    delegatingUserId: row.delegatingUserId,
    taskRunId: row.taskRunId,
    status: row.status,
    expiresAt: row.expiresAt,
  });
}

export async function withTaskRunApprovalLocation<T extends Record<string, unknown>>(
  result: T,
  input: { taskRunId: string; callerUserId: string },
): Promise<T> {
  const location = await loadExternalApprovalLocationForTaskRun(input);
  return withExternalApprovalLocation(result, location);
}
