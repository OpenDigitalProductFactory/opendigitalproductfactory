import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import {
  translateAttentionToOwnerDecision,
  type OwnerDecisionAudience,
  type OwnerDecisionCard,
} from "./owner-decision";
import {
  classifyOwnerAttentionLane,
  type OwnerAttentionLaneDecision,
} from "./owner-routing";
import { orderOutsideIn } from "./outside-in";
import type { AttentionItem } from "./types";

export type OwnerAttentionEntry = {
  item: AttentionItem;
  card: OwnerDecisionCard;
  routing: OwnerAttentionLaneDecision;
};

export type OwnerAttentionProjection = {
  needsYouNow: OwnerAttentionEntry[];
  weeklyDigest: OwnerAttentionEntry[];
  custodian: OwnerAttentionEntry[];
  /** The only owner-facing daily count. */
  count: number;
};

export function buildOwnerAttentionProjection(
  items: AttentionItem[],
  options: {
    fallbackLevel?: ProactivityLevel;
    nowMs: number;
    /**
     * Which rails the reader asked to see (Simple/Full toggle). Decides whether a
     * builder-rail action can be an owner button; defaults to `operator` (Full),
     * matching resolveNavModeFromCookie's own default.
     */
    audience?: OwnerDecisionAudience;
  },
): OwnerAttentionProjection {
  const fallbackLevel = options.fallbackLevel ?? "balanced";
  const audience = options.audience ?? "operator";
  const needsYouNow: OwnerAttentionEntry[] = [];
  const weeklyDigest: OwnerAttentionEntry[] = [];
  const custodian: OwnerAttentionEntry[] = [];

  for (const item of orderOutsideIn(items)) {
    const routing = classifyOwnerAttentionLane(item, fallbackLevel);
    const entry = {
      item,
      routing,
      card: translateAttentionToOwnerDecision(item, options.nowMs, audience),
    };
    if (routing.lane === "needs-you-now") needsYouNow.push(entry);
    else if (routing.lane === "weekly-digest") weeklyDigest.push(entry);
    else custodian.push(entry);
  }

  return {
    needsYouNow,
    weeklyDigest,
    custodian,
    count: needsYouNow.length,
  };
}

/**
 * Pin one item into the visible lane (BI-0012E6CA).
 *
 * A deep link names a specific card; if routing put it in the weekly review or
 * with the custodian, the reader would land on a page that does not show it.
 * The requested entry moves to the front of `needsYouNow` and the count follows.
 * Unknown ids leave the projection unchanged.
 */
export function pinOwnerAttentionEntry(
  projection: OwnerAttentionProjection,
  itemId: string | undefined,
): OwnerAttentionProjection {
  if (!itemId) return projection;
  if (projection.needsYouNow.some((entry) => entry.item.id === itemId)) return projection;
  const pinned = projection.weeklyDigest.find((entry) => entry.item.id === itemId)
    ?? projection.custodian.find((entry) => entry.item.id === itemId);
  if (!pinned) return projection;
  const needsYouNow = [pinned, ...projection.needsYouNow];
  return {
    needsYouNow,
    weeklyDigest: projection.weeklyDigest.filter((entry) => entry.item.id !== itemId),
    custodian: projection.custodian.filter((entry) => entry.item.id !== itemId),
    count: needsYouNow.length,
  };
}
