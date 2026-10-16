import { describe, expect, it, vi } from "vitest";
import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { isCurrentDeliveredBodyAuthor, resolveBodyBaselineAuthorRoom } from "./body-baseline-author-room";

const item = { id: "row", itemId: "BI-CASE" };
const room = { id: "room-row", capsuleId: "WC-CASE", backlogItemId: item.itemId,
  repositoryFullName: "owner/repo", headSha: "a".repeat(40), baseSha: "b".repeat(40),
  headBranch: "fix/accepted", createdByPrincipalId: "author", status: "archived",
  archivedAt: new Date("2026-10-16T06:00:00Z"), createdAt: new Date("2026-10-15T06:00:00Z"), pullRequestNumber: 6265 };
const observation = { repositoryFullName: room.repositoryFullName, number: room.pullRequestNumber,
  url: "https://github.com/owner/repo/pull/6265", title: "repair", headBranch: room.headBranch,
  headSha: room.headSha, state: "merged" as const, isDraft: false, mergeStateStatus: null,
  mergeCommitSha: "c".repeat(40), mergedAt: "2026-10-16T05:00:00Z",
  providerUpdatedAt: "2026-10-16T05:00:00Z", observedAt: "2026-10-16T05:01:00Z" };
function database(attempts = [room], payload: unknown = createPullRequestObservation(observation), active: unknown[] = []) {
  return { workroom: { findMany: vi.fn(async ({ where }) => where.archivedAt === null ? active : attempts) },
    contributorInventorySnapshot: { findMany: vi.fn().mockResolvedValue([{ payload }]) } };
}
const expected = { workroomId: room.capsuleId, repositoryFullName: room.repositoryFullName,
  branchName: room.headBranch, headSha: room.headSha };

describe("body acceptance source authorship after execution retirement", () => {
  it("selects the exact verified merged author without changing its archived state", async () => {
    const db = database();
    expect(await resolveBodyBaselineAuthorRoom(db as never, item)).toEqual(room);
    expect(await isCurrentDeliveredBodyAuthor(db as never, item, expected)).toBe(true);
    expect(room.status).toBe("archived");
    expect(db.contributorInventorySnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { source: "github-pr", sourceKey: "6265" } }));
  });
  it("uses the current active author and never treats it as archived delivery", async () => {
    const active = { ...room, archivedAt: null, status: "working" };
    const db = database([room], undefined, [active]);
    expect(await resolveBodyBaselineAuthorRoom(db as never, item)).toEqual(active);
    expect(await isCurrentDeliveredBodyAuthor(db as never, item, expected)).toBe(false);
    expect(db.contributorInventorySnapshot.findMany).not.toHaveBeenCalled();
  });
  it("refuses multiple active authors", async () => {
    expect(await resolveBodyBaselineAuthorRoom(database([room], undefined, [room, room]) as never, item)).toBeNull();
  });
  it.each([
    { state: "open" as const, mergedAt: null, mergeCommitSha: null },
    { state: "closed" as const, mergedAt: null, mergeCommitSha: null },
    { isDraft: true }, { headSha: "d".repeat(40) }, { headBranch: "fix/other" },
    { repositoryFullName: "other/repo", url: "https://github.com/other/repo/pull/6265" },
    { number: 6266, url: "https://github.com/owner/repo/pull/6266" },
  ])("refuses nonmatching or undelivered provider evidence %s", async change => {
    expect(await resolveBodyBaselineAuthorRoom(database([room], createPullRequestObservation({ ...observation, ...change })) as never, item)).toBeNull();
  });
  it.each([null, {}, { ...createPullRequestObservation(observation), observationFingerprint: "0".repeat(64) }])(
    "does not trust malformed or edited observation payloads", async payload => {
      expect(await resolveBodyBaselineAuthorRoom(database([room], payload) as never, item)).toBeNull();
    });
  it.each([{ status: "abandoned" }, { status: "superseded" }, { archivedAt: null },
    { createdByPrincipalId: null }, { headSha: "short" }, { baseSha: null }, { pullRequestNumber: null },
    { backlogItemId: "BI-OTHER" }])("refuses incomplete or ineligible current attempts %s", async change => {
    expect(await resolveBodyBaselineAuthorRoom(database([{ ...room, ...change }] as never) as never, item)).toBeNull();
  });
  it("does not cherry-pick an older delivered author past a newer failed attempt", async () => {
    const newer = { ...room, id: "new", capsuleId: "WC-NEW", status: "abandoned",
      createdAt: new Date("2026-10-16T05:00:00Z") };
    expect(await resolveBodyBaselineAuthorRoom(database([newer, room]) as never, item)).toBeNull();
  });
  it("fails closed when current attempts share an ambiguous creation timestamp", async () => {
    expect(await resolveBodyBaselineAuthorRoom(database([room, { ...room, id: "second" }]) as never, item)).toBeNull();
  });
  it.each([{ workroomId: "WC-OTHER" }, { headSha: "f".repeat(40) },
    { branchName: "fix/other" }, { repositoryFullName: "other/repo" }])("preserves exact request bindings %s", async change => {
    expect(await isCurrentDeliveredBodyAuthor(database() as never, item, { ...expected, ...change })).toBe(false);
  });
});
