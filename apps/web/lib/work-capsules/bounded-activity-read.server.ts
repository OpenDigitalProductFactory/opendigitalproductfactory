import { prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { resolveAgentWorkroomAccess, resolveHumanWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { readBoundedActivity } from "./bounded-activity-read";

/** Current admission is checked around the read; a numeric position grants nothing. */
export async function getBoundedWorkroomActivity(params: Record<string, unknown>, userId?: string, agentId?: string): Promise<ToolResult> {
  if (!userId) return { success: false, error: "workroom_content_access_required", message: "Use the governed Workroom reader with current content admission." };
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`;
      // This path must not fetch workspaceState, verificationState, recent raw
      // activity, or any payload before it knows what the caller requested.
      const room = await tx.workroom.findUnique({ where: { capsuleId: params.capsuleId as string },
        select: { id: true, capsuleId: true, activitySequence: true } });
      if (!room) return { success: false, error: "not_found", message: "Workroom not found." };
      return readBoundedActivity({ db: tx as never, room,
        canRead: async () => {
          const input = { userId, workroomId: room.id, requested: "content" as const };
          const access = agentId ? await resolveAgentWorkroomAccess({ ...input, agentId }, tx)
            : await resolveHumanWorkroomAccess(input, tx);
          return access.decision.level === "content";
        },
        hasLegacy: async () => Boolean(await tx.workroomActivity.findFirst({
          where: { workCapsuleId: room.id, sequence: null }, select: { id: true },
        })),
      }, params);
    }, { timeout: 5_000, maxWait: 1_000 });
  } catch {
    return { success: false, error: "activity_read_unavailable", message: "The bounded activity read did not complete. No cursor advancement or complete history is reported." };
  }
}
