import { prisma } from "@dpf/db";
import { readSemanticReviewRecovery } from "@/lib/change-review/semantic-review-recovery-readback";
import type { ToolResult } from "@/lib/mcp-tool-types";

export function validateOwnedReviewInput(taskRunId: unknown, userId?: string): ToolResult | null {
  if (taskRunId !== undefined && (typeof taskRunId !== "string"
    || !taskRunId.trim() || taskRunId !== taskRunId.trim() || taskRunId.length > 512)) {
    return { success: false, error: "invalid_reviewTaskRunId", message: "reviewTaskRunId must be a nonempty task identifier of at most 512 characters." };
  }
  if (taskRunId !== undefined && !userId) {
    return { success: false, error: "review_owner_required", message: "An authenticated task owner is required for review recovery." };
  }
  return null;
}

/** Exact-task recovery is separate from the room's current-source review verdict. */
export async function readOwnedRoomReview(capsuleId: string, taskRunId: string, userId: string) {
  const row = await prisma.taskRun.findFirst({
    where: { taskRunId, userId, AND: [
      { a2aMetadata: { path: ["gateKind"], equals: "semantic-review" } },
      { a2aMetadata: { path: ["capsuleId"], equals: capsuleId } },
    ] },
    select: { id: true, taskRunId: true, userId: true, status: true, updatedAt: true,
      progressPayload: true, a2aMetadata: true },
  });
  if (!row || row.userId !== userId) return null;
  // The shared reader rechecks ownership and exposes only bounded recovery facts,
  // never raw provider output or an inferred approval/settlement.
  return { taskRunId: row.taskRunId, status: row.status,
    recovery: await readSemanticReviewRecovery({ ...row, userId }, userId) };
}
