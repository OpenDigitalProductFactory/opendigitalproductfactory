// GPP admission for worktree provisioning (BI-D1FB8C4D, design
// docs/superpowers/specs/2026-10-14-worktree-provisioning-under-gpp-design.md §3).
//
// A room's work shape grants are the envelope of what may happen inside it. Room
// grants narrow an in-portal coworker turn (room-turn-authority.ts), but nothing
// carries them to an external MCP caller, so a read-only room could still plan,
// claim or bind a worktree from a CLI. This is the one rule both paths share: a
// room admits provisioning only when its shape's resolved grants satisfy
// `worktree_provision`, exactly as `roomAuthorizesTool` would decide it.
import { grantsSatisfyRequirement } from "@/lib/tak/agent-grants";
import { roomGrantsFromWorkShape } from "@/lib/work-management/room-turn-authority";
import { getWorkShapeVersion } from "@/lib/work-management/work-shapes";
import { parseWorkShapeRef, readWorkShapeClaimRef } from "@/lib/work-management/workroom-shape-claim";

export const WORKTREE_PROVISION_GRANT = "worktree_provision";

/** The source-read tools a refused caller uses instead of a working copy. */
export const SOURCE_READ_TOOLS = [
  "read_source_at_version",
  "search_source_at_version",
  "list_source_directory",
  "read_project_file",
] as const;

export type ProvisionRoom = { capsuleId: string; workShapeRef: string | null };

export type WorktreeProvisionAdmission =
  | { admitted: true; unshaped: boolean }
  | {
    admitted: false;
    code: "worktree_provision_not_admitted" | "unknown_work_shape";
    capsuleId: string;
    workShapeRef: string;
  };

/** Whether one shape ref admits provisioning; null when the ref resolves to no shape. */
function shapeAdmitsProvisioning(workShapeRef: string): boolean | null {
  const ref = parseWorkShapeRef(workShapeRef);
  const shape = ref ? getWorkShapeVersion(ref.key, ref.version) : null;
  if (!shape) return null;
  return grantsSatisfyRequirement([WORKTREE_PROVISION_GRANT], roomGrantsFromWorkShape(shape.grants));
}

/**
 * Admit provisioning for every room the call touches. Refuses on the first room
 * whose shape lacks the capability, and on any shape ref that resolves to nothing
 * (fail closed). A room with no declared shape is admitted and reported as
 * unshaped: closing that gap changes every legacy room (BI-293B21F4).
 */
export function admitWorktreeProvision(rooms: readonly ProvisionRoom[]): WorktreeProvisionAdmission {
  let unshaped = false;
  for (const room of rooms) {
    if (!room.workShapeRef) {
      unshaped = true;
      continue;
    }
    const admits = shapeAdmitsProvisioning(room.workShapeRef);
    if (admits === null) {
      return { admitted: false, code: "unknown_work_shape", capsuleId: room.capsuleId, workShapeRef: room.workShapeRef };
    }
    if (!admits) {
      return { admitted: false, code: "worktree_provision_not_admitted", capsuleId: room.capsuleId, workShapeRef: room.workShapeRef };
    }
  }
  return { admitted: true, unshaped };
}

/** A room as the store returns it, reduced to what admission reads. */
export function provisionRoomOf(row: { capsuleId: string; scopeClaims?: unknown }): ProvisionRoom {
  return { capsuleId: row.capsuleId, workShapeRef: readWorkShapeClaimRef(row.scopeClaims) };
}

/** The typed tool refusal for a room that does not admit provisioning. */
export function worktreeProvisionRefusal(
  admission: Extract<WorktreeProvisionAdmission, { admitted: false }>,
  toolName: string,
) {
  const reason = admission.code === "unknown_work_shape"
    ? `Workroom ${admission.capsuleId} declares work shape ${admission.workShapeRef}, which resolves to no registered shape, so ${toolName} is refused.`
    : `Workroom ${admission.capsuleId} runs on ${admission.workShapeRef}, which does not admit worktree provisioning, so ${toolName} is refused.`;
  return {
    success: false as const,
    error: admission.code,
    message: `${reason} Read source through ${SOURCE_READ_TOOLS.join(", ")} instead. If the work needs a change, claim the backlog item with a delivery shape; that claim is the route to a worktree.`,
    data: {
      capsuleId: admission.capsuleId,
      workShape: admission.workShapeRef,
      nextAction: { sourceReadTools: [...SOURCE_READ_TOOLS], claimTool: "claim_backlog_item_for_work" },
    },
  };
}
