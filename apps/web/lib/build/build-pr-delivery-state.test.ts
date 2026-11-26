import { describe, expect, it } from "vitest";

import {
  clearBuildPrDeliveryState,
  createBuildPrDeliveryState,
  readBuildPrDeliveryState,
  restoreBuildPrQueueHistory,
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

  it("rebinds known removal history only to the same PR, never queue intent", () => {
    const initial = createBuildPrDeliveryState({ repository: "o/r", prNumber: 42, prUrl: "https://github.com/o/r/pull/42" });
    const lastQueueRemoval = { eventId: "removed-1", headSha: "old" };
    const detached = clearBuildPrDeliveryState(writeBuildPrDeliveryState({}, {
      ...initial, lastQueueRemoval, queueIntentHeadSha: "old",
    }));
    expect(readBuildPrDeliveryState(detached)).toBeNull();
    expect(restoreBuildPrQueueHistory(initial, detached)).toEqual({ ...initial, lastQueueRemoval });
    const different = { ...initial, prNumber: 43 };
    expect(restoreBuildPrQueueHistory(different, detached)).toEqual(different);
  });

  it("keeps a previously observed arm on rebind without lending it to the replacement", () => {
    const active = createBuildPrDeliveryState({ repository: "o/r", prNumber: 42, prUrl: "https://github.com/o/r/pull/42" });
    const armed = { ...active, status: "armed" as const, lastObservedHeadSha: "old", queueIntentHeadSha: "old",
      lastObservedAt: "2026-11-25T23:00:00Z", lastActuatedAt: "2026-11-25T23:00:01Z" };
    const detached = clearBuildPrDeliveryState(writeBuildPrDeliveryState({}, armed));
    expect(restoreBuildPrQueueHistory(active, detached)).toMatchObject({
      status: "armed", lastObservedHeadSha: "old", lastActuatedAt: armed.lastActuatedAt,
    });
    expect(restoreBuildPrQueueHistory(active, detached).queueIntentHeadSha).toBeUndefined();
  });

  it("retires current and legacy delivery identity without erasing unrelated room state", () => {
    expect(clearBuildPrDeliveryState({
      claim: "kept",
      prDelivery: { schemaVersion: 1, prNumber: 7 },
      buildStudio: { buildId: "FB-1", delivery: { schemaVersion: 1, prNumber: 7 } },
    })).toEqual({ claim: "kept", buildStudio: { buildId: "FB-1" } });
  });
});
