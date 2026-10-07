import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveEffectiveUpgradeWindow: vi.fn(),
  getActiveSelfUpgradeBlackout: vi.fn(),
  recordDeferredUpgradeRequest: vi.fn(),
}));

vi.mock("@/lib/self-upgrade/effective-window", () => ({
  resolveEffectiveUpgradeWindow: mocks.resolveEffectiveUpgradeWindow,
}));
vi.mock("@/lib/self-upgrade/blackout", () => ({
  getActiveSelfUpgradeBlackout: mocks.getActiveSelfUpgradeBlackout,
}));
vi.mock("@/lib/self-upgrade/deferred-request", () => ({
  recordDeferredUpgradeRequest: mocks.recordDeferredUpgradeRequest,
}));
vi.mock("@/lib/govern/automation-sign-in", () => ({
  AUTOMATION_PERSONA_EMAIL: "automation@dpf.local",
}));

import {
  decideUpgradeTiming,
  deferUpgradeToWindow,
  portalRequesterKind,
  withWindowBypass,
} from "./upgrade-timing";

const CONFIG = { maintenanceWindows: [], checkIntervalHours: 24 };
// 15:20 UTC; the store closes at 22:00 UTC, so the window opens then.
const NOW = new Date("2026-10-07T15:20:00.000Z");
const WINDOW_OPENS = new Date("2026-10-07T22:00:00.000Z");

function windowState(open: boolean, extra: Record<string, unknown> = {}) {
  return {
    source: "operating-hours",
    open,
    nextWindowStart: open ? null : WINDOW_OPENS,
    windows: undefined,
    schedule: {},
    timezone: "UTC",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveEffectiveUpgradeWindow.mockResolvedValue(windowState(false));
  mocks.getActiveSelfUpgradeBlackout.mockResolvedValue(null);
  mocks.recordDeferredUpgradeRequest.mockResolvedValue(undefined);
});

describe("portalRequesterKind", () => {
  it("classifies the platform automation persona as an agent", () => {
    expect(portalRequesterKind("automation@dpf.local")).toBe("agent");
    expect(portalRequesterKind("Automation@DPF.local")).toBe("agent");
  });

  it("classifies any other signed-in user as a human", () => {
    expect(portalRequesterKind("ops@test.com")).toBe("human");
    expect(portalRequesterKind(null)).toBe("human");
  });
});

describe("withWindowBypass", () => {
  it("records the bypass on the trigger once", () => {
    expect(withWindowBypass("manual:user-1")).toBe("manual:user-1+outside-window");
    expect(withWindowBypass("manual:user-1+outside-window")).toBe("manual:user-1+outside-window");
  });
});

describe("decideUpgradeTiming — agent", () => {
  it("defers outside the window and says when the scheduled cron picks it up", async () => {
    const decision = await decideUpgradeTiming({ requester: "agent", config: CONFIG, now: NOW });

    expect(decision).toEqual({
      kind: "defer",
      reason: "outside-window",
      nextWindowStart: WINDOW_OPENS,
      runAt: new Date("2026-10-07T22:00:00.000Z"),
      blackoutUntil: null,
    });
  });

  it("rounds runAt up to the next hourly scheduled tick", async () => {
    mocks.resolveEffectiveUpgradeWindow.mockResolvedValue(
      windowState(false, { nextWindowStart: new Date("2026-10-07T22:30:00.000Z") }),
    );

    const decision = await decideUpgradeTiming({ requester: "agent", config: CONFIG, now: NOW });

    expect(decision).toMatchObject({ kind: "defer", runAt: new Date("2026-10-07T23:00:00.000Z") });
  });

  it("runs now inside the window, recording no bypass", async () => {
    mocks.resolveEffectiveUpgradeWindow.mockResolvedValue(windowState(true));

    expect(await decideUpgradeTiming({ requester: "agent", config: CONFIG, now: NOW }))
      .toEqual({ kind: "run-now", windowBypassed: false });
  });

  it("defers through an operator blackout, to the first window after it ends", async () => {
    const blackoutEnd = new Date("2026-10-09T06:00:00.000Z");
    mocks.resolveEffectiveUpgradeWindow
      .mockResolvedValueOnce(windowState(true))
      .mockResolvedValueOnce(windowState(true));
    mocks.getActiveSelfUpgradeBlackout.mockResolvedValue({ name: "Quarter close", endAt: blackoutEnd });

    const decision = await decideUpgradeTiming({ requester: "agent", config: CONFIG, now: NOW });

    expect(decision).toMatchObject({
      kind: "defer",
      reason: "blackout-period",
      nextWindowStart: blackoutEnd,
      runAt: new Date("2026-10-09T06:00:00.000Z"),
      blackoutUntil: blackoutEnd,
    });
    expect(mocks.resolveEffectiveUpgradeWindow).toHaveBeenLastCalledWith({ config: CONFIG, now: blackoutEnd });
  });

  it("cannot defer to a window that cannot be computed (24/7 store without a timezone)", async () => {
    mocks.resolveEffectiveUpgradeWindow.mockResolvedValue(windowState(false, { source: "needs-timezone", nextWindowStart: null }));

    expect(await decideUpgradeTiming({ requester: "agent", config: CONFIG, now: NOW }))
      .toEqual({ kind: "needs-timezone" });
  });
});

describe("decideUpgradeTiming — human operator", () => {
  it("runs immediately outside the window and records that it bypassed it", async () => {
    expect(await decideUpgradeTiming({ requester: "human", config: CONFIG, now: NOW }))
      .toEqual({ kind: "run-now", windowBypassed: true });
    expect(mocks.getActiveSelfUpgradeBlackout).not.toHaveBeenCalled();
  });

  it("runs immediately inside the window with no bypass recorded", async () => {
    mocks.resolveEffectiveUpgradeWindow.mockResolvedValue(windowState(true));

    expect(await decideUpgradeTiming({ requester: "human", config: CONFIG, now: NOW }))
      .toEqual({ kind: "run-now", windowBypassed: false });
  });

  it("treats a run with no computable window as a bypass", async () => {
    mocks.resolveEffectiveUpgradeWindow.mockResolvedValue(windowState(true, { source: "needs-timezone" }));

    expect(await decideUpgradeTiming({ requester: "human", config: CONFIG, now: NOW }))
      .toEqual({ kind: "run-now", windowBypassed: true });
  });
});

describe("deferUpgradeToWindow", () => {
  it("records the request and answers with when it will run", async () => {
    const deferral = await deferUpgradeToWindow({
      requestedBy: "mcp:codex",
      now: NOW,
      decision: {
        kind: "defer",
        reason: "outside-window",
        nextWindowStart: WINDOW_OPENS,
        runAt: WINDOW_OPENS,
        blackoutUntil: null,
      },
    });

    expect(mocks.recordDeferredUpgradeRequest).toHaveBeenCalledWith({
      requestedBy: "mcp:codex",
      requestedAt: NOW.toISOString(),
      runAt: WINDOW_OPENS.toISOString(),
    });
    expect(deferral).toMatchObject({
      reason: "outside-window",
      runAt: WINDOW_OPENS.toISOString(),
      nextWindowStart: WINDOW_OPENS.toISOString(),
    });
    expect(deferral.message).toContain(WINDOW_OPENS.toISOString());
    expect(deferral.message).toContain("/ops/self-upgrade");
  });
});
