import { describe, expect, it } from "vitest";
import { isCheckIntervalElapsed } from "./last-check";

const NOW = new Date("2026-05-25T12:00:00Z");

describe("isCheckIntervalElapsed", () => {
  it("is due when never checked before", () => {
    expect(isCheckIntervalElapsed(null, 24, NOW)).toBe(true);
  });

  it("is NOT due when less than the interval has elapsed", () => {
    const last = new Date("2026-05-25T06:00:00Z"); // 6h ago, interval 24h
    expect(isCheckIntervalElapsed(last, 24, NOW)).toBe(false);
  });

  it("is due when the interval has elapsed", () => {
    const last = new Date("2026-05-24T06:00:00Z"); // 30h ago, interval 24h
    expect(isCheckIntervalElapsed(last, 24, NOW)).toBe(true);
  });

  it("is due at exactly the interval boundary", () => {
    const last = new Date("2026-05-24T12:00:00Z"); // exactly 24h ago
    expect(isCheckIntervalElapsed(last, 24, NOW)).toBe(true);
  });

  it("respects a 1h interval (matches the cron cadence)", () => {
    expect(isCheckIntervalElapsed(new Date("2026-05-25T11:30:00Z"), 1, NOW)).toBe(false); // 30m
    expect(isCheckIntervalElapsed(new Date("2026-05-25T10:59:00Z"), 1, NOW)).toBe(true); // 61m
  });

  it("treats a non-positive interval as no throttle (always due)", () => {
    expect(isCheckIntervalElapsed(new Date("2026-05-25T11:59:00Z"), 0, NOW)).toBe(true);
  });
});
