import { prisma, type Prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { parseSemanticReviewRequest } from "./semantic-review-request";

type ReviewRequestIdentity = {
  id: string; taskRunId: string; userId: string; a2aMetadata: unknown; progressPayload: unknown;
};
const object = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};

/** Reuse the worker's immutable request binding, only after the caller's content admission. */
export async function readPersistedSemanticReviewRequest(row: ReviewRequestIdentity,
  db: Pick<Prisma.TransactionClient, "taskArtifact"> = prisma,
) {
  const artifact = await db.taskArtifact.findUnique({
    where: { artifactId: `semantic-review-request:${row.taskRunId}` }, select: { taskRunId: true, parts: true },
  });
  if (!artifact || artifact.taskRunId !== row.id || !Array.isArray(artifact.parts)) return null;
  const packet = parseSemanticReviewRequest(object(artifact.parts[0]).data);
  const metadata = object(row.a2aMetadata);
  return packet && packet.actor.userId === row.userId && packet.gateKey === metadata.gateKey
    && packet.input.identity.capsuleId === metadata.capsuleId
    && packet.digest === object(object(row.progressPayload).semanticReview).requestDigest ? packet : null;
}
