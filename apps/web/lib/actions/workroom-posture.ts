"use server";

/**
 * EP-WORK-POSTURE — the operator-facing write path for a room's posture.
 *
 * WHY THIS EXISTS. The room has shown its pace and priority since BI-4F468192,
 * and until now there was NO WAY TO SET EITHER from the portal. The claim
 * writers existed with zero callers; the only write path was an MCP parameter
 * at convene time, which an operator never touches. A surface that displays a
 * setting it gives you no way to change is the same inert-control problem this
 * epic exists to remove — reproduced in the epic's own UI.
 *
 * Two altitudes, one behaviour, mirroring how the coworker priority actions are
 * organised (lib/actions/golden-triangle.ts):
 *   • per room      — this room's declared posture and shape
 *   • decreed default — how rooms behave here unless the room says otherwise
 *
 * `view_platform`-gated: a room's posture is shared state that governs what
 * every participant may do, not a per-user preference.
 */
import { revalidatePath } from "next/cache";

import { Prisma, prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  clearWorkroomPostureDefault,
  getWorkroomPostureDefault,
  setWorkroomPostureDefault,
} from "@/lib/work-management/workroom-posture-defaults";
import { withWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { buildWorkroomShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { WORKROOM_SHAPE_KEYS, type WorkroomShapeKey } from "@/lib/work-management/room-shapes";
import type { RoomPostureDeclaration } from "@/lib/work-posture";

async function requirePlatformAdmin() {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }
  return user;
}

function revalidateRoom(caseKey: string): void {
  revalidatePath(`/workspace/cases/${caseKey}`);
  revalidatePath("/workspace/my-queue");
}

/**
 * Set THIS room's posture. The declaration outranks derivation for cadence, but
 * its action boundary still passes through the tighten-only clamp in
 * resolveWorkPosture — declaring a posture can restrict what the room may do and
 * can never widen it, however this action is called.
 */
export async function saveWorkroomPosture(
  roomRowId: string,
  caseKey: string,
  declaration: RoomPostureDeclaration,
): Promise<{ ok: boolean }> {
  const user = await requirePlatformAdmin();
  try {
    const room = await prisma.workroom.findUnique({
      where: { id: roomRowId },
      select: { scopeClaims: true },
    });
    if (!room) return { ok: false };
    const next = withWorkroomPostureClaim(room.scopeClaims, {
      ...declaration,
      declaredBy: user.id ?? null,
      declaredAt: new Date().toISOString(),
    });
    await prisma.workroom.update({
      where: { id: roomRowId },
      data: { scopeClaims: next as Prisma.InputJsonValue },
    });
    revalidateRoom(caseKey);
    return { ok: true };
  } catch (err) {
    console.warn("[workroom-posture] save failed:", err);
    return { ok: false };
  }
}

/** Clear this room's declared posture so it falls back to derivation and the default. */
export async function resetWorkroomPosture(
  roomRowId: string,
  caseKey: string,
): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  try {
    const room = await prisma.workroom.findUnique({
      where: { id: roomRowId },
      select: { scopeClaims: true },
    });
    if (!room) return { ok: false };
    // Drop only the posture entry; every other claim (including the shape) stays.
    const kept = Array.isArray(room.scopeClaims)
      ? (room.scopeClaims as unknown[]).filter(
          (entry) =>
            !(entry && typeof entry === "object" && "workroomPosture" in (entry as object)),
        )
      : [];
    await prisma.workroom.update({
      where: { id: roomRowId },
      data: { scopeClaims: kept as Prisma.InputJsonValue },
    });
    revalidateRoom(caseKey);
    return { ok: true };
  } catch (err) {
    console.warn("[workroom-posture] reset failed:", err);
    return { ok: false };
  }
}

/**
 * Set THIS room's collaboration shape. The shape is what bounds the action
 * envelope, so this is the higher-leverage of the two controls: it changes what
 * is permitted at all, where the posture only changes how hard the room pushes
 * inside those bounds.
 */
export async function saveWorkroomShape(
  roomRowId: string,
  caseKey: string,
  shape: WorkroomShapeKey,
): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  if (!WORKROOM_SHAPE_KEYS.includes(shape)) return { ok: false };
  try {
    const room = await prisma.workroom.findUnique({
      where: { id: roomRowId },
      select: { scopeClaims: true },
    });
    if (!room) return { ok: false };
    const existing = Array.isArray(room.scopeClaims) ? (room.scopeClaims as unknown[]) : [];
    // Replace any prior shape claim rather than appending a second one — the
    // reader returns the FIRST valid declaration, so a stale entry would win.
    const kept = existing.filter(
      (entry) => !(entry && typeof entry === "object" && "workroomShape" in (entry as object)),
    );
    await prisma.workroom.update({
      where: { id: roomRowId },
      data: { scopeClaims: [...kept, buildWorkroomShapeClaim(shape)] as Prisma.InputJsonValue },
    });
    revalidateRoom(caseKey);
    return { ok: true };
  } catch (err) {
    console.warn("[workroom-posture] shape save failed:", err);
    return { ok: false };
  }
}

// ── The decreed default ──────────────────────────────────────────────────────

/** Read the decreed default for rooms (null when none is set). */
export async function readWorkroomPostureDefault(): Promise<RoomPostureDeclaration | null> {
  await requirePlatformAdmin();
  return getWorkroomPostureDefault();
}

/** Decree how rooms behave here unless the room says otherwise. */
export async function saveWorkroomPostureDefault(
  declaration: RoomPostureDeclaration,
): Promise<{ ok: boolean }> {
  const user = await requirePlatformAdmin();
  const ok = await setWorkroomPostureDefault({
    ...declaration,
    declaredBy: user.id ?? null,
    declaredAt: new Date().toISOString(),
  });
  if (ok) {
    revalidatePath("/platform/ai/priority");
    revalidatePath("/workspace/my-queue");
  }
  return { ok };
}

/** Remove the decree so rooms fall back to the coworker/org/platform ladder. */
export async function resetWorkroomPostureDefault(): Promise<{ ok: boolean }> {
  await requirePlatformAdmin();
  const ok = await clearWorkroomPostureDefault();
  if (ok) {
    revalidatePath("/platform/ai/priority");
    revalidatePath("/workspace/my-queue");
  }
  return { ok };
}
