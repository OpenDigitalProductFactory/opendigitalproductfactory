import { describe, expect, it } from "vitest";

import {
  resolveSelfUpgradePurposeBlocker,
  resolveSelfUpgradePurposeScenario,
} from "./purpose-scenario";

function status(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    isFresh: false,
    targetSha: "target",
    latestRun: null,
    quiescence: { blockers: [] },
    jobEngine: { healthy: true },
    windowSource: "operating-hours",
    ...overrides,
  };
}

describe("resolveSelfUpgradePurposeScenario", () => {
  it.each([
    [{ latestRun: { status: "running" } }, "queued-or-running"],
    [{ latestRun: { status: "failed" } }, "failed-recoverable"],
    [{ enabled: false }, "blocked"],
    [{ jobEngine: { healthy: false } }, "blocked"],
    [{ windowSource: "needs-timezone" }, "blocked"],
    [{ isFresh: true }, "current"],
    [{ targetSha: null }, "current"],
    [{}, "update-available"],
  ])("maps canonical status %j to %s", (overrides, expected) => {
    expect(resolveSelfUpgradePurposeScenario(status(overrides))).toBe(expected);
  });

  it("keeps an active run ahead of a transient job-engine warning", () => {
    expect(
      resolveSelfUpgradePurposeScenario(
        status({
          latestRun: { status: "completing" },
          jobEngine: { healthy: false },
        }),
      ),
    ).toBe("queued-or-running");
  });

  it.each([
    [{ enabled: false }, "Automatic platform updates are disabled."],
    [{ jobEngine: { healthy: false } }, "The update worker is unavailable."],
    [
      { windowSource: "needs-timezone" },
      "Operating timezone is required before updates can be scheduled safely.",
    ],
  ])("describes the owning blocker for %j", (overrides, expected) => {
    expect(resolveSelfUpgradePurposeBlocker(status(overrides))).toBe(expected);
  });
});
