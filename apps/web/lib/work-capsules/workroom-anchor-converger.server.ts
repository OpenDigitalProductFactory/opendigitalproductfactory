// Prisma binding for workroom-anchor-converger.ts. See that module for why.
import { prisma } from "@dpf/db";

import { TERMINAL_CAPSULE_STATUSES } from "./work-capsule-branch-identity";
import { prismaAnchorPorts } from "./capsule-workitem-anchor.server";
import {
  convergeWorkroomAnchors,
  type WorkroomAnchorConvergeResult,
  type WorkroomAnchorConvergerPorts,
} from "./workroom-anchor-converger";

/** Set to "1" to stop the converger without a deploy. Absent by default: the
 *  fix must reach every install with no operator action (DI-B3E42B8A9B48). */
export const WORKROOM_ANCHOR_CONVERGER_KILL_SWITCH = "DPF_WORKROOM_ANCHOR_CONVERGER_DISABLED";

export function prismaConvergerPorts(): WorkroomAnchorConvergerPorts {
  return {
    ...prismaAnchorPorts(),
    // Oldest first so the long-standing gap closes before today's; terminal
    // rooms are still anchored — completed work is listed and must open too.
    listUnanchoredRooms: (limit) =>
      prisma.workroom.findMany({
        where: { archivedAt: null, workItemId: null, status: { notIn: TERMINAL_CAPSULE_STATUSES } },
        orderBy: { createdAt: "asc" },
        take: limit,
        select: { capsuleId: true, backlogItemId: true, title: true },
      }),
  };
}

export async function convergeWorkroomAnchorsWithPrisma(): Promise<WorkroomAnchorConvergeResult> {
  return convergeWorkroomAnchors({ ports: prismaConvergerPorts() });
}
