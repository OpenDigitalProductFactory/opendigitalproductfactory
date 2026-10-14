import { describe, expect, it } from "vitest";

import type { AiUse } from "@/lib/portfolio/ai-resource";

import { roomOfThreadContext, sumAiUseByRoom } from "./room-ai-spend";

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

const use = (runs: number, tokens: number, recordedUsd: number | null, subscriptionTokens = 0): AiUse => ({ runs, tokens, recordedUsd, subscriptionTokens, durationMs: 0 });

describe("sumAiUseByRoom", () => {
  it("adds every thread's use to the room it names and leaves the rest unattributed", () => {
    const byRoom = sumAiUseByRoom(
      [
        { id: "t1", contextKey: "scheduled:workroom-WC-1-payables-watch" },
        { id: "t2", contextKey: "coworker:/workspace/cases/work-capsule%3AWC-1" },
        { id: "t3", contextKey: "scheduled:workroom-WC-2-payables-watch" },
        { id: "t4", contextKey: "triage" },
      ],
      new Map([["t1", use(2, 100, 0.2)], ["t2", use(1, 50, 0.05)], ["t3", use(3, 900, null, 900)], ["t4", use(9, 9, 9)]]),
    );
    expect(byRoom.get("WC-1")).toMatchObject({ runs: 3, tokens: 150 });
    expect(byRoom.get("WC-1")!.recordedUsd).toBeCloseTo(0.25);
    // A subscription room keeps "no cost recorded" rather than becoming $0.
    expect(byRoom.get("WC-2")).toEqual(use(3, 900, null, 900));
    expect(byRoom.has("triage")).toBe(false);
    expect(byRoom.size).toBe(2);
  });
});
