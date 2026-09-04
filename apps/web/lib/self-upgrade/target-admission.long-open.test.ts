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
});
