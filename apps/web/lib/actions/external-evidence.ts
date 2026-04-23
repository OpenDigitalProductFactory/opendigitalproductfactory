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

// Deliberation's retrieval-mirror helper lives at `@/lib/deliberation/evidence`
// as `mirrorDeliberationRetrievalEvent` — import it from there directly. It
// cannot be re-exported from this module because `"use server"` files may only
// export async functions, and the deliberation module also exports sync
// helpers + types; a wildcard re-export causes Next.js RSC to treat this file
// as having no exports at all.
