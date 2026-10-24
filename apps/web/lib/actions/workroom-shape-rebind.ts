"use server";

/**
 * Move a Workroom to the current version of its work shape (BI-CB5C0DCE).
 *
 * GPP §2.1.1: a widening reaches a live room only through a fresh decision.
 * The caller comes from the session. Who may decide (the room's accountable
 * owner, or a platform manager) is checked server-side; the page hiding the
 * control from everyone else is presentation, not the control.
 */
import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/permissions";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { rebindWorkroomShapeForUser } from "@/lib/work-management/workroom-shape-rebind.server";

export async function rebindWorkroomShape(
  caseKey: string,
  roomRowId: string,
  decision: { toVersion: string; rationale?: string },
): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return err("Sign in to move this room.");
  try {
    const human = await currentUserContext(userId);
    const result = await rebindWorkroomShapeForUser(prisma as never, {
      roomRowId,
      toVersion: decision.toVersion,
      rationale: decision.rationale ?? null,
      dryRun: false,
      userId,
      callerHasManagePlatform: Boolean(human && can(human, "manage_platform")),
    });
    if (!result.ok) return err(result.error);
    revalidatePath(`/workspace/cases/${caseKey}`);
    revalidatePath("/workspace/inbox");
    return ok();
  } catch (error) {
    console.warn("[workroom-shape-rebind] rebind failed:", error);
    return err("The room could not be moved. Please try again.");
  }
}
