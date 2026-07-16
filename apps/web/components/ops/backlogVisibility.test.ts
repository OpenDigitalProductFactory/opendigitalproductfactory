import { describe, expect, it } from "vitest";

import { isTerminalBacklogItemStatus, visibleUnderHideDone } from "./backlogVisibility";

describe("isTerminalBacklogItemStatus", () => {
  it("treats done and deferred as terminal, everything else as active", () => {
    expect(isTerminalBacklogItemStatus("done")).toBe(true);
    expect(isTerminalBacklogItemStatus("deferred")).toBe(true);
    expect(isTerminalBacklogItemStatus("open")).toBe(false);
    expect(isTerminalBacklogItemStatus("in-progress")).toBe(false);
    expect(isTerminalBacklogItemStatus("triaging")).toBe(false);
  });
});

describe("visibleUnderHideDone (BI-7CB3C1CD)", () => {
  const items = [
    { status: "open" },
    { status: "in-progress" },
    { status: "triaging" },
    { status: "deferred" },
    { status: "deferred" },
    { status: "done" },
  ];

  it("drops terminal (done + deferred) items when hideDone is on", () => {
    // The regression: the count badge must match what the list shows. With the
    // default hideDone=true, three deferred/done rows are hidden, so the badge
    // should count 3 actionable items — not the raw 6.
    const visible = visibleUnderHideDone(items, true);
    expect(visible).toHaveLength(3);
    expect(visible.map((i) => i.status)).toEqual(["open", "in-progress", "triaging"]);
  });

  it("returns every item unchanged when hideDone is off", () => {
    expect(visibleUnderHideDone(items, false)).toHaveLength(6);
  });

  it("returns a stable empty array when all items are terminal", () => {
    expect(visibleUnderHideDone([{ status: "done" }, { status: "deferred" }], true)).toEqual([]);
  });
});
