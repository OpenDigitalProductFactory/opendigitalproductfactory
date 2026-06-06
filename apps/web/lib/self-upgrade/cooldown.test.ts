import { describe, expect, it } from "vitest";
import { isInCooldown, DEFAULT_COOLDOWN_MINUTES } from "./cooldown";

const NOW = new Date("2026-06-05T12:00:00Z");

describe("isInCooldown", () => {
  it("is NOT in cooldown when nothing was recorded", () => {
    expect(isInCooldown(null, NOW)).toBe(false);
  });

  it("is in cooldown when the deadline is in the future", () => {
    const until = new Date("2026-06-05T12:30:00Z"); // 30m out
    expect(isInCooldown(until, NOW)).toBe(true);
  });

  it("is NOT in cooldown once the deadline has passed", () => {
    const until = new Date("2026-06-05T11:30:00Z"); // 30m ago
    expect(isInCooldown(until, NOW)).toBe(false);
  });

  it("is NOT in cooldown exactly at the deadline (boundary opens the gate)", () => {
    expect(isInCooldown(new Date(NOW), NOW)).toBe(false);
  });

  it("exposes a sane default backoff window", () => {
    expect(DEFAULT_COOLDOWN_MINUTES).toBeGreaterThan(0);
  });
});
