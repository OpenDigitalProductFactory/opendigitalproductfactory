// Batched executor handover (BI-D4144471, design
// 2026-10-21-executor-takeover-design.md §3.3).
//
// A person whose assistant session ended may own several rooms. Rather than one
// approval per room, `reassign_workroom_executor { capsuleIds }` first dry-runs
// the set, returning each room's current executor and lease holder plus a
// `planDigest` over them. Applying takes the same set and digest; the approval
// fingerprint covers both, so one approval covers exactly that set. Each room is
// then handed over by the existing single-room handover, which compares the
// planned lease holder under the row lock: a room taken in between is skipped
// and reported, never overwritten. A room set that changed before the apply
// refuses the whole call.

import { createHash } from "node:crypto";

import type { ToolResult } from "@/lib/mcp-tool-types";
import { isRecord } from "@/lib/shared/coerce";
import type { CapsuleDb } from "./work-capsule-store-types";

export const BATCH_HANDOVER_MAX_ROOMS = 20;

export type BatchHandoverPlanRow = {
  capsuleId: string;
  fromExecutorKind: string | null;
  expectedLeaseHolderPrincipalId: string | null;
};


/**
 * The room's last executor checkpoint (`workspaceState.executorCheckpoint`),
 * or null. Read defensively: rooms written before checkpoints existed have none.
 */
export function storedExecutorCheckpoint(workspaceState: unknown): Record<string, unknown> | null {
  if (!isRecord(workspaceState)) return null;
  const checkpoint = workspaceState["executorCheckpoint"];
  return isRecord(checkpoint) ? checkpoint : null;
}

/** sha256 of the (capsuleId, fromExecutorKind, expectedLeaseHolder) tuples, sorted by room. */
export function batchHandoverPlanDigest(rows: BatchHandoverPlanRow[]): string {
  const tuples = [...rows]
    .sort((a, b) => (a.capsuleId < b.capsuleId ? -1 : a.capsuleId > b.capsuleId ? 1 : 0))
    .map((row) => [row.capsuleId, row.fromExecutorKind, row.expectedLeaseHolderPrincipalId]);
  return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
}

/** The validated room set, or a message saying why it is not one. */
export function parseBatchCapsuleIds(value: unknown): { ids: string[] } | { problem: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > BATCH_HANDOVER_MAX_ROOMS) {
    return { problem: `capsuleIds must list 1 to ${BATCH_HANDOVER_MAX_ROOMS} workrooms.` };
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) return { problem: "Each capsuleIds entry must be a Workroom id (WC-*)." };
    ids.push(entry.trim());
  }
  if (new Set(ids).size !== ids.length) return { problem: "capsuleIds lists a workroom more than once." };
  return { ids };
}

const invalid = (message: string): ToolResult => ({ success: false, error: "invalid_input", message });

type RoomRow = { capsuleId: string; executorKind: string | null; leaseHolderPrincipalId: string | null; workspaceState: unknown };

/**
 * Run `reassign_workroom_executor` for a set of rooms. `handOverOne` is the
 * single-room handover (`capsuleId` params), so each room gets the same lease
 * compare-and-set, assistant admission and `executor-changed` activity.
 */
export async function runBatchExecutorHandover(args: {
  params: Record<string, unknown>;
  db: CapsuleDb;
  handOverOne: (params: Record<string, unknown>) => Promise<ToolResult>;
}): Promise<ToolResult> {
  const { params } = args;
  if (Object.hasOwn(params, "capsuleId")) return invalid("Send capsuleId for one workroom or capsuleIds for a set, not both.");
  if (Object.hasOwn(params, "phase")) return invalid("A handoff phase applies to one workroom; send capsuleId instead of capsuleIds.");
  const parsed = parseBatchCapsuleIds(params["capsuleIds"]);
  if ("problem" in parsed) return invalid(parsed.problem);
  const text = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const toExecutorKind = text("toExecutorKind");
  if (!toExecutorKind) return invalid("toExecutorKind is required.");
  const apply = params["dryRun"] === false;
  const planDigest = text("planDigest");
  if (apply && !planDigest) return invalid("planDigest from the dry run is required to apply the handover.");

  const found = (await args.db.workroom.findMany({
    where: { capsuleId: { in: parsed.ids } },
    select: { capsuleId: true, executorKind: true, leaseHolderPrincipalId: true, workspaceState: true },
  })) as RoomRow[];
  const byId = new Map(found.map((room) => [room.capsuleId, room]));
  const missing = parsed.ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { success: false, error: "workroom_not_found", message: `No workroom ${missing.join(", ")}.`, data: { missing } };
  }
  const rooms = [...parsed.ids].sort().map((id) => {
    const room = byId.get(id)!;
    return {
      capsuleId: id,
      fromExecutorKind: room.executorKind ?? null,
      expectedLeaseHolderPrincipalId: room.leaseHolderPrincipalId ?? null,
      checkpoint: storedExecutorCheckpoint(room.workspaceState),
    };
  });
  const currentDigest = batchHandoverPlanDigest(rooms);

  if (!apply) {
    return {
      success: true,
      message: `Planned handover of ${rooms.length} workroom(s) to ${toExecutorKind}. Apply it with dryRun false and this planDigest.`,
      data: {
        dryRun: true,
        planDigest: currentDigest,
        rooms,
        apply: { capsuleIds: rooms.map((room) => room.capsuleId), toExecutorKind, dryRun: false, planDigest: currentDigest },
      },
    };
  }
  if (planDigest !== currentDigest) {
    return {
      success: false,
      error: "handover_plan_changed",
      message: "The rooms changed since the dry run; run the dry run again.",
      data: { planDigest: currentDigest },
    };
  }

  const manifest = isRecord(params["handoffManifest"]) ? params["handoffManifest"] : {};
  const outcomes: Array<Record<string, unknown>> = [];
  for (const room of rooms) {
    const result = await args.handOverOne({
      capsuleId: room.capsuleId,
      toExecutorKind,
      toExecutorRef: text("toExecutorRef"),
      reason: text("reason"),
      handoffManifest: { ...manifest, checkpoint: room.checkpoint },
      expectedLeaseHolderPrincipalId: room.expectedLeaseHolderPrincipalId,
    });
    if (result.success) outcomes.push({ capsuleId: room.capsuleId, outcome: "handed-over" });
    else outcomes.push({
      capsuleId: room.capsuleId,
      outcome: result.error === "lease_holder_changed" ? "skipped" : "failed",
      error: result.error ?? "reassign_failed",
      message: result.message,
    });
  }
  const count = (outcome: string) => outcomes.filter((row) => row.outcome === outcome).length;
  const handedOver = count("handed-over");
  const skipped = count("skipped");
  const failed = count("failed");
  return {
    success: failed === 0,
    ...(failed > 0 ? { error: "handover_partially_failed" } : {}),
    message: `Handed over ${handedOver} of ${rooms.length} workroom(s) to ${toExecutorKind}`
      + (skipped ? `; skipped ${skipped} whose lease holder changed` : "")
      + (failed ? `; ${failed} failed` : "")
      + ". Call get_workroom on each to see where the work stands.",
    data: { handedOver, skipped, failed, rooms: outcomes },
  };
}
