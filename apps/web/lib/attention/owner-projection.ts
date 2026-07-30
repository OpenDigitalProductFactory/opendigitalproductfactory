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
