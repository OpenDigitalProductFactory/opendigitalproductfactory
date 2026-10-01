"use server";

/**
 * Record the decision a governed Workroom stage is waiting on.
 *
 * A `governed-decision` stage with a role/person principal becomes attention
 * and the drive refuses to execute it; before this action nothing let a person
 * record the decision, so the room waited forever. The decision is written as
 * that stage's evidence through the one governed evidence write, and the drive
 * earns the completing receipt from it on its next tick — this action never
 * touches receipts or the drive state.
 *
 * The caller is taken from the session. Who may decide is checked server-side
 * (the room's accountable owner, DI-A76F0C10EF14 fallback); the page hiding the
 * control from everyone else is presentation, not the control.
 */
import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { err, type ActionResult } from "@/lib/shared/action-result";
import { recordWorkroomStageDecisionForUser } from "@/lib/work-management/workroom-stage-decision.server";

export async function recordWorkroomStageDecision(
  caseKey: string,
  roomRowId: string,
  decision: { stageKey: string; choice: "accept" | "patch" | "defer"; deferUntil?: string; rationale?: string },
): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return err("Sign in to record this decision.");
  try {
    const result = await recordWorkroomStageDecisionForUser(prisma as never, {
      userId,
      roomRowId,
      stageKey: decision.stageKey,
      choice: decision.choice,
      deferUntil: decision.deferUntil ?? null,
      rationale: decision.rationale ?? null,
    });
    if (!result.ok) return result;
    revalidatePath(`/workspace/cases/${caseKey}`);
    revalidatePath("/workspace/my-queue");
    return result;
  } catch (error) {
    console.warn("[workroom-stage-decision] record failed:", error);
    return err("The decision could not be recorded. Please try again.");
  }
}
