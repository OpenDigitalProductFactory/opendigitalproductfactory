import type { OwnerAttentionEntry } from "./owner-projection";

export const WEEKLY_DIGEST_ACTIONS = [
  { kind: "acknowledge", label: "Looks good, no changes" },
  { kind: "snooze", label: "Snooze to next week" },
] as const;

export type WeeklyDigest = {
  status: "holding" | "ready";
  reviewOnIso: string;
  count: number;
  entries: OwnerAttentionEntry[];
};

/** Build the deterministic Friday batch. Uses UTC because callers inject the
 * clock and runtime hosts may not share the owner's browser timezone. */
export function buildWeeklyDigest(
  entries: OwnerAttentionEntry[],
  nowMs: number,
): WeeklyDigest {
  const now = new Date(nowMs);
  const day = now.getUTCDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  const review = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilFriday,
  ));
  return {
    status: day === 5 ? "ready" : "holding",
    reviewOnIso: review.toISOString().slice(0, 10),
    count: entries.length,
    entries,
  };
}
