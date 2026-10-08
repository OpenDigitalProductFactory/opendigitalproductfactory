import { describe, expect, it } from "vitest";

import { roomOfThreadContext, sumSpendByRoom } from "./room-ai-spend";

describe("roomOfThreadContext", () => {
  it.each([
    ["scheduled:workroom-WC-9B26C12E-issue-triage-watch", "WC-9B26C12E"],
    ["coworker:/workspace/cases/work-capsule%3AWC-0A92C30D", "WC-0A92C30D"],
    ["coworker:/workspace/cases/work-capsule:wc-0a92c30d", "WC-0A92C30D"],
    ["coworker:/workspace/cases/work-item%3AWI-1", null],
    ["triage", null],
    [null, null],
  ])("%s → %s", (key, room) => expect(roomOfThreadContext(key)).toBe(room));
});

describe("sumSpendByRoom", () => {
  it("adds every thread's spend to the room it names and leaves the rest unattributed", () => {
    const spend = sumSpendByRoom(
      [
        { id: "t1", contextKey: "scheduled:workroom-WC-1-payables-watch" },
        { id: "t2", contextKey: "coworker:/workspace/cases/work-capsule%3AWC-1" },
        { id: "t3", contextKey: "scheduled:workroom-WC-2-payables-watch" },
        { id: "t4", contextKey: "triage" },
      ],
      new Map([["t1", 0.2], ["t2", 0.05], ["t3", 1], ["t4", 9]]),
    );
    expect(Object.fromEntries(spend)).toEqual({ "WC-1": 0.25, "WC-2": 1 });
  });
});
