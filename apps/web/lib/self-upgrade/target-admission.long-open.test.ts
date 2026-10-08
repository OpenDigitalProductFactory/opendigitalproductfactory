import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { selectSelfUpgradeAdmissionTarget } from "./target-admission";
import { createSelfUpgradeTargetBinding } from "./target-binding";

const TARGET = {
  targetKind: "release-artifact" as const,
  targetSha: "787700918778f5db56ca6c9c2701baa176650949",
  targetTag: "v2026.08.31-source-free-verification-preflight.1",
};

describe("long-open self-upgrade target admission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T20:30:00.000Z"));
    vi.stubEnv("DPF_SELF_UPGRADE_TARGET_BINDING_SECRET", "test-target-binding-secret");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("selects only the current server target when the exact rendered binding expired", () => {
    const expiredBinding = createSelfUpgradeTargetBinding(TARGET, {
      now: new Date("2026-08-31T15:00:00.000Z"),
    });

    expect(selectSelfUpgradeAdmissionTarget({
      targetBinding: expiredBinding,
      supportTargetKind: "release-artifact",
      resolvedTarget: TARGET,
    })).toEqual({ ok: true, data: TARGET });
  });
  // BI-231A4BC7 / AC-NO-UPGRADE-BREAK: the operator's page was rendered by the
  // pre-upgrade portal, which signed with AUTH_SECRET because no install had the
  // dedicated key. The upgrade provisions the key and recreates the portal; the
  // same page must still be able to admit the next action (including recovery of
  // a failed run, which requires a binding) during the grace window.
  it("admits a binding the pre-upgrade portal signed with AUTH_SECRET after the dedicated key is provisioned", () => {
    vi.stubEnv("AUTH_SECRET", "pre-upgrade-session-secret");
    const renderedBeforeUpgrade = createSelfUpgradeTargetBinding(TARGET, {
      now: new Date("2026-08-31T20:25:00.000Z"),
      secret: "pre-upgrade-session-secret",
    });

    expect(selectSelfUpgradeAdmissionTarget({
      targetBinding: renderedBeforeUpgrade,
      supportTargetKind: "release-artifact",
      resolvedTarget: TARGET,
    })).toEqual({ ok: true, data: TARGET });
  });
});
