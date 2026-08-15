import { describe, expect, it } from "vitest";

import {
  ACTIVE_BACKLOG_STATUSES,
  TERMINAL_BACKLOG_STATUSES,
  isTerminalBacklogItemStatus,
  visibleUnderActiveOnly,
} from "./backlog-visibility";

describe("shared backlog lifecycle lens (BI-9DB20C39)", () => {
  it("defines one exhaustive active-versus-terminal split for List and Grid", () => {
    expect(ACTIVE_BACKLOG_STATUSES).toEqual(["triaging", "open", "in-progress"]);
    expect(TERMINAL_BACKLOG_STATUSES).toEqual(["done", "deferred"]);
    expect([...ACTIVE_BACKLOG_STATUSES, ...TERMINAL_BACKLOG_STATUSES]).toEqual([
      "triaging",
      "open",
      "in-progress",
      "done",
      "deferred",
    ]);
  });

  it("drives the List active-only helper from the same terminal set", () => {
    const items = [
      { status: "triaging" },
      { status: "open" },
      { status: "in-progress" },
      { status: "done" },
      { status: "deferred" },
    ];

    expect(items.filter((item) => !isTerminalBacklogItemStatus(item.status))).toEqual(
      visibleUnderActiveOnly(items, true),
    );
    expect(visibleUnderActiveOnly(items, true).map((item) => item.status)).toEqual(
      ACTIVE_BACKLOG_STATUSES,
    );
  });
});
