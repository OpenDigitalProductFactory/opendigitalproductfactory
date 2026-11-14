// BI-8129F585: a ship build whose PR merged while its room was already closed
// (FB-E50E3024 via #3029, FB-C1CE0E72 via #3028) must settle its delivery
// from a verified GitHub observation, so the deployment closure can prove it.
import { describe, expect, it, vi } from "vitest";

import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { readBuildPrDeliveryState } from "./build-pr-delivery-state";
import {
  MERGED_PR_OBSERVATION_KEY,
  planMergedRoomSettlement,
  readRecordedMergedObservation,
  settleMergedShipBuildRooms,
} from "./merged-ship-room-settlement";

const sha = (c: string) => c.repeat(40);
const merged = createPullRequestObservation({
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  number: 3029,
  url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3029",
  title: "feat(FB-E50E3024): Canonical care data model and authority map",
  headBranch: "dpf/x/canonical-care",
  headSha: sha("a"),
  state: "merged",
  isDraft: false,
  mergeStateStatus: null,
  mergeCommitSha: "661fcda18d5cbc5fe5216d58a8bf7e0f4f3df3b5",
  mergedAt: "2026-07-16T00:46:24Z",
  providerUpdatedAt: "2026-07-16T00:46:25Z",
  observedAt: "2026-11-13T04:00:00Z",
});
// The live July room: closed, PR bound, no repository, head or delivery record.
const legacyRoom = {
  id: "room-1",
  capsuleId: "WC-2521F1B3",
  status: "complete",
  repositoryFullName: null,
  headSha: null,
  pullRequestNumber: 3029,
  pullRequestUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/3029",
  workspaceState: { buildStudio: { phase: "ideate", buildId: "FB-E50E3024" } },
};

describe("planMergedRoomSettlement", () => {
  it("records the merge on a closed room: repository, head, awaiting-release and the verified observation", () => {
    const plan = planMergedRoomSettlement(legacyRoom, merged, "2026-11-13T04:00:00Z");
    expect(plan).not.toBeNull();
    expect(plan!.repositoryFullName).toBe("OpenDigitalProductFactory/opendigitalproductfactory");
    expect(plan!.headSha).toBe(sha("a"));
    expect(readBuildPrDeliveryState(plan!.workspaceState)?.status).toBe("awaiting-release");
    expect(readRecordedMergedObservation(plan!.workspaceState)).toEqual(merged);
  });

  it("never rebinds a room whose recorded head is a different source", () => {
    expect(planMergedRoomSettlement({ ...legacyRoom, headSha: sha("e") }, merged, "2026-11-13T04:00:00Z")).toBeNull();
  });

  it("never binds a different repository or PR number", () => {
    expect(planMergedRoomSettlement({ ...legacyRoom, repositoryFullName: "other/repo" }, merged, "t")).toBeNull();
    expect(planMergedRoomSettlement({ ...legacyRoom, pullRequestNumber: 3028 }, merged, "t")).toBeNull();
  });

  it("records a closed-unmerged PR as closed, and leaves an open one alone", () => {
    const closed = createPullRequestObservation({ ...merged, state: "closed", mergeCommitSha: null, mergedAt: null });
    expect(readBuildPrDeliveryState(planMergedRoomSettlement(legacyRoom, closed, "t")!.workspaceState)?.status).toBe("closed");
    const open = createPullRequestObservation({ ...merged, state: "open", mergeCommitSha: null, mergedAt: null });
    expect(planMergedRoomSettlement(legacyRoom, open, "t")).toBeNull();
  });

  it("does nothing for a room whose delivery is already settled", () => {
    const settled = planMergedRoomSettlement(legacyRoom, merged, "t")!;
    expect(planMergedRoomSettlement({ ...legacyRoom, ...settled }, merged, "t")).toBeNull();
  });
});

describe("readRecordedMergedObservation", () => {
  it("rejects a tampered observation", () => {
    const tampered = { [MERGED_PR_OBSERVATION_KEY]: { ...merged, mergeCommitSha: sha("f") } };
    expect(readRecordedMergedObservation(tampered)).toBeNull();
  });
});

describe("settleMergedShipBuildRooms", () => {
  it("observes only closed PR rooms of ship builds and writes the settlement once", async () => {
    const update = vi.fn(async () => ({ count: 1 }));
    const read = vi.fn(async () => merged);
    const result = await settleMergedShipBuildRooms({
      listCandidates: async () => [legacyRoom],
      readObservation: read,
      saveRoom: update,
      now: () => new Date("2026-11-13T04:00:00Z"),
    });
    expect(read).toHaveBeenCalledWith({ repository: "OpenDigitalProductFactory/opendigitalproductfactory", prNumber: 3029 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ observed: 1, settled: 1 });
  });

  it("keeps going when one observation fails", async () => {
    const result = await settleMergedShipBuildRooms({
      listCandidates: async () => [legacyRoom, { ...legacyRoom, id: "room-2", pullRequestNumber: 3028, pullRequestUrl: legacyRoom.pullRequestUrl.replace("3029", "3028") }],
      readObservation: vi.fn().mockRejectedValueOnce(new Error("403 rate limit")).mockResolvedValueOnce(merged),
      saveRoom: vi.fn(),
      now: () => new Date(),
    });
    expect(result).toEqual({ observed: 1, settled: 0 });
  });
});
