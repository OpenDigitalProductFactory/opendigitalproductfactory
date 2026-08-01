import { describe, expect, it } from "vitest";

import type { SelfUpgradePurposeStatus } from "@/lib/self-upgrade/purpose-scenario";
import { resolveSelfUpgradePurposeOracle } from "./self-upgrade";

function status(
  overrides: Partial<SelfUpgradePurposeStatus> = {},
): SelfUpgradePurposeStatus {
  return {
    statusAvailable: true,
    enabled: true,
    isFresh: false,
    targetSha: "target",
    latestRun: null,
    jobEngine: { status: "healthy" },
    windowSource: "operating-hours",
    ...overrides,
  };
}

describe("resolveSelfUpgradePurposeOracle", () => {
  it.each([
    [{ latestRun: { status: "running" } }, "queued-or-running"],
    [{ latestRun: { status: "failed" } }, "failed-recoverable"],
    [{ statusAvailable: false }, "blocked"],
    [{ isFresh: true }, "current"],
    [{ targetSha: null }, "current"],
    [{ enabled: false }, "blocked"],
    [{ jobEngine: { status: "degraded" } }, "blocked"],
    [{ windowSource: "needs-timezone" }, "blocked"],
    [{}, "update-available"],
  ] as const)("maps canonical raw status %j to %s", (overrides, expected) => {
    expect(
      resolveSelfUpgradePurposeOracle(
        status(overrides as Partial<SelfUpgradePurposeStatus>),
      ),
    ).toBe(expected);
  });
});
