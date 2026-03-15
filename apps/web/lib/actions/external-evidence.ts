"use server";

import { prisma, type Prisma } from "@dpf/db";

export async function recordExternalEvidence(input: {
  actorUserId: string;
  routeContext: string;
  operationType: string;
  target: string;
  provider: string;
  resultSummary: string;
  details?: Prisma.InputJsonValue;
}) {
  return prisma.externalEvidenceRecord.create({
    data: {
      actorUserId: input.actorUserId,
      routeContext: input.routeContext,
      operationType: input.operationType,
      target: input.target,
      provider: input.provider,
      resultSummary: input.resultSummary,
      ...(input.details !== undefined ? { details: input.details } : {}),
    },
  });
}
