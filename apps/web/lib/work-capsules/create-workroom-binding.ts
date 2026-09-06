// Bind a newly created Workroom to the backlog item its caller named.
//
// BI-CB3AEBBF. `Workroom.backlogItemId` is the column every subject lookup keys
// on — reviewer recovery in governed-work-claim.ts, and `subjectWhere` in
// backlog/initiative-readiness/repository-artifact.ts, which sits behind plan
// coverage and canonical-design resolution. An `outcomeAnchor` naming the item
// is invisible to all of them.
//
// So a room created FOR a backlog item recorded the anchor and left the column
// null, and the completion gate's own recovery — "No live Workroom is bound to
// this item. Claim or resume the exact Workroom, then retry completion" — could
// not see the room the caller had just created the documented way. Reproduced
// live as WC-19154AC3 while following that instruction; 33 rooms were sitting
// anchor-only against 338 correctly bound.
//
// This is the same defect BI-512214EA fixed for `adopt_worktree` and BI-D526F72C
// fixed for its argument name, at a third site. It reuses that resolver rather
// than growing a second one, including its fail-closed refusal on an id that does
// not resolve, and its readback check — because a report of the request is not a
// report of the result, which is exactly how the null binding stayed invisible
// behind `success: true`.

import type { ToolResult } from "@/lib/mcp-tools";

import type { BacklogBindingReader } from "./adopt-backlog-binding";
import { adoptionBindingMismatch, resolveAdoptionBacklogBinding } from "./adopt-backlog-binding";

type CreatedCapsule = { capsuleId: string; backlogItemId?: string | null; headBranch?: string | null };

/**
 * Deliberately NOT the shared `ActionResult` shape, for the same reason its
 * sibling `BacklogBindingResolution` is not: that contract's failure branch is
 * `{ ok: false, error: string }` — a message — while this one carries a whole
 * `ToolResult` so the MCP refusal reaches the caller with its error code and
 * remedy intact. It discriminates on `created` rather than borrowing `ok` for a
 * different meaning.
 */
export type CreateWorkroomBindingResult<T extends CreatedCapsule> =
  | { created: true; capsule: T }
  | { created: false; refusal: ToolResult };

/**
 * Resolve the caller's backlog binding, create the room with it, and verify the
 * stored row actually carries it.
 *
 * `backlogItemId` stays legitimately nullable — coworker-owned standing work has
 * no backlog item — so a room with no backlog anchor is created unbound rather
 * than refused.
 */
export async function createWorkroomBoundToBacklogItem<T extends CreatedCapsule>(args: {
  db: BacklogBindingReader;
  params: Record<string, unknown>;
  title: string;
  create: (backlogItemId: string | null) => Promise<T>;
}): Promise<CreateWorkroomBindingResult<T>> {
  const binding = await resolveAdoptionBacklogBinding(args.db, args.params);
  if (!binding.bound) return { created: false, refusal: binding.refusal };

  const capsule = await args.create(binding.backlogItemId);

  const mismatch = adoptionBindingMismatch({
    headBranch: capsule.headBranch ?? args.title,
    requestedBacklogItemId: binding.backlogItemId,
    capsule,
  });
  if (mismatch) return { created: false, refusal: mismatch };

  return { created: true, capsule };
}
