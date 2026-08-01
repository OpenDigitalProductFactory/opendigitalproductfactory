import { describe, expect, it } from "vitest";

import {
  resolveSelfUpgradePurposeBlocker,
  resolveSelfUpgradePurposeRecovery,
  resolveSelfUpgradePurposeScenario,
  resolveSelfUpgradePurposeSignals,
  type SelfUpgradePurposeStatus,
} from "./purpose-scenario";

function status(
  overrides: Partial<SelfUpgradePurposeStatus> = {},
): SelfUpgradePurposeStatus {
  return {
    enabled: true,
    isFresh: false,
    targetSha: "target",
    latestRun: null,
    quiescence: { blockers: [] },
    jobEngine: { status: "healthy" },
    windowSource: "operating-hours",
    ...overrides,
  };
}

describe("resolveSelfUpgradePurposeScenario", () => {
  it.each([
    [{ latestRun: { status: "running" } }, "queued-or-running"],
    [{ latestRun: { status: "failed" } }, "failed-recoverable"],
    [{ enabled: false, isFresh: false, targetSha: "target" }, "blocked"],
    [
      {
        jobEngine: { status: "degraded" as const },
        isFresh: false,
        targetSha: "target",
      },
      "blocked",
    ],
    [
      {
        windowSource: "needs-timezone",
        isFresh: false,
        targetSha: "target",
      },
      "blocked",
    ],
    [{ isFresh: true }, "current"],
    [{ targetSha: null }, "current"],
    [
      {
        enabled: false,
        isFresh: true,
        targetSha: null,
        jobEngine: { status: "degraded" as const },
      },
      "current",
    ],
    [{ statusAvailable: false, isFresh: true, targetSha: null }, "blocked"],
    [{}, "update-available"],
  ])("maps canonical status %j to %s", (overrides, expected) => {
    expect(resolveSelfUpgradePurposeScenario(status(overrides))).toBe(expected);
  });

  it("keeps an active run ahead of a transient job-engine warning", () => {
    expect(
      resolveSelfUpgradePurposeScenario(
        status({
          latestRun: { status: "completing" },
          jobEngine: { status: "degraded" as const },
        }),
      ),
    ).toBe("queued-or-running");
  });

  it.each([
    [{ statusAvailable: false }, "Update status is temporarily unavailable."],
    [{ enabled: false }, "Automatic platform updates are disabled."],
    [
      { jobEngine: { status: "degraded" as const } },
      "The update worker is unavailable.",
    ],
    [
      { windowSource: "needs-timezone" },
      "Operating timezone is required before updates can be scheduled safely.",
    ],
  ])("describes the owning blocker for %j", (overrides, expected) => {
    expect(resolveSelfUpgradePurposeBlocker(status(overrides))).toBe(expected);
  });

  it.each([
    [{ statusAvailable: false }, "/ops/self-upgrade"],
    [
      { windowSource: "needs-timezone" },
      "/storefront/settings/operations",
    ],
    [{ jobEngine: { status: "degraded" as const } }, "/ops/health"],
    [
      { enabled: false },
      "/docs/operations/self-upgrade#enable-self-upgrade",
    ],
  ])("routes blocker %j to its owning recovery surface", (overrides, href) => {
    expect(resolveSelfUpgradePurposeRecovery(status(overrides)).href).toBe(href);
  });

  it("gives a failed status read an explicit retry label", () => {
    expect(
      resolveSelfUpgradePurposeRecovery(status({ statusAvailable: false })),
    ).toEqual({
      href: "/ops/self-upgrade",
      label: "Retry status check",
    });
  });

  it.each([
    ["update-available", "upgrade-queue-acknowledgement", "upgrade-request-error"],
    ["queued-or-running", "upgrade-progress-visible", "stalled-run-recovery"],
    ["current", "current-version-visible", "status-refresh"],
    ["failed-recoverable", "recovery-controls-reachable", "failure-reason-visible"],
    ["blocked", "blocker-route-reachable", "blocker-reason-visible"],
  ] as const)("binds %s to scenario-specific signals", (state, completion, correction) => {
    expect(resolveSelfUpgradePurposeSignals(state)).toEqual({
      completion,
      correction,
    });
  });
});
