import { describe, expect, it } from "vitest";
import { deriveCoworkerHealthState } from "./CoworkerHealthStatus";

describe("deriveCoworkerHealthState", () => {
  it("does not mark inference unavailable when cloud providers are usable even if model-runner is down", () => {
    const result = deriveCoworkerHealthState({
      monitoringOffline: false,
      modelRunnerUp: false,
      memoryUp: true,
      usableProviderCount: 1,
      cloudProviderCount: 1,
    });

    expect(result.offline).toBe(false);
    expect(result.inferenceUp).toBe(true);
  });

  it("marks inference unavailable when no providers are usable and model-runner is down", () => {
    const result = deriveCoworkerHealthState({
      monitoringOffline: false,
      modelRunnerUp: false,
      memoryUp: true,
      usableProviderCount: 0,
      cloudProviderCount: 0,
    });

    expect(result.inferenceUp).toBe(false);
  });

  it("keeps warnings hidden when monitoring is offline", () => {
    const result = deriveCoworkerHealthState({
      monitoringOffline: true,
      modelRunnerUp: false,
      memoryUp: false,
      usableProviderCount: 0,
      cloudProviderCount: 0,
    });

    expect(result.offline).toBe(true);
    expect(result.inferenceUp).toBe(true);
    expect(result.memoryUp).toBe(true);
  });
});
