import { describe, expect, it } from "vitest";

import { describeScanFreshness, SCAN_STALE_AFTER_DAYS } from "./scan-freshness";

const NOW = new Date("2026-08-27T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("describeScanFreshness (BI-DA37A602)", () => {
  it("a fresh completed scan reads ok", () => {
    const f = describeScanFreshness({ status: "completed", startedAt: daysAgo(2), now: NOW });
    expect(f.tone).toBe("ok");
    expect(f.isStale).toBe(false);
    expect(f.chipLabel).toBe("completed");
    expect(f.ageLabel).toBe("2 days ago");
  });

  it("a 36-day-old completed scan reads stale, not green — the dogfood case", () => {
    const f = describeScanFreshness({ status: "completed", startedAt: daysAgo(36), now: NOW });
    expect(f.tone).toBe("stale");
    expect(f.isStale).toBe(true);
    expect(f.chipLabel).toBe("stale · 36d");
    expect(f.ageLabel).toBe("36 days ago");
  });

  it("stale kicks in only past the threshold", () => {
    expect(describeScanFreshness({ status: "completed", startedAt: daysAgo(SCAN_STALE_AFTER_DAYS), now: NOW }).isStale).toBe(false);
    expect(describeScanFreshness({ status: "completed", startedAt: daysAgo(SCAN_STALE_AFTER_DAYS + 1), now: NOW }).isStale).toBe(true);
  });

  it("failed and pending states are not overridden by age", () => {
    expect(describeScanFreshness({ status: "failed", startedAt: daysAgo(90), now: NOW }).tone).toBe("failed");
    expect(describeScanFreshness({ status: "running", startedAt: daysAgo(90), now: NOW }).tone).toBe("pending");
  });

  it("today reads today", () => {
    expect(describeScanFreshness({ status: "completed", startedAt: NOW, now: NOW }).ageLabel).toBe("today");
  });
});
