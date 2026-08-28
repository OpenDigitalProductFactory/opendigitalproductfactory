import type { ToolResult } from "@/lib/mcp-tools";

import { backlogItemIdFromOutcomeAnchor } from "./outcome-anchor";

/**
 * Resolve the BacklogItem an `adopt_worktree` call means to bind.
 *
 * BI-D526F72C: `backlogItemId` is the obvious name for the argument — it is what
 * `claim_backlog_item_for_work` binds and what the returned capsule reports —
 * but the tool schema advertised only `outcomeAnchor`, so a supplied
 * `backlogItemId` was silently dropped. The capsule was then created unbound,
 * which made it unclaimable (`capsule_identity_mismatch`) AND unreleasable
 * (`branch_occupied`, even after abandoning) on a branch it permanently
 * occupied. Live reproduction: WC-8DB317F7.
 *
 * Accept the name callers actually use, and fail closed rather than persisting a
 * partially-populated capsule.
 */
export type BacklogBindingReader = {
  backlogItem: {
    findFirst(args: unknown): Promise<{ itemId: string } | null>;
  };
};

export type BacklogBindingResolution =
  | { ok: true; backlogItemId: string | null }
  | { ok: false; result: ToolResult };

export async function resolveAdoptionBacklogBinding(
  db: BacklogBindingReader,
  params: Record<string, unknown>,
): Promise<BacklogBindingResolution> {
  const raw = params["backlogItemId"];
  const requested = typeof raw === "string" && raw.trim()
    ? raw.trim()
    : backlogItemIdFromOutcomeAnchor(params);
  if (!requested) return { ok: true, backlogItemId: null };

  const item = await db.backlogItem.findFirst({
    where: { OR: [{ itemId: requested }, { id: requested }] },
    select: { itemId: true },
  });
  if (!item) {
    return {
      ok: false,
      result: {
        success: false,
        error: "unknown_backlog_item",
        message:
          `BacklogItem ${requested} does not exist, so this worktree cannot be bound to it. `
          + "Adopting without the binding would leave a capsule occupying the branch that can "
          + "be neither claimed nor released. Supply a real BI-* id, or omit it to adopt the "
          + "branch unbound.",
      },
    };
  }
  return { ok: true, backlogItemId: item.itemId };
}

/**
 * Read the binding back off the STORED capsule.
 *
 * The original defect was invisible precisely because the tool answered
 * `success: true` while returning a capsule whose `backlogItemId` was null. A
 * report of the request is not a report of the result.
 */
export function adoptionBindingMismatch(args: {
  headBranch: string;
  requestedBacklogItemId: string | null;
  capsule: { capsuleId: string; backlogItemId?: string | null };
}): ToolResult | null {
  if (!args.requestedBacklogItemId) return null;
  if (args.capsule.backlogItemId === args.requestedBacklogItemId) return null;
  return {
    success: false,
    error: "backlog_item_not_bound",
    message:
      `Adopted ${args.headBranch} as ${args.capsule.capsuleId}, but the capsule is bound to `
      + `${args.capsule.backlogItemId ?? "no backlog item"} rather than ${args.requestedBacklogItemId}. `
      + "The branch's durable workroom identity belongs to other work; resume it for its own "
      + "item or use a different branch.",
    data: { capsule: args.capsule },
  };
}
