"use server";

/**
 * The operator-facing write path for a room's declared boundary.
 *
 * WHY THIS EXISTS. The room detail page has shown a boundary notice listing up
 * to eleven gaps — "Outcome not defined", "Accountable owner not assigned" —
 * and there was no way to define any of them from the portal. Worse, nothing
 * could: workspace-case-loader.ts built the boundary with every field hardcoded
 * null except the purpose, so the notice was permanently red on every room on
 * every install while the header printed "NEXT ACTION: Assign owner".
 *
 * This is the same inert-control defect WorkroomPostureControl was written to
 * remove one panel higher up the page, and it is fixed the same way: a claim in
 * Workroom.scopeClaims, a server action beside the posture one, and a control
 * where the notice already tells you what is missing.
 *
 * `view_platform`-gated, matching saveWorkroomPosture. A room's boundary is
 * shared state that governs what every participant may do — who answers for the
 * room, what it may decide, what sensitivity it admits — not a per-user
 * preference.
 */
import { revalidatePath } from "next/cache";

import { Prisma, prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { can } from "@/lib/permissions";
import {
  withWorkroomBoundaryClaim,
  type WorkroomBoundaryClaim,
} from "@/lib/work-management/workroom-boundary-claim";

async function requirePlatformAdmin() {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }
  return user;
}

/**
 * Declare THIS room's boundary. Fields left blank are cleared rather than
 * merged, so the form is what the room says — an operator who removes an
 * outcome means the room no longer has one, and the notice must go back to
 * reporting that.
 */
export async function saveWorkroomBoundary(
  caseKey: string,
  roomRowId: string,
  boundary: WorkroomBoundaryClaim,
): Promise<ActionResult> {
  await requirePlatformAdmin();
  try {
    const room = await prisma.workroom.findUnique({
      where: { id: roomRowId },
      select: { scopeClaims: true },
    });
    if (!room) return err("That room could not be found.");

    const next = withWorkroomBoundaryClaim(room.scopeClaims, boundary);
    await prisma.workroom.update({
      where: { id: roomRowId },
      data: { scopeClaims: next as Prisma.InputJsonValue },
    });

    revalidatePath(`/workspace/cases/${caseKey}`);
    revalidatePath("/workspace/my-queue");
    return ok();
  } catch (error) {
    console.warn("[workroom-boundary] save failed:", error);
    return err("That room could not be found.");
  }
}
