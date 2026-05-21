import { describe, expect, it } from "vitest";
import { groupConsecutiveSimilar } from "./StallEventHistoryStrip";
import type { StallEventHistoryEntry } from "@/lib/actions/stall-event-history";

function entry(overrides: Partial<StallEventHistoryEntry> = {}): StallEventHistoryEntry {
  return {
    id: `se-${Math.random().toString(36).slice(2, 8)}`,
    taskRunId: "cuid-x",
    taskRunBusinessId: null,
    phase: "build",
    reason: "heartbeat_timeout",
    detectedAt: new Date().toISOString(),
    outcome: null,
    outcomeAt: null,
    outcomeBy: null,
    notes: null,
    thresholdHeartbeatS: 300,
    thresholdTotalS: 1800,
    ...overrides,
  };
}

describe("groupConsecutiveSimilar", () => {
  // Caught during F3 UX dogfooding (2026-05-21): a Build Studio build that
  // re-spawns deliberation TaskRuns in a recovery loop generated N identical
  // "Heartbeat timeout — phase build" rows in the strip. Grouping folds runs
  // of consecutive identical entries so the noise stays compact.

  it("returns one group per entry when nothing matches", () => {
    const events = [
      entry({ id: "a", reason: "heartbeat_timeout", phase: "build" }),
      entry({ id: "b", reason: "total_timeout", phase: "build" }),
      entry({ id: "c", reason: "heartbeat_timeout", phase: "review" }),
    ];
    const groups = groupConsecutiveSimilar(events);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.entries.length === 1)).toBe(true);
  });

  it("folds consecutive entries with same reason + phase + null outcome", () => {
    const events = [
      entry({ id: "a", reason: "heartbeat_timeout", phase: "build" }),
      entry({ id: "b", reason: "heartbeat_timeout", phase: "build" }),
      entry({ id: "c", reason: "heartbeat_timeout", phase: "build" }),
    ];
    const groups = groupConsecutiveSimilar(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries).toHaveLength(3);
  });

  it("does NOT fold across a phase boundary", () => {
    const events = [
      entry({ id: "a", phase: "build" }),
      entry({ id: "b", phase: "build" }),
      entry({ id: "c", phase: "review" }),
      entry({ id: "d", phase: "build" }),
    ];
    const groups = groupConsecutiveSimilar(events);
    expect(groups).toHaveLength(3);
    expect(groups[0]!.entries).toHaveLength(2);
    expect(groups[1]!.entries).toHaveLength(1);
    expect(groups[2]!.entries).toHaveLength(1);
  });

  it("does NOT fold across a reason boundary", () => {
    const events = [
      entry({ id: "a", reason: "heartbeat_timeout" }),
      entry({ id: "b", reason: "total_timeout" }),
      entry({ id: "c", reason: "heartbeat_timeout" }),
    ];
    const groups = groupConsecutiveSimilar(events);
    expect(groups).toHaveLength(3);
  });

  it("does NOT fold resolved entries (each operator action gets its own row)", () => {
    // Even if reason + phase match, a resolved entry breaks the group so the
    // operator's distinct actions stay individually readable.
    const events = [
      entry({ id: "a", outcome: "retry" }),
      entry({ id: "b", outcome: "abandoned" }),
      entry({ id: "c", outcome: null }),
      entry({ id: "d", outcome: null }),
    ];
    const groups = groupConsecutiveSimilar(events);
    expect(groups).toHaveLength(3); // a, b, then [c, d]
    expect(groups[0]!.entries).toHaveLength(1);
    expect(groups[1]!.entries).toHaveLength(1);
    expect(groups[2]!.entries).toHaveLength(2);
  });

  it("handles an empty list", () => {
    expect(groupConsecutiveSimilar([])).toEqual([]);
  });

  it("preserves input order within each group", () => {
    const events = [
      entry({ id: "newest" }),
      entry({ id: "middle" }),
      entry({ id: "oldest" }),
    ];
    const groups = groupConsecutiveSimilar(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["newest", "middle", "oldest"]);
  });
});
