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

/** How long a room that failed to anchor is left alone before it is retried.
 *  A room can fail for a reason no retry will change — the first one found was
 *  a row whose `source` violated the DB check constraint, so every UPDATE
 *  failed. Retrying that once a minute logged 1,147 identical failures. Once
 *  an hour keeps the room visible without drowning the log (BI-A5EEB5D1). */
export const WORKROOM_ANCHOR_RETRY_AFTER_MS = 60 * 60 * 1000;

/** In-memory, per-process. Losing it on restart is fine: the room is retried
 *  once and backs off again. */
export class AnchorFailureBackoff {
  private readonly retryAt = new Map<string, number>();
  constructor(private readonly retryAfterMs = WORKROOM_ANCHOR_RETRY_AFTER_MS) {}
  recordFailure(capsuleId: string, now: number): void {
    this.retryAt.set(capsuleId, now + this.retryAfterMs);
  }
  clear(capsuleId: string): void {
    this.retryAt.delete(capsuleId);
  }
  /** Rooms still inside their backoff window — exclude these from the batch. */
  skipped(now: number): string[] {
    const out: string[] = [];
    for (const [id, at] of this.retryAt) {
      if (at > now) out.push(id);
      else this.retryAt.delete(id);
    }
    return out;
  }
}

export async function convergeWorkroomAnchors(args: {
  ports: WorkroomAnchorConvergerPorts;
  batch?: number;
  backoff?: AnchorFailureBackoff;
  now?: number;
}): Promise<WorkroomAnchorConvergeResult> {
  const batch = args.batch ?? WORKROOM_ANCHOR_CONVERGER_BATCH;
  const now = args.now ?? Date.now();
  const skip = new Set(args.backoff?.skipped(now) ?? []);
  const rooms = (await args.ports.listUnanchoredRooms(batch + skip.size)).filter((r) => !skip.has(r.capsuleId)).slice(0, batch);
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
        args.backoff?.clear(room.capsuleId);
      }
    } catch (error) {
      args.backoff?.recordFailure(room.capsuleId, now);
      // One bad room must not stop the rest of the batch; it is reported, not hidden.
      result.failed.push({
        capsuleId: room.capsuleId,
        reason: getErrorMessage(error),
      });
    }
  }

  return result;
}
