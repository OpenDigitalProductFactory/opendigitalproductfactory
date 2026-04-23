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

// Deliberation (spec §8) is retrieval-first: when a branch performs public-web
// fetches, file reads, or other external research to support a claim, we mirror
// that activity into the existing external-evidence stream so the platform can
// observe all external-research activity in one place without overloading
// ExternalEvidenceRecord with deliberation-only columns. The helper
// `mirrorDeliberationRetrievalEvent` lives in
// `apps/web/lib/deliberation/evidence.ts` (where the evidence policy owns it)
// and is re-exported here so callers in the actions layer can import
// `recordExternalEvidence` and the deliberation mirror side by side.
export { mirrorDeliberationRetrievalEvent } from "../deliberation/evidence";
