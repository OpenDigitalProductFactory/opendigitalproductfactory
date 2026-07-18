import { describe, expect, it } from "vitest";
import { assessCapabilityDeactivation } from "./capability-transition";

describe("capability deactivation decision", () => {
  const currentProjection = { enabledRuntimeCapabilities: ["runtime:core", "runtime:build"], capabilityStateVersion: "before" };

  it("requires drain, names blockers, and preserves the active projection", () => {
    expect(assessCapabilityDeactivation({
      capabilityId: "runtime:build",
      currentProjection,
      blockingCounts: { "build-studio-active": 2, "task-run:build": 1, "work-capsule:build-studio": 0 },
    })).toEqual({
      status: "drain_required",
      capabilityId: "runtime:build",
      blockingCounts: { "build-studio-active": 2, "task-run:build": 1 },
      currentProjection,
    });
  });

  it("allows a transition when every attributed work count is zero", () => {
    expect(assessCapabilityDeactivation({ capabilityId: "runtime:build", currentProjection, blockingCounts: { "build-studio-active": 0 } }))
      .toEqual({ status: "ready", capabilityId: "runtime:build", currentProjection });
  });
});
