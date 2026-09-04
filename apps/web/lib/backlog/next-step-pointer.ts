import { prisma } from "@dpf/db";

// What a readiness surface promises the reader will happen next — BI-5BF97BAA.
//
// THE FAILURE THIS PREVENTS
//
// The backlog is a resettable substrate; source is not. Seventeen hardcoded
// `nextBacklogItemId` strings across the integrations and finance surfaces
// outlived the backlog reset of 2026-08-22 and went on rendering identifiers
// that resolved to nothing — a "what happens next" pointer aimed at an item no
// query could find. The reset is not the anomaly: 178 of the 233 backlog ids in
// the last 600 commit subjects are gone too. A commit subject is a record of its
// time and may name a dead id. A pointer offering the reader a next step may not.
//
// THE SHAPE
//
// A declared pointer is either a claim about a filed item, checked at render
// time, or a stated intent with no item behind it yet. "Nothing is filed" is a
// state to be said plainly, never faked with an id-shaped string. The same
// convention already lives in the capability-lane specs, which write an open
// slot as prose rather than inventing an identifier for it.

/** A declared next step: a filed backlog item, or an intent with none yet. */
export type NextStepPointer =
  | { readonly kind: "backlog-item"; readonly itemId: string }
  | { readonly kind: "open"; readonly intent: string };

/** Declare a next step that names a filed backlog item. */
export function backlogItem(itemId: string): NextStepPointer {
  return { kind: "backlog-item", itemId };
}

/** Declare a next step that states intent because no item is filed for it. */
export function openIntent(intent: string): NextStepPointer {
  return { kind: "open", intent };
}

/** A backlog item the database actually holds. */
export type FiledBacklogItem = {
  readonly itemId: string;
  readonly title: string;
  readonly status: string;
};

/**
 * A pointer after it has been checked against the database. `label` is the only
 * field a surface should render: it is honest in all three cases, so a caller
 * cannot accidentally print a dead identifier.
 */
export type ResolvedNextStep =
  | {
      readonly kind: "filed";
      readonly itemId: string;
      readonly title: string;
      readonly status: string;
      readonly label: string;
    }
  | { readonly kind: "unresolved"; readonly itemId: string; readonly label: string }
  | { readonly kind: "open"; readonly intent: string; readonly label: string };

/** Shown where a declared id names nothing the backlog holds. */
export const UNRESOLVED_NEXT_STEP_LABEL = "Not filed";

/** Every distinct backlog id these pointers claim, in declaration order. */
export function declaredItemIds(pointers: Iterable<NextStepPointer>): string[] {
  const seen = new Set<string>();
  for (const pointer of pointers) {
    if (pointer.kind === "backlog-item") seen.add(pointer.itemId);
  }
  return [...seen];
}

/**
 * Resolve one declared pointer against the items known to be filed. Pure, so the
 * honesty rule is testable without a database — the ambient-host-state guard
 * (BI-95A83B47) exists because tests that reach for a live Postgres pass in one
 * environment and fail in another.
 */
export function resolveNextStep(
  pointer: NextStepPointer,
  filed: ReadonlyMap<string, FiledBacklogItem>,
): ResolvedNextStep {
  if (pointer.kind === "open") {
    return { kind: "open", intent: pointer.intent, label: pointer.intent };
  }
  const item = filed.get(pointer.itemId);
  if (!item) {
    return {
      kind: "unresolved",
      itemId: pointer.itemId,
      label: UNRESOLVED_NEXT_STEP_LABEL,
    };
  }
  return {
    kind: "filed",
    itemId: item.itemId,
    title: item.title,
    status: item.status,
    label: item.itemId,
  };
}

/** Read the claimed ids the backlog actually holds. The only database seam here. */
export async function loadFiledBacklogItems(
  itemIds: readonly string[],
): Promise<Map<string, FiledBacklogItem>> {
  if (itemIds.length === 0) return new Map();
  const rows = await prisma.backlogItem.findMany({
    where: { itemId: { in: [...itemIds] } },
    select: { itemId: true, title: true, status: true },
  });
  return new Map(rows.map((row) => [row.itemId, row]));
}

/**
 * Resolve a list of declared pointers in one query. The result is index-aligned
 * with the input, so a surface can map its rows straight onto it.
 */
export async function resolveNextSteps(
  pointers: readonly NextStepPointer[],
): Promise<ResolvedNextStep[]> {
  const filed = await loadFiledBacklogItems(declaredItemIds(pointers));
  return pointers.map((pointer) => resolveNextStep(pointer, filed));
}
