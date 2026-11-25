import { prisma } from "@dpf/db";
import type { ToolResult } from "@/lib/mcp-tool-types";

/** The person behind the call must be able to manage the platform; the assistant borrows nothing. */
async function requirePlatformManager(userId: string): Promise<ToolResult | null> {
  const { currentUserContext } = await import("@/lib/govern/current-user-context");
  const { can } = await import("@/lib/govern/permissions");
  const human = userId ? await currentUserContext(userId) : null;
  if (!human || !can(human, "manage_platform")) {
    return { success: false, error: "forbidden", message: "Handing over an account's work needs a person with platform-management permission." };
  }
  return null;
}

export async function planAccountHandoverHandler(sourceAccount: string, userId: string): Promise<ToolResult> {
  const refusal = await requirePlatformManager(userId);
  if (refusal) return refusal;
  const { liveAgentAccessNote, planAccountHandover } = await import("@/lib/work-management/account-handover");
  const plan = await planAccountHandover(prisma as never, { sourceAccount });
  if (!plan.ok) return { success: false, error: "handover_refused", message: plan.error };
  const count = (kind: string) => plan.data.items.filter((i) => i.kind === kind).length;
  // The handover moves work, not access (BI-9D2199D4): say what stays live and where to end it.
  const access = liveAgentAccessNote(plan.data.sourceEmail, plan.data.liveAgentCredentials);
  return {
    success: true,
    message: `${plan.data.items.length} item(s) would move from ${plan.data.sourceEmail}: ${count("room")} room(s), ${count("build")} build(s), ${count("scheduled-task")} scheduled task(s). ${plan.data.refused.length} refused.${access}`,
    data: plan.data,
  };
}

export async function applyAccountHandoverHandler(
  input: { sourceAccount: string; digest: string; reason: string },
  userId: string,
): Promise<ToolResult> {
  const refusal = await requirePlatformManager(userId);
  if (refusal) return refusal;
  const { applyAccountHandover } = await import("@/lib/work-management/account-handover");
  const result = await applyAccountHandover(prisma as never, {
    ...input,
    actor: { userId },
  });
  if (!result.ok) return { success: false, error: "handover_refused", message: result.error };
  const { rooms, builds, scheduledTasks, failed } = result.data;
  return {
    success: failed.length === 0,
    message: `Handed over ${rooms} room(s), ${builds} build(s) and ${scheduledTasks} scheduled task(s).${failed.length ? ` ${failed.length} item(s) could not move; run the dry run again for the rest.` : ""}`,
    data: result.data,
  };
}
