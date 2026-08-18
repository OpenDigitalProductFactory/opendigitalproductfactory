import { describe, expect, it } from "vitest";

import {
  backlogItemLifecycleLabel,
  isTerminalBacklogItemStatus,
  summarizeBacklogStatuses,
  visibleUnderActiveOnly,
} from "@/lib/backlog-visibility";

describe("isTerminalBacklogItemStatus", () => {
  it("treats done and retired as terminal while deferred remains parked", () => {
    expect(isTerminalBacklogItemStatus("done")).toBe(true);
    expect(isTerminalBacklogItemStatus("retired")).toBe(true);
    expect(isTerminalBacklogItemStatus("deferred")).toBe(false);
    expect(isTerminalBacklogItemStatus("open")).toBe(false);
    expect(isTerminalBacklogItemStatus("in-progress")).toBe(false);
    expect(isTerminalBacklogItemStatus("triaging")).toBe(false);
  });
});

describe("summarizeBacklogStatuses (BI-6F308164)", () => {
  const items = [
    { status: "open" },
    { status: "in-progress" },
    { status: "triaging" },
    { status: "deferred" },
    { status: "deferred" },
    { status: "done" },
    { status: "retired" },
  ];

  it("keeps every lifecycle state distinct instead of folding deferred into done", () => {
    expect(summarizeBacklogStatuses(items)).toEqual({
      triaging: 1,
      open: 1,
      inProgress: 1,
      done: 1,
      deferred: 2,
      retired: 1,
      active: 3,
      parked: 2,
      terminal: 2,
      total: 7,
    });
  });
});

describe("visibleUnderActiveOnly (BI-7CB3C1CD)", () => {
  const items = [
    { status: "open" },
    { status: "in-progress" },
    { status: "triaging" },
    { status: "deferred" },
    { status: "deferred" },
    { status: "done" },
    { status: "retired" },
  ];

  it("drops terminal and parked items when active-only is on", () => {
    const visible = visibleUnderActiveOnly(items, true);
    expect(visible).toHaveLength(3);
    expect(visible.map((i) => i.status)).toEqual(["open", "in-progress", "triaging"]);
  });

  it("returns every item unchanged when active-only is off", () => {
    expect(visibleUnderActiveOnly(items, false)).toHaveLength(7);
  });

  it("returns a stable empty array when all items are terminal", () => {
    expect(visibleUnderActiveOnly([{ status: "done" }, { status: "deferred" }, { status: "retired" }], true)).toEqual([]);
  });
});

describe("backlogItemLifecycleLabel (BI-6F308164)", () => {
  it("names retired duplicates instead of presenting them as generic deferred work", () => {
    expect(
      backlogItemLifecycleLabel({
        status: "retired",
        triageOutcome: "duplicate",
        duplicateOfId: "canonical-id",
      }),
    ).toBe("retired duplicate");
  });

  it("keeps ordinary deferred and completed work semantically distinct", () => {
    expect(backlogItemLifecycleLabel({ status: "deferred", triageOutcome: "defer" })).toBe("deferred");
    expect(backlogItemLifecycleLabel({ status: "retired", triageOutcome: "discard" })).toBe("retired discarded");
    expect(backlogItemLifecycleLabel({ status: "done", triageOutcome: "build" })).toBe("done");
  });
});
