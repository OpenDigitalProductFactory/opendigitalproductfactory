import { describe, expect, it } from "vitest";

import { buildWeeklyDigest, WEEKLY_DIGEST_ACTIONS } from "./weekly-digest";
import type { OwnerAttentionEntry } from "./owner-projection";

const entry = { item: { id: "research-proposal:1" } } as OwnerAttentionEntry;

describe("buildWeeklyDigest", () => {
  it("holds batchable items until Friday without turning them into today's count", () => {
    const digest = buildWeeklyDigest([entry], Date.parse("2026-07-15T12:00:00Z")); // Wednesday

    expect(digest.status).toBe("holding");
    expect(digest.count).toBe(1);
    expect(digest.reviewOnIso).toBe("2026-07-17");
  });

  it("makes the batch ready on Friday", () => {
    const digest = buildWeeklyDigest([entry], Date.parse("2026-07-17T12:00:00Z"));

    expect(digest.status).toBe("ready");
    expect(digest.entries).toEqual([entry]);
  });

  it("defines the founder-approved batch actions", () => {
    expect(WEEKLY_DIGEST_ACTIONS.map((action) => action.label)).toEqual([
      "Looks good, no changes",
      "Snooze to next week",
    ]);
  });
});
