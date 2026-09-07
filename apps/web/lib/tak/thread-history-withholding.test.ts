// BI-706530B2 — a boundary honoured by only some doors is worse than none: it
// reports normal routing while the withheld text still travels.

import { describe, expect, it } from "vitest";
import {
  checkpointAllowed,
  historyWindowClause,
  recallExclusionSet,
  splitWithheldHistory,
} from "./thread-history-withholding";

const T = (iso: string) => new Date(iso);
const MESSAGES = [
  { id: "m0", createdAt: T("2026-09-01T10:00:00Z") },
  { id: "m1", createdAt: T("2026-09-01T11:00:00Z") },
  { id: "m2", createdAt: T("2026-09-01T12:00:00Z") },
];
const BOUNDARY = T("2026-09-01T11:30:00Z");

describe("thread history withholding", () => {
  it("is a strict no-op with no boundary — every door behaves as before", () => {
    const split = splitWithheldHistory(MESSAGES, null);
    expect(split.withheldMessageIds.size).toBe(0);
    expect(historyWindowClause(null)).toBeUndefined();
    expect(checkpointAllowed(null)).toBe(true);
    expect([...recallExclusionSet(new Set(["m2"]), split)]).toEqual(["m2"]);
  });

  it("door 1: the raw window is bounded", () => {
    expect(historyWindowClause(BOUNDARY)).toEqual({ gte: BOUNDARY });
  });

  it("door 2: the rolling checkpoint is suppressed", () => {
    // The checkpoint summarises turns older than the window — the withheld span
    // restated. A summary of governed text is still governed text.
    expect(checkpointAllowed(BOUNDARY)).toBe(false);
  });

  it("door 3: withheld ids join the recall exclusion set", () => {
    const split = splitWithheldHistory(MESSAGES, BOUNDARY);
    expect([...split.withheldMessageIds].sort()).toEqual(["m0", "m1"]);
    const excluded = recallExclusionSet(new Set(["m2"]), split);
    expect(excluded.has("m0")).toBe(true);
    expect(excluded.has("m1")).toBe(true);
    expect(excluded.has("m2")).toBe(true);
  });

  it("a message exactly at the boundary is dispatched, not withheld", () => {
    const split = splitWithheldHistory(
      [{ id: "edge", createdAt: BOUNDARY }],
      BOUNDARY,
    );
    expect(split.withheldMessageIds.size).toBe(0);
  });

  it("withholds nothing when the boundary predates the whole thread", () => {
    const split = splitWithheldHistory(MESSAGES, T("2026-01-01T00:00:00Z"));
    expect(split.withheldMessageIds.size).toBe(0);
  });
});
