import { Prisma, prisma } from "@dpf/db";
import { isRecord } from "../shared/coerce";
import { parseStoredWorkroomCycle } from "./room-cycle-adapter";
import { type ReviewCheckpoint, type ReviewCommitStore, runReviewIngestionBatch, validateReviewCheckpoint } from "./room-review-ingestion";
import { type IngestedActivity, readActivityWindowPage } from "./room-activity-ingestion.server";

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  if (!isRecord(value)) throw new Error("Cycle evidence must be an object");
  return value as Prisma.JsonObject;
}

// Internal adapter: the invoking server handler must apply its existing policy
// and tenant boundary through authorize. No ownership or policy is synthesized.
// Highwater acquisition happens outside this WorkItem transaction.
export function prismaReviewCommitStore(input: {
  roomWorkItemId: string;
  carrierId: string;
  actor: {type: "user" | "agent"; id: string};
  initialCheckpoint?: ReviewCheckpoint;
  authorize: (tx: Prisma.TransactionClient, cycleId: string) => Promise<void>;
}): ReviewCommitStore {
  return {withinCycleLock: callback => prisma.$transaction(async tx => {
    const parent = await tx.$queryRaw<Array<{id: string}>>(Prisma.sql`
      SELECT id FROM "WorkItem" WHERE id = ${input.roomWorkItemId} FOR UPDATE`);
    if (parent.length !== 1) throw new Error("Review parent binding is missing");
    const cycle = await tx.workItem.findFirst({where: {parentItemId: input.roomWorkItemId, itemId: input.carrierId}});
    if (!cycle || !parseStoredWorkroomCycle(cycle.evidence)) throw new Error("Review cycle binding is missing");
    await input.authorize(tx, cycle.id);
    const evidence = jsonObject(cycle.evidence);
    const messageId = (batchId: string) => `workroom-review:${JSON.stringify([input.roomWorkItemId, input.carrierId, batchId])}`;
    return callback({
      loadCheckpoint: async () => {
        const stored = evidence.workroomReviewIngestion ?? input.initialCheckpoint;
        if (!stored) throw new Error("Review checkpoint is missing");
        const checkpoint = stored as unknown as ReviewCheckpoint;
        validateReviewCheckpoint(checkpoint);
        if (!evidence.workroomReviewIngestion) {
          if (checkpoint.revision !== 0 || checkpoint.cycleRows !== 0) throw new Error("Invalid initial review checkpoint");
          await tx.workItem.update({where: {id: cycle.id}, data: {
            evidence: {...evidence, workroomReviewIngestion: JSON.parse(JSON.stringify(checkpoint))} as Prisma.InputJsonObject,
          }});
        }
        return checkpoint;
      },
      findReceipt: async batchId => {
        const message = await tx.workItemMessage.findUnique({where: {messageId: messageId(batchId)}});
        if (!message) return null;
        const payload = jsonObject(message.structuredPayload);
        if (message.workItemId !== input.roomWorkItemId || payload.kind !== "workroom-review-batch"
          || payload.carrierId !== input.carrierId || payload.batchId !== batchId || typeof payload.fingerprint !== "string") {
          throw new Error("Review output identity does not match its cycle");
        }
        return {fingerprint: payload.fingerprint, messageId: message.messageId};
      },
      saveCheckpoint: async checkpoint => {
        await tx.workItem.update({where: {id: cycle.id}, data: {
          evidence: {...evidence, workroomReviewIngestion: JSON.parse(JSON.stringify(checkpoint))} as Prisma.InputJsonObject,
        }});
      },
      appendOutput: async ({batchId, fingerprint, output}) => {
        const message = await tx.workItemMessage.create({data: {
          workItemId: input.roomWorkItemId, messageId: messageId(batchId),
          senderType: input.actor.type,
          ...(input.actor.type === "user" ? {senderUserId: input.actor.id} : {senderAgentId: input.actor.id}),
          messageType: "workroom-review-batch", channel: "in-app", body: "Recorded review batch.",
          structuredPayload: {kind: "workroom-review-batch", version: 1, carrierId: input.carrierId,
            batchId, fingerprint, output: JSON.parse(JSON.stringify(output)), coverage: "retention-unverified"},
        }, select: {messageId: true}});
        return message.messageId;
      },
    });
  })};
}

// The concrete server seam couples the bounded SQL reader to the existing
// cycle transaction. Invoking handlers still own admission and review policy;
// this seam does not introduce another scheduler or grant-bearing endpoint.
export function runPrismaReviewIngestionBatch(input: Parameters<typeof prismaReviewCommitStore>[0] & {
  analyze: (rows: readonly IngestedActivity[], coverage: "retention-unverified") => Promise<unknown>;
}) {
  return runReviewIngestionBatch({store: prismaReviewCommitStore(input),
    reader: page => readActivityWindowPage(prisma, page), analyze: input.analyze});
}
