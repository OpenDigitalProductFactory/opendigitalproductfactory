import { describe, expect, it } from "vitest";

import {
  ACTIVE_BACKLOG_STATUSES,
  PARKED_BACKLOG_STATUSES,
  TERMINAL_BACKLOG_STATUSES,
  isTerminalBacklogItemStatus,
  visibleUnderActiveOnly,
} from "./backlog-visibility";

describe("shared backlog lifecycle lens (BI-9DB20C39)", () => {
  it("defines one exhaustive active, parked, and terminal split for List and Grid", () => {
    expect(ACTIVE_BACKLOG_STATUSES).toEqual(["triaging", "open", "in-progress"]);
    expect(PARKED_BACKLOG_STATUSES).toEqual(["deferred"]);
    expect(TERMINAL_BACKLOG_STATUSES).toEqual(["done", "retired"]);
    expect([...ACTIVE_BACKLOG_STATUSES, ...PARKED_BACKLOG_STATUSES, ...TERMINAL_BACKLOG_STATUSES]).toEqual([
      "triaging",
      "open",
      "in-progress",
      "deferred",
      "done",
      "retired",
    ]);
  });

  it("drives the List active-only helper from the same terminal set", () => {
    const items = [
      { status: "triaging" },
      { status: "open" },
      { status: "in-progress" },
      { status: "done" },
      { status: "deferred" },
      { status: "retired" },
    ];

    expect(visibleUnderActiveOnly(items, true).map((item) => item.status)).toEqual(
      ACTIVE_BACKLOG_STATUSES,
    );
  });
});
