// Loads the rooms a provisioning call touches and applies the GPP admission
// (worktree-provision-admission.ts). Called at the top of plan_workroom_worktree,
// claim_workroom_scope and adopt_worktree, before any write, so an external MCP
// caller is gated by the room's work shape even though no room authority
// reaches it (BI-D1FB8C4D).
import type { ToolResult } from "@/lib/mcp-tool-types";

import {
  admitWorktreeProvision,
  provisionRoomOf,
  worktreeProvisionRefusal,
  type ProvisionRoom,
} from "./worktree-provision-admission";
import { TERMINAL_CAPSULE_STATUSES } from "./work-capsule-branch-identity";
import type { CapsuleDb } from "./work-capsule-store-types";

type RoomReader = Pick<CapsuleDb["workroom"], "findFirst" | "findMany">;

const ROOM_SELECT = { capsuleId: true, scopeClaims: true } as const;

/** Refusal for a call on one existing room, or null when the room admits provisioning. */
export async function refuseUnlessRoomProvisions(
  db: { workroom: RoomReader },
  capsuleId: string,
  toolName: string,
): Promise<ToolResult | null> {
  const row = await db.workroom.findFirst({ where: { capsuleId }, select: ROOM_SELECT });
  // An unknown room is the handler's own not-found answer, not this gate's.
  if (!row) return null;
  const admission = admitWorktreeProvision([provisionRoomOf(row)]);
  return admission.admitted ? null : worktreeProvisionRefusal(admission, toolName);
}

/**
 * Refusal for an adoption, or null when every room it touches admits
 * provisioning: the shape the caller asks the new room to declare, the room the
 * branch already has, and every live room the caller's session holds. A session
 * working a read-only inquiry cannot open a worktree beside it.
 */
export async function refuseUnlessAdoptionProvisions(
  db: { workroom: RoomReader },
  input: { repositoryFullName: string; headBranch: string; sessionRef: string | null; requestedWorkShape: string | null },
  toolName: string,
): Promise<ToolResult | null> {
  const rooms: ProvisionRoom[] = [];
  if (input.requestedWorkShape) rooms.push({ capsuleId: "(requested)", workShapeRef: input.requestedWorkShape });
  const branchRoom = await db.workroom.findFirst({
    where: { repositoryFullName: input.repositoryFullName, headBranch: input.headBranch, status: { notIn: TERMINAL_CAPSULE_STATUSES } },
    select: ROOM_SELECT,
  });
  if (branchRoom) rooms.push(provisionRoomOf(branchRoom));
  if (input.sessionRef) {
    const sessionRooms = await db.workroom.findMany({
      where: { executorRef: input.sessionRef, archivedAt: null, status: { notIn: TERMINAL_CAPSULE_STATUSES } },
      select: ROOM_SELECT,
    });
    for (const row of sessionRooms ?? []) rooms.push(provisionRoomOf(row));
  }
  const admission = admitWorktreeProvision(rooms);
  return admission.admitted ? null : worktreeProvisionRefusal(admission, toolName);
}
