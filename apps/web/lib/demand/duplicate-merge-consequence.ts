// Per-call consequence of merge_backlog_items (BI-EAFD2D09).
//
// The tool stays declared `irreversible`: an arbitrary merge folds one item's
// reach into another and retires it, and only a person can judge that two
// differently-sourced items are the same work. One case needs no judgement:
// both items carry the same intake origin marker, so the front door would have
// folded them into one item had they arrived after the dedupe rule existed
// (ingestBacklogItem bumps the canonical's occurrenceCount for a matching
// marker, with no person involved). Merging such a pair late is that same fold.
//
// The narrowing holds only while nothing else is at stake: both items are this
// installation's own (a work-sync or federated-demand mirror belongs to its
// peer), the duplicate is still open, and no claim or live Workroom carries
// work on it. Anything else keeps the declared consequence and reaches a person.

import type { ToolCallConsequence, ToolCallConsequenceInput } from "@/lib/tool-consequence";

const ORIGIN_MARKER = /\[origin:([^:\]\r\n]+):([^\]\r\n]+)\]/g;

/** Origin kinds whose record another installation owns. */
const PEER_OWNED_ORIGIN_KINDS: ReadonlySet<string> = new Set(["federatedWork", "federatedDemand"]);

/** Statuses after which an item no longer carries demand to fold. */
const TERMINAL_ITEM_STATUSES: ReadonlySet<string> = new Set(["done", "retired", "deferred"]);

/** Mirrors TERMINAL_CAPSULE_STATUSES (apps/web/lib/build/unified-wip-query.ts). */
const TERMINAL_WORKROOM_STATUSES = ["complete", "abandoned", "archived"] as const;

export type DuplicateMergeItem = {
  id: string;
  itemId: string;
  status: string;
  body: string | null;
  claimStatus: string | null;
};

export type DuplicateMergeFacts = {
  canonical: DuplicateMergeItem | null;
  duplicate: DuplicateMergeItem | null;
  /** Workrooms that are not terminal and point at the duplicate. */
  duplicateLiveWorkrooms: number;
};

/** Every `[origin:<kind>:<id>]` marker in a body; `key` is `kind:id`. */
export function originMarkers(body: string | null): Array<{ kind: string; key: string }> {
  if (!body) return [];
  return [...body.matchAll(ORIGIN_MARKER)].map((m) => ({ kind: m[1]!, key: `${m[1]}:${m[2]}` }));
}

const KEEP = "irreversible" as const;

/** Pure decision over loaded facts. */
export function classifyDuplicateMerge(facts: DuplicateMergeFacts): ToolCallConsequence {
  const { canonical, duplicate } = facts;
  if (!canonical || !duplicate || canonical.id === duplicate.id) {
    return { consequence: KEEP, reason: "merge-items-unresolved" };
  }
  const canonicalMarkers = originMarkers(canonical.body);
  const duplicateMarkers = originMarkers(duplicate.body);
  if ([...canonicalMarkers, ...duplicateMarkers].some((m) => PEER_OWNED_ORIGIN_KINDS.has(m.kind))) {
    return { consequence: KEEP, reason: "merge-touches-peer-owned-item" };
  }
  if (TERMINAL_ITEM_STATUSES.has(duplicate.status)) {
    return { consequence: KEEP, reason: "merge-duplicate-not-open" };
  }
  if (duplicate.claimStatus === "active" || facts.duplicateLiveWorkrooms > 0) {
    return { consequence: KEEP, reason: "merge-duplicate-has-open-work" };
  }
  const canonicalKeys = new Set(canonicalMarkers.map((m) => m.key));
  if (!duplicateMarkers.some((m) => canonicalKeys.has(m.key))) {
    return { consequence: KEEP, reason: "merge-not-proven-same-origin" };
  }
  return { consequence: null, reason: "same-origin-duplicate-fold" };
}

const ITEM_SELECT = { id: true, itemId: true, status: true, body: true, claimStatus: true } as const;

/** The `consequenceForCall` refiner for merge_backlog_items. */
export async function mergeBacklogItemsConsequence({ params }: ToolCallConsequenceInput): Promise<ToolCallConsequence> {
  // This is safe by the handler's execution contract, not a mutable state read:
  // reconcileOnly can never enter the demand-fold transaction (BI-8EC69BE0).
  if (params["reconcileOnly"] === true) {
    return { consequence: null, reason: "completed-merge-reconciliation-only" };
  }
  const canonicalItemId = typeof params["canonicalItemId"] === "string" ? params["canonicalItemId"] : "";
  const duplicateItemId = typeof params["duplicateItemId"] === "string" ? params["duplicateItemId"] : "";
  if (!canonicalItemId || !duplicateItemId) return { consequence: KEEP, reason: "merge-items-unresolved" };
  const { prisma } = await import("@dpf/db");
  const [canonical, duplicate] = await Promise.all([
    prisma.backlogItem.findUnique({ where: { itemId: canonicalItemId }, select: ITEM_SELECT }),
    prisma.backlogItem.findUnique({ where: { itemId: duplicateItemId }, select: ITEM_SELECT }),
  ]);
  // Workroom.backlogItemId holds either the semantic itemId or the row id.
  const duplicateLiveWorkrooms = duplicate
    ? await prisma.workroom.count({
        where: {
          backlogItemId: { in: [duplicate.itemId, duplicate.id] },
          status: { notIn: [...TERMINAL_WORKROOM_STATUSES] },
        },
      })
    : 0;
  return classifyDuplicateMerge({ canonical, duplicate, duplicateLiveWorkrooms });
}
