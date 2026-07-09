import { describe, expect, it } from "vitest";

import { isStale, newestSignal, isStaleSince } from "./staleness";

const NOW = new Date("2026-07-09T12:00:00Z");
const MIN = 60_000;

describe("isStale", () => {
  it("is true when ts is older than the threshold", () => {
    expect(isStale(NOW, new Date(NOW.getTime() - 5 * MIN), 3 * MIN)).toBe(true);
  });
  it("is false when ts is within the threshold", () => {
    expect(isStale(NOW, new Date(NOW.getTime() - 1 * MIN), 3 * MIN)).toBe(false);
  });
  it("treats null / undefined / NaN as stale (conservative default)", () => {
    expect(isStale(NOW, null, MIN)).toBe(true);
    expect(isStale(NOW, undefined, MIN)).toBe(true);
    expect(isStale(NOW, Number.NaN, MIN)).toBe(true);
  });
  it("accepts an epoch-millis number", () => {
    expect(isStale(NOW, NOW.getTime() - 5 * MIN, 3 * MIN)).toBe(true);
  });
});

describe("newestSignal", () => {
  it("returns the most recent of several timestamps", () => {
    const a = new Date(NOW.getTime() - 10 * MIN);
    const b = new Date(NOW.getTime() - 2 * MIN);
    expect(newestSignal(a, b, null)?.getTime()).toBe(b.getTime());
  });
  it("returns null when no timestamp is present", () => {
    expect(newestSignal(null, undefined)).toBeNull();
  });
});

describe("isStaleSince", () => {
  it("uses the freshest signal (a recent heartbeat keeps it live)", () => {
    const old = new Date(NOW.getTime() - 30 * MIN);
    const recent = new Date(NOW.getTime() - 1 * MIN);
    expect(isStaleSince(NOW, 5 * MIN, old, recent)).toBe(false);
  });
  it("is stale when the freshest signal is past the threshold", () => {
    const old = new Date(NOW.getTime() - 30 * MIN);
    expect(isStaleSince(NOW, 5 * MIN, old, null)).toBe(true);
  });
  it("is stale when no signal exists at all", () => {
    expect(isStaleSince(NOW, 5 * MIN)).toBe(true);
  });
});
