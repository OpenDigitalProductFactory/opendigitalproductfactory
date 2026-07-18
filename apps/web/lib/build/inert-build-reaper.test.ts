import { describe, it, expect } from "vitest";
import {
  isInertBuildReapable,
  isStalledBuildReapable,
  INERT_BUILD_REAP_MS,
  STALLED_BUILD_REAP_MS,
} from "./inert-build-reaper";

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

describe("isStalledBuildReapable (BI-EB33BD37 — stalled-after-activity remediation)", () => {
  const staleMs = 6 * 60 * 60 * 1000; // 6h

  function stalledBase(
    overrides: Partial<Parameters<typeof isStalledBuildReapable>[0]> = {},
  ) {
    return {
      phase: "build",
      abandonedAt: null as Date | null,
      parentEpicId: null as string | null,
      activityCount: 500, // did substantial work
      liveTaskRunCount: 0, // watchdog already marked its runs stalled
      lastActivityAt: new Date(NOW.getTime() - 12 * 60 * 60 * 1000), // silent 12h
      now: NOW,
      staleMs,
      ...overrides,
    };
  }

  it("reaps a build that did work then went silent past the stale window", () => {
    expect(isStalledBuildReapable(stalledBase())).toBe(true);
    expect(isStalledBuildReapable(stalledBase({ phase: "review" }))).toBe(true);
  });

  it("does NOT reap a build with a live task run (genuinely working)", () => {
    expect(isStalledBuildReapable(stalledBase({ liveTaskRunCount: 1 }))).toBe(false);
  });

  it("does NOT reap a build whose last activity is within the stale window", () => {
    expect(
      isStalledBuildReapable(
        stalledBase({ lastActivityAt: new Date(NOW.getTime() - 60 * 1000) }),
      ),
    ).toBe(false);
  });

  it("does NOT reap a zero-activity build (that is the inert reaper's job)", () => {
    expect(isStalledBuildReapable(stalledBase({ activityCount: 0 }))).toBe(false);
  });

  it("stays conservative when last activity is unknown", () => {
    expect(isStalledBuildReapable(stalledBase({ lastActivityAt: null }))).toBe(false);
  });

  it("only stalls active phases — not ideate/plan/ship or terminal phases", () => {
    for (const phase of ["ideate", "plan", "ship", "complete", "failed", "abandoned"]) {
      expect(isStalledBuildReapable(stalledBase({ phase }))).toBe(false);
    }
  });

  it("does NOT reap an epic-decomposed child", () => {
    expect(isStalledBuildReapable(stalledBase({ parentEpicId: "EP-123" }))).toBe(false);
  });

  it("exports a conservative default well beyond a healthy activity gap", () => {
    expect(STALLED_BUILD_REAP_MS).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
  });
});
