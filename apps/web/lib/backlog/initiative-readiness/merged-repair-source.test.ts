// BI-46E344FE — the merged-repair source names every delivering commit, in
// order, and anchors to a delivery room that never recorded its head.
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ item: vi.fn(), rooms: vi.fn(), merged: vi.fn(), actors: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { backlogItem: { findUnique: io.item }, workroom: { findMany: io.rooms } } }));
vi.mock("./merge-delivery-signal", () => ({ resolveMergedDeliveryCommitFromDb: io.merged }));
vi.mock("@/lib/backlog/acceptance-sweep/delivery-actors", () => ({ loadItemDeliveryActorIds: io.actors }));

import { defaultLoadMergedRepairSource } from "./merged-repair-source";

const repo = "OpenDigitalProductFactory/opendigitalproductfactory";
const room = { capsuleId: "WC-1", backlogItemId: "BI-X", repositoryFullName: repo, baseSha: "1".repeat(40),
  headBranch: "fix/x", headSha: "2".repeat(40), pullRequestNumber: 5, status: "archived", createdAt: new Date("2026-10-01T00:00:00Z") };
const older = { sha: "a".repeat(40), parentSha: "b".repeat(40), subject: "fix: first (BI-X) (#4)" };
const newer = { sha: "c".repeat(40), parentSha: "d".repeat(40), subject: "fix: second (BI-X) (#5)" };

beforeEach(() => {
  vi.clearAllMocks();
  io.item.mockResolvedValue({ id: "row", itemId: "BI-X", workType: "bug" });
  io.rooms.mockResolvedValue([room]);
  io.actors.mockResolvedValue({ ok: true, data: ["AGT-AUTHOR"] });
  io.merged.mockResolvedValue({ kind: "found", commit: newer });
});

describe("merged-repair source (BI-46E344FE)", () => {
  it("names a single delivering commit as a one-range delivery", async () => {
    await expect(defaultLoadMergedRepairSource({ itemId: "BI-X", refusedWorkroomId: null })).resolves.toMatchObject({
      kind: "found", mergedCommitSha: newer.sha, parentSha: newer.parentSha,
      commits: [{ sha: newer.sha, parentSha: newer.parentSha }], room: { headSha: room.headSha } });
  });

  it("names every delivering commit, oldest first, instead of refusing a multi-PR delivery", async () => {
    io.merged.mockResolvedValue({ kind: "ambiguous", commits: [older, newer] });
    await expect(defaultLoadMergedRepairSource({ itemId: "BI-X", refusedWorkroomId: null })).resolves.toMatchObject({
      kind: "found", mergedCommitSha: newer.sha, parentSha: newer.parentSha,
      commits: [{ sha: older.sha, parentSha: older.parentSha }, { sha: newer.sha, parentSha: newer.parentSha }] });
  });

  it("still refuses a delivery spread over more commits than one review can hold", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ sha: String(i).repeat(40), parentSha: "e".repeat(40), subject: "s" }));
    io.merged.mockResolvedValue({ kind: "ambiguous", commits: many });
    await expect(defaultLoadMergedRepairSource({ itemId: "BI-X", refusedWorkroomId: null }))
      .resolves.toMatchObject({ kind: "unavailable", reason: "merged-delivery-ambiguous" });
  });

  it("anchors a delivery room that never recorded its base or head to the merged head", async () => {
    io.rooms.mockResolvedValue([{ ...room, baseSha: null, headSha: null }]);
    await expect(defaultLoadMergedRepairSource({ itemId: "BI-X", refusedWorkroomId: null })).resolves.toMatchObject({
      kind: "found", mergedCommitSha: newer.sha,
      room: { capsuleId: "WC-1", headBranch: "fix/x", headSha: newer.sha, baseSha: newer.parentSha } });
  });

  it.each([
    ["no repository", { repositoryFullName: null }],
    ["no branch", { headBranch: null }],
    ["a malformed recorded head", { headSha: "not-a-sha" }],
  ])("keeps refusing an anchor room with %s", async (_label, patch) => {
    io.rooms.mockResolvedValue([{ ...room, ...patch }]);
    await expect(defaultLoadMergedRepairSource({ itemId: "BI-X", refusedWorkroomId: null }))
      .resolves.toMatchObject({ kind: "unavailable", reason: "workroom-identity-incomplete" });
  });
});
