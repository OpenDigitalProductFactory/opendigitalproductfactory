import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { translateAttentionToOwnerDecision, type OwnerDecisionCard } from "./owner-decision";
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
  options: { fallbackLevel?: ProactivityLevel; nowMs: number },
): OwnerAttentionProjection {
  const fallbackLevel = options.fallbackLevel ?? "balanced";
  const needsYouNow: OwnerAttentionEntry[] = [];
  const weeklyDigest: OwnerAttentionEntry[] = [];
  const custodian: OwnerAttentionEntry[] = [];

  for (const item of orderOutsideIn(items)) {
    const routing = classifyOwnerAttentionLane(item, fallbackLevel);
    const entry = {
      item,
      routing,
      card: translateAttentionToOwnerDecision(item, options.nowMs),
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
