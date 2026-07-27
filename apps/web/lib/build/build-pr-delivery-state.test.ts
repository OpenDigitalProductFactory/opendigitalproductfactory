import { describe, expect, it } from "vitest";

import {
  createBuildPrDeliveryState,
  readBuildPrDeliveryState,
  writeBuildPrDeliveryState,
} from "./build-pr-delivery-state";

describe("BuildPrDeliveryStateV1", () => {
  it("initializes restart-safe PR identity without replacing unrelated capsule state", () => {
    const state = createBuildPrDeliveryState({
      repository: "o/r",
      prNumber: 42,
      prUrl: "https://github.com/o/r/pull/42",
    });
    const workspace = writeBuildPrDeliveryState({ claim: "kept" }, state);

    expect(workspace.claim).toBe("kept");
    expect(readBuildPrDeliveryState(workspace)).toEqual(state);
    expect(state).toEqual(expect.objectContaining({
      schemaVersion: 1,
      status: "created",
      repository: "o/r",
      prNumber: 42,
      staleUpdateAttempts: 0,
      reconciliationAttempts: 0,
    }));
  });

  it("fails closed for malformed and future-version state", () => {
    expect(readBuildPrDeliveryState(null)).toBeNull();
    expect(readBuildPrDeliveryState({ buildStudio: { delivery: { schemaVersion: 2 } } })).toBeNull();
    expect(readBuildPrDeliveryState({ buildStudio: { delivery: { schemaVersion: 1, status: "bogus" } } })).toBeNull();
  });
});
