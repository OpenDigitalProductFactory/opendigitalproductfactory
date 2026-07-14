import { describe, expect, it } from "vitest";

import { isTurnStalled } from "./turn-watchdog";

const LIMIT = 90_000;

describe("isTurnStalled (BI-2750EB6F)", () => {
  it("is NOT stalled while server life was seen within the limit", () => {
    expect(isTurnStalled(1_000, 1_000 + LIMIT - 1, LIMIT)).toBe(false);
  });

  it("IS stalled once no server life has been seen for the full limit", () => {
    expect(isTurnStalled(1_000, 1_000 + LIMIT, LIMIT)).toBe(true);
    expect(isTurnStalled(1_000, 1_000 + LIMIT + 5_000, LIMIT)).toBe(true);
  });

  it("a fresh activity timestamp (e.g. a heartbeat) keeps it un-stalled", () => {
    // Heartbeat arrives at now-1000 → far inside the window.
    const now = 500_000;
    expect(isTurnStalled(now - 1_000, now, LIMIT)).toBe(false);
  });
});
