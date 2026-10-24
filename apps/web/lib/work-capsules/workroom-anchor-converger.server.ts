// Prisma binding for workroom-anchor-converger.ts. See that module for why.
import { prisma } from "@dpf/db";

import { prismaAnchorPorts } from "./capsule-workitem-anchor.server";
import {
  AnchorFailureBackoff,
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
        // Terminal rooms included: a completed room whose case page 404s is still a
        // room that exists but cannot be opened (79 of the 91 left behind by the
        // first pass were "complete"). Only archived rows are out of scope.
        where: { archivedAt: null, workItemId: null },
        orderBy: { createdAt: "asc" },
        take: limit,
        select: { capsuleId: true, backlogItemId: true, title: true },
      }),
  };
}

/** Process-wide so a room that cannot be anchored is retried hourly, not per tick. */
const backoff = new AnchorFailureBackoff();

export async function convergeWorkroomAnchorsWithPrisma(): Promise<WorkroomAnchorConvergeResult> {
  return convergeWorkroomAnchors({ ports: prismaConvergerPorts(), backoff });
}
