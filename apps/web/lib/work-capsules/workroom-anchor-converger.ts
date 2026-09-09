// apps/web/lib/work-capsules/workroom-anchor-converger.ts
//
// A room is reachable by construction (kernel principle). On the live install
// 289 of 468 open rooms had no Workroom.workItemId, so their case page 404'd:
// 36 whose backlog item already had a WorkItem, 205 whose backlog item had none,
// 48 with no backlog item at all. Every one of them is exactly what
// ensureCapsuleWorkItemAnchor (BI-650994D7) already resolves — the creators just
// never called it, or ran it best-effort and moved on.
//
// This converger closes the existing gap on every install and keeps it closed:
// it walks unanchored rooms in bounded batches and passes each through the ONE
// canonical anchor helper. Additive and reversible (the FK is nullable; a
// WorkItem is created, nothing deleted), so unlike the reaper it actuates by
// default — deployments are cumulative and an install must converge without an
// operator remembering to run anything (BI-A5EEB5D1, decision DI-B3E42B8A9B48).
//
// Pure core with injected ports; the prisma binding lives in
// workroom-anchor-converger.server.ts.
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { ensureCapsuleWorkItemAnchor, type WorkItemAnchorPorts } from "./capsule-workitem-anchor";

export interface UnanchoredRoom {
  capsuleId: string;
  backlogItemId: string | null;
  title: string;
}

export interface WorkroomAnchorConvergerPorts extends WorkItemAnchorPorts {
  /** Non-archived rooms with no workItemId, oldest first, at most `limit`. */
  listUnanchoredRooms(limit: number): Promise<UnanchoredRoom[]>;
}

export interface WorkroomAnchorConvergeResult {
  /** Rooms examined this pass (bounded by the batch). */
  candidates: number;
  /** Rooms now carrying a workItemId. */
  anchored: number;
  /** Of those, how many needed a new WorkItem minted rather than linked. */
  created: number;
  /** Rooms that could not be anchored, with the reason — never silently skipped. */
  failed: Array<{ capsuleId: string; reason: string }>;
}

/** Bounded so a tick never holds a long transaction over hundreds of rooms. */
export const WORKROOM_ANCHOR_CONVERGER_BATCH = 50;

export async function convergeWorkroomAnchors(args: {
  ports: WorkroomAnchorConvergerPorts;
  batch?: number;
}): Promise<WorkroomAnchorConvergeResult> {
  const batch = args.batch ?? WORKROOM_ANCHOR_CONVERGER_BATCH;
  const rooms = await args.ports.listUnanchoredRooms(batch);
  const result: WorkroomAnchorConvergeResult = {
    candidates: rooms.length,
    anchored: 0,
    created: 0,
    failed: [],
  };

  for (const room of rooms) {
    try {
      const outcome = await ensureCapsuleWorkItemAnchor({
        ports: args.ports,
        capsuleId: room.capsuleId,
        backlogItemId: room.backlogItemId,
        title: room.title,
      });
      if (outcome) {
        result.anchored += 1;
        if (outcome.created) result.created += 1;
      }
    } catch (error) {
      // One bad room must not stop the rest of the batch; it is reported, not hidden.
      result.failed.push({
        capsuleId: room.capsuleId,
        reason: getErrorMessage(error),
      });
    }
  }

  return result;
}
