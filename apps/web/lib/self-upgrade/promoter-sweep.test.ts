import { describe, it, expect } from "vitest";
import { isPromoterContainerStale } from "./promoter-sweep";

describe("isPromoterContainerStale (orphaned-promoter sweep gate)", () => {
  const now = new Date("2026-07-11T12:20:00Z");
  const maxAge = 30 * 60 * 1000;

  it("treats a promoter older than maxAge as stale (docker CreatedAt format)", () => {
    // Started 11:41:26 UTC, now 12:20 → ~39 min old > 30 min.
    expect(isPromoterContainerStale("2026-07-11 11:41:26 +0000 UTC", now, maxAge)).toBe(true);
  });

  it("does NOT remove a promoter still within the budget (legit in-flight swap)", () => {
    // Started 12:05 → 15 min old < 30 min: a live upgrade must be left alone.
    expect(isPromoterContainerStale("2026-07-11 12:05:00 +0000 UTC", now, maxAge)).toBe(false);
  });

  it("refuses to declare an unparseable stamp stale (never kill what we can't age)", () => {
    expect(isPromoterContainerStale("", now, maxAge)).toBe(false);
    expect(isPromoterContainerStale("not-a-date", now, maxAge)).toBe(false);
  });
});
