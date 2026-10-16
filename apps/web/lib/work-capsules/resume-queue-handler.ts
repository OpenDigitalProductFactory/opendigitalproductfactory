// resume_workroom_queue: release a Workroom's provider hold (BI-2B6A8A74).
// Receipted through receiptedWorkroomTool, so a retried resume with the same
// commandId takes effect once and returns the stored answer.

import type { ToolResult } from "@/lib/mcp-tool-types";

import { workCapsuleActor } from "./handler-actor";
import { commandDb } from "./receipted-tool";
import { resumeWorkroomQueue } from "./workroom-queue-hold";

type ToolContext = { agentId?: string; authSource?: string; apiTokenId?: string } | undefined;

export async function resumeWorkroomQueueTool(
  params: Record<string, unknown>,
  userId: string,
  context: ToolContext,
): Promise<ToolResult> {
  const capsuleId = typeof params["capsuleId"] === "string" ? params["capsuleId"].trim() : "";
  const reason = typeof params["reason"] === "string" ? params["reason"].trim() : "";
  if (!capsuleId || !reason) {
    return { success: false, error: "invalid_input", message: "capsuleId and reason are required." };
  }
  const actor = await workCapsuleActor(userId, context);
  try {
    const { resumed, hold } = await resumeWorkroomQueue({ db: commandDb(), capsuleId, reason, actor });
    return {
      success: true,
      message: resumed
        ? `Queue resumed for ${capsuleId}; the held stage (${hold?.taskId}) runs on the next dispatch.`
        : `${capsuleId} has no held queue; nothing changed.`,
      data: { capsuleId, resumed, released: hold },
    };
  } catch (error) {
    if (error instanceof Error && /not found/.test(error.message)) {
      return { success: false, error: "not_found", message: error.message };
    }
    throw error;
  }
}
