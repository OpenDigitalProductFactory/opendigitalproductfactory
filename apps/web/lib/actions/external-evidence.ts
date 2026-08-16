"use server";

import { prisma, type Prisma } from "@dpf/db";

export async function recordExternalEvidence(input: {
  actorUserId: string;
  routeContext: string;
  operationType: string;
  target: string;
  provider: string;
  resultSummary: string;
  buildId?: string;
  taskRunId?: string;
  details?: Prisma.InputJsonValue;
  // EP-WORK-CONVERGENCE Phase 1 (BI-D6FA8641): bind the record to the durable
  // Workroom and carry producer identity. All optional — a caller that does
  // not know the capsule still writes a valid record (resolution below is
  // best-effort; full auto-claim is Phase 2 / BI-5FDBF786).
  workCapsuleId?: string;
  executorKind?: string;
  recordedByPrincipalId?: string;
  recordedByAgentId?: string;
}) {
  // Resolve the capsule when the caller did not supply one but named a build,
  // and exactly one capsule links to that build (ambiguous or absent → leave
  // null rather than guess). Never throws: evidence capture is best-effort.
  let workCapsuleId = input.workCapsuleId;
  let executorKind = input.executorKind;
  if (workCapsuleId === undefined && input.buildId !== undefined) {
    try {
      const linked = await prisma.workroom.findMany({
        where: { featureBuildId: input.buildId },
        select: { id: true, executorKind: true },
        take: 2,
      });
      if (linked.length === 1) {
        workCapsuleId = linked[0].id;
        if (executorKind === undefined && linked[0].executorKind) {
          executorKind = linked[0].executorKind;
        }
      }
    } catch {
      // Resolution is an enhancement; a lookup failure must never block the
      // evidence write. Fall through and persist the record unlinked.
    }
  }

  return prisma.externalEvidenceRecord.create({
    data: {
      actorUserId: input.actorUserId,
      routeContext: input.routeContext,
      operationType: input.operationType,
      target: input.target,
      provider: input.provider,
      resultSummary: input.resultSummary,
      ...(input.buildId !== undefined ? { buildId: input.buildId } : {}),
      ...(input.taskRunId !== undefined ? { taskRunId: input.taskRunId } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
      ...(workCapsuleId !== undefined ? { workCapsuleId } : {}),
      ...(executorKind !== undefined ? { executorKind } : {}),
      ...(input.recordedByPrincipalId !== undefined
        ? { recordedByPrincipalId: input.recordedByPrincipalId }
        : {}),
      ...(input.recordedByAgentId !== undefined
        ? { recordedByAgentId: input.recordedByAgentId }
        : {}),
    },
  });
}

// Deliberation's retrieval-mirror helper lives at `@/lib/deliberation/evidence`
// as `mirrorDeliberationRetrievalEvent` — import it from there directly. It
// cannot be re-exported from this module because `"use server"` files may only
// export async functions, and the deliberation module also exports sync
// helpers + types; a wildcard re-export causes Next.js RSC to treat this file
// as having no exports at all.
