import { describe, it, expect } from "vitest";
import { isInertBuildReapable, INERT_BUILD_REAP_MS } from "./inert-build-reaper";

const NOW = new Date("2026-06-19T16:00:00.000Z");
const thresholdMs = 3 * 60 * 60 * 1000; // 3h

function base(overrides: Partial<Parameters<typeof isInertBuildReapable>[0]> = {}) {
  return {
    phase: "ideate",
    abandonedAt: null as Date | null,
    parentEpicId: null as string | null,
    createdAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000), // 24h old
    activityCount: 0,
    liveTaskRunCount: 0,
    now: NOW,
    thresholdMs,
    ...overrides,
  };
}

describe("isInertBuildReapable", () => {
  it("reaps an old build with zero activity stuck in ideate", () => {
    expect(isInertBuildReapable(base())).toBe(true);
  });

  it("reaps an old inert build stuck in plan", () => {
    expect(isInertBuildReapable(base({ phase: "plan" }))).toBe(true);
  });

  it("does NOT reap a build younger than the threshold", () => {
    expect(isInertBuildReapable(base({ createdAt: new Date(NOW.getTime() - 60 * 60 * 1000) }))).toBe(false); // 1h old
  });

  it("does NOT reap a build that has any activity (it did something)", () => {
    expect(isInertBuildReapable(base({ activityCount: 1 }))).toBe(false);
  });

  it("does NOT reap a build with a live/working TaskRun", () => {
    expect(isInertBuildReapable(base({ liveTaskRunCount: 1 }))).toBe(false);
  });

  it("does NOT reap an already-abandoned build", () => {
    expect(isInertBuildReapable(base({ abandonedAt: NOW }))).toBe(false);
  });

  it("does NOT reap a terminal build", () => {
    expect(isInertBuildReapable(base({ phase: "complete" }))).toBe(false);
    expect(isInertBuildReapable(base({ phase: "failed" }))).toBe(false);
    expect(isInertBuildReapable(base({ phase: "abandoned" }))).toBe(false);
  });

  it("does NOT reap an epic-decomposed child build", () => {
    expect(isInertBuildReapable(base({ parentEpicId: "EP-123" }))).toBe(false);
  });

  it("does NOT reap a build exactly at the threshold (strictly greater required)", () => {
    expect(isInertBuildReapable(base({ createdAt: new Date(NOW.getTime() - thresholdMs) }))).toBe(false);
  });

  it("exports a sane default threshold (a few hours)", () => {
    expect(INERT_BUILD_REAP_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(INERT_BUILD_REAP_MS).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
