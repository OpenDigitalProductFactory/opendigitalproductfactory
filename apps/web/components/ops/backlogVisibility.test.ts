import { describe, expect, it } from "vitest";

import {
  backlogItemLifecycleLabel,
  isTerminalBacklogItemStatus,
  summarizeBacklogStatuses,
  visibleUnderActiveOnly,
} from "./backlogVisibility";

describe("isTerminalBacklogItemStatus", () => {
  it("treats done and deferred as terminal, everything else as active", () => {
    expect(isTerminalBacklogItemStatus("done")).toBe(true);
    expect(isTerminalBacklogItemStatus("deferred")).toBe(true);
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
  ];

  it("keeps every lifecycle state distinct instead of folding deferred into done", () => {
    expect(summarizeBacklogStatuses(items)).toEqual({
      triaging: 1,
      open: 1,
      inProgress: 1,
      done: 1,
      deferred: 2,
      active: 3,
      terminal: 3,
      total: 6,
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
  ];

  it("drops terminal (done + deferred) items when active-only is on", () => {
    const visible = visibleUnderActiveOnly(items, true);
    expect(visible).toHaveLength(3);
    expect(visible.map((i) => i.status)).toEqual(["open", "in-progress", "triaging"]);
  });

  it("returns every item unchanged when active-only is off", () => {
    expect(visibleUnderActiveOnly(items, false)).toHaveLength(6);
  });

  it("returns a stable empty array when all items are terminal", () => {
    expect(visibleUnderActiveOnly([{ status: "done" }, { status: "deferred" }], true)).toEqual([]);
  });
});

describe("backlogItemLifecycleLabel (BI-6F308164)", () => {
  it("names retired duplicates instead of presenting them as generic deferred work", () => {
    expect(
      backlogItemLifecycleLabel({
        status: "deferred",
        triageOutcome: "duplicate",
        duplicateOfId: "canonical-id",
      }),
    ).toBe("retired duplicate");
  });

  it("keeps ordinary deferred and completed work semantically distinct", () => {
    expect(backlogItemLifecycleLabel({ status: "deferred", triageOutcome: "defer" })).toBe("deferred");
    expect(backlogItemLifecycleLabel({ status: "deferred", triageOutcome: "discard" })).toBe("discarded");
    expect(backlogItemLifecycleLabel({ status: "done", triageOutcome: "build" })).toBe("done");
  });
});
