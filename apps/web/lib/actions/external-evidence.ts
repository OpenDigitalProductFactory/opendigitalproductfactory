"use server";

import { prisma } from "@dpf/db";
import { recordExternalEvidenceInStore } from "@/lib/observability/external-evidence-store";

/** Server action wrapper; workers supply their transaction to the shared store. */
export async function recordExternalEvidence(input: Parameters<typeof recordExternalEvidenceInStore>[0]) {
  return recordExternalEvidenceInStore(input, prisma);
}
