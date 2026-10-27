import { describe, expect, it, vi } from "vitest";
import { assertBoundedHandoffDependencies } from "./bounded-handoff-dependencies";
const room = { id: "room", capsuleId: "WC-room", featureBuildId: null, repositoryFullName: "owner/repo", headSha: "a".repeat(40), headBranch: "feat/work", executorKind: "claude-desktop", executorRef: "source" };
const now = new Date("2026-10-23T23:00:00Z");
function fixture() {
  return { $queryRaw: vi.fn().mockResolvedValue([{ now }]), nonProductionEnvironmentLease: { findFirst: vi.fn().mockResolvedValue(null) }, externalEvidenceRecord: { findMany: vi.fn().mockResolvedValue([]) } };
}
const check = (db: ReturnType<typeof fixture>, capsule = room) => assertBoundedHandoffDependencies(db as never, { capsule, sourceExecutorRef: "source", destinationExecutorRef: "receiver" });
describe("bounded handoff dependency fence", () => {
  it("accepts the absence of lease and applicable exemption dependencies", async () => { await expect(check(fixture())).resolves.toBeUndefined(); });
  it.each(["queued", "active", "unknown-positive"])("refuses a %s lease even when its TTL elapsed", async status => {
    const db = fixture(); db.nonProductionEnvironmentLease.findFirst.mockResolvedValue({ leaseId: "NPEL-held", status, expiresAt: new Date(now.getTime()-1000), ownerSessionId: "receiver", environmentKey: "local-integration-ci" });
    await expect(check(db)).rejects.toMatchObject({ code: "handoff-lease-dependency" });
    expect(db.nonProductionEnvironmentLease.findFirst.mock.calls[0][0].where).toMatchObject({ ownerSessionId: { in: ["source", "receiver"] }, status: { notIn: ["released", "expired", "cancelled"] } });
  });
  it("refuses Build Studio associations before considering external destinations", async () => {
    await expect(check(fixture(), { ...room, featureBuildId: "build" } as never)).rejects.toMatchObject({ code: "handoff-build-dependency" });
  });
  it("finds applicable evidence beyond unrelated newer heads", async () => {
    const db=fixture(); db.externalEvidenceRecord.findMany.mockResolvedValue([{ id: "old-current", details: { sourceHeadSha: room.headSha, sourceRepository: room.repositoryFullName, sourceBranch: room.headBranch, sourceExecutorRef: "source", expiresAt: new Date(now.getTime()+1000).toISOString() } }]);
    await expect(check(db)).rejects.toMatchObject({ code: "handoff-policy-exemption-dependency" });
    expect(db.externalEvidenceRecord.findMany.mock.calls[0][0].where).toMatchObject({ workCapsuleId: "room", operationType: "semantic-change-review.exemption", details: { path: ["sourceHeadSha"], equals: room.headSha } });
  });
  it("ignores a provably expired applicable exception", async () => {
    const db=fixture(); db.externalEvidenceRecord.findMany.mockResolvedValue([{ id: "old-current", details: { sourceHeadSha: room.headSha, sourceRepository: room.repositoryFullName, sourceBranch: room.headBranch, sourceExecutorRef: "source", expiresAt: new Date(now.getTime()-1000).toISOString() } }]);
    await expect(check(db)).resolves.toBeUndefined();
  });
  it.each([{}, { expiresAt: "invalid" }])("refuses malformed potentially applicable evidence", async details => {
    const db=fixture(); db.externalEvidenceRecord.findMany.mockResolvedValue([{ id: "malformed", details }]);
    await expect(check(db)).rejects.toMatchObject({ code: "handoff-dependency-unavailable" });
  });
  it("refuses overflow instead of asserting absence from a truncated history", async () => {
    const db=fixture(); db.externalEvidenceRecord.findMany.mockResolvedValue(Array.from({length:101},()=>({ details:{} })));
    await expect(check(db)).rejects.toMatchObject({ code: "handoff-dependency-unavailable" });
  });
  it("refuses a failed dependency read", async () => {
    const db=fixture(); db.nonProductionEnvironmentLease.findFirst.mockRejectedValue(new Error("unavailable"));
    await expect(check(db)).rejects.toMatchObject({ code: "handoff-dependency-unavailable" });
  });
});
