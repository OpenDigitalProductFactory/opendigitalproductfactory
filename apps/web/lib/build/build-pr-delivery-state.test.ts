import { describe, expect, it } from "vitest";

import {
  createBuildPrDeliveryState,
  readBuildPrDeliveryState,
  writeBuildPrDeliveryState,
} from "./build-pr-delivery-state";
import { createPrFollowThrough } from "./pr-follow-through";

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

  it("keeps one room-generic record for every room and reads the legacy Build Studio location (BI-88341B5D)", () => {
    const state = createBuildPrDeliveryState({ repository: "o/r", prNumber: 7, prUrl: "https://github.com/o/r/pull/7" });
    expect(state.followThrough).toEqual(createPrFollowThrough());

    // A row written before follow-through existed still reads, with a clean record.
    const { followThrough: _omit, ...legacy } = state;
    const legacyWorkspace = { buildStudio: { buildId: "FB-1", delivery: legacy } };
    expect(readBuildPrDeliveryState(legacyWorkspace)).toEqual(state);

    // Writing moves it to the room-generic key and keeps the build's other fields.
    const written = writeBuildPrDeliveryState(legacyWorkspace, { ...state, status: "checking" });
    expect(written.prDelivery).toEqual(expect.objectContaining({ status: "checking", prNumber: 7 }));
    expect(written.buildStudio).toEqual({ buildId: "FB-1" });
    expect(readBuildPrDeliveryState(written)?.status).toBe("checking");

    // A non-Build-Studio room never grows a buildStudio key.
    expect(writeBuildPrDeliveryState({ claim: "kept" }, state)).not.toHaveProperty("buildStudio");
  });
});
