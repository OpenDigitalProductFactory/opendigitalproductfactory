/**
 * Prisma binding for the canonical WorkItem anchor (EP-WORK-CONVERGENCE, BI-650994D7).
 * Server-only: constructs the anchor ports from prisma and links the capsule NON-FATALLY.
 * See capsule-workitem-anchor.ts for the pure core and design reference.
 */
import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import {
  ensureCapsuleWorkItemAnchor,
  type CapsuleWorkItemAnchorResult,
  type WorkItemAnchorPorts,
} from "./capsule-workitem-anchor";

/** Stable queueId for the canonical queue capsule-anchored WorkItems land in. */
const CANONICAL_ANCHOR_QUEUE_ID = "canonical-work-anchor";

function prismaAnchorPorts(): WorkItemAnchorPorts {
  return {
    findWorkItemBySource: (sourceType, sourceId) =>
      prisma.workItem.findFirst({ where: { sourceType, sourceId }, select: { id: true } }),
    resolveCanonicalQueueId: async () => {
      const queue = await prisma.workQueue.upsert({
        where: { queueId: CANONICAL_ANCHOR_QUEUE_ID },
        update: {},
        create: {
          queueId: CANONICAL_ANCHOR_QUEUE_ID,
          name: "Work Anchor",
          queueType: "triage",
          routingPolicy: {},
          isActive: true,
        },
        select: { id: true },
      });
      return queue.id;
    },
    createWorkItem: (data) =>
      prisma.workItem.create({ data: data as never, select: { id: true } }),
    setCapsuleWorkItem: async (capsuleId, workItemId) => {
      await prisma.workroom.updateMany({
        where: { OR: [{ capsuleId }, { id: capsuleId }] },
        data: { workItemId },
      });
    },
  };
}

/**
 * Resolve-or-create the canonical WorkItem for a capsule and link it. Backlog-backed
 * capsules converge on the backlog case; ad-hoc capsules get a stable capsule case.
 * Callers MUST treat failures as non-fatal (the capsule stays usable).
 */
export async function ensureCapsuleWorkItemAnchorWithPrisma(args: {
  capsuleId: string;
  backlogItemId: string | null | undefined;
  title: string;
}): Promise<CapsuleWorkItemAnchorResult | null> {
  return ensureCapsuleWorkItemAnchor({
    ports: prismaAnchorPorts(),
    capsuleId: args.capsuleId,
    backlogItemId: args.backlogItemId,
    title: args.title,
  });
}

/** Best-effort boundary used by capsule-originating tools. */
export async function ensureCapsuleWorkItemAnchorNonFatal(
  capsule: { capsuleId: string; backlogItemId: string | null; title: string },
  action: string,
): Promise<void> {
  try {
    await ensureCapsuleWorkItemAnchorWithPrisma(capsule);
  } catch (error) {
    console.warn(`[work-convergence] WorkItem anchor skipped for ${action} ${capsule.capsuleId}: ${getErrorMessage(error)}`);
  }
}
