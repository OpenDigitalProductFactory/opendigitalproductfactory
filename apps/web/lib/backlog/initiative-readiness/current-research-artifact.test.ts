import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prepareCurrentDesignObservation } from "./canonical-artifact-discovery";
import { prepareCurrentResearchObservation } from "./current-research-artifact";
import { baseline, item, readyActivities, receipt, transitionObject } from "./entry-adapter.test-fixtures";
import { projectBacklogItemReadiness } from "./entry-adapter";

const source = { repositoryFullName: "owner/repo", headBranch: "fix/child",
  baseSha: "a".repeat(40), headSha: "b".repeat(40) };
const bytes = new TextEncoder().encode("The child's original research, unchanged on its current head.");
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const blobId = "c".repeat(40);

function fixture() {
  const seed = receipt("research-current", "research");
  const research = { ...seed, payload: { ...seed.payload,
    subject: { kind: "backlog-item", id: "BI-CHILD" }, artifactDigest: digest,
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: source.repositoryFullName,
      commitSha: "d".repeat(40), path: "docs/superpowers/specs/child.md", providerBlobId: blobId },
  } };
  const room = { ...source, capsuleId: "WC-CHILD", leaseHolderPrincipalId: "owner",
    executorRef: "session", leaseExpiresAt: new Date("2026-10-25"), status: "ready", archivedAt: null as Date | null,
    backlogItemId: "child-row" };
  const rows: Array<typeof research> = [research];
  const rooms = [room];
  const db = { backlogItem: { findFirst: vi.fn().mockResolvedValue({ id: "child-row", itemId: "BI-CHILD", body: "existing body" }) },
    backlogItemActivity: { findMany: vi.fn().mockImplementation(async (query: { where: { gateKey?: string } }) =>
      query.where.gateKey === "research" ? [...rows].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime()
        || b.id.localeCompare(a.id)).slice(0, 1) : []) },
    workroom: { findMany: vi.fn().mockImplementation(async (query: { where: Record<string, unknown> & {
      backlogItemId: { in: string[] }; status: { notIn: string[] } } }) => rooms.filter(candidate =>
      query.where.backlogItemId.in.includes(candidate.backlogItemId) && candidate.archivedAt === null
      && !query.where.status.notIn.includes(candidate.status)
      && ["repositoryFullName", "headBranch", "baseSha", "headSha"].every(key =>
        query.where[key] === undefined || query.where[key] === candidate[key as keyof typeof candidate]))
      .map(({ archivedAt: _archivedAt, backlogItemId: _backlogItemId, ...candidate }) => ({ ...candidate }))) },
    $queryRaw: vi.fn().mockResolvedValue([]) };
  const readBlob = vi.fn().mockResolvedValue({ ok: true, data: bytes, blobId });
  const prepare = () => prepareCurrentResearchObservation({
    itemId: "BI-CHILD", db: db as never, claimSource: source, ports: { readBlob },
  });
  return { db, research, room, rooms, rows, readBlob, prepare };
}
const verified = { state: "verified", receiptId: "research-current", digest };

describe("current child research source observation", () => {
  it("reads the child's recorded artifact at its real current head without selecting a parent design", async () => {
    const f = fixture();
    const result = await prepareCurrentDesignObservation({ itemId: "BI-CHILD", db: f.db as never,
      claimSource: source, ports: { research: { readBlob: f.readBlob } } });
    expect(result.evidence).toEqual({ state: "not-applicable", research: verified });
    expect(f.readBlob).toHaveBeenCalledWith({ repositoryFullName: source.repositoryFullName,
      commitSha: source.headSha, path: f.research.payload.artifactRef.path, expectedBlobId: blobId });
    expect(await result.admissionGuard(f.db as never)).toEqual(result.evidence);
    expect(f.readBlob).toHaveBeenCalledTimes(1);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(f.db.$queryRaw.mock.calls.map(call => [call[0].join("?"), ...call.slice(1)]))
      .toEqual([[expect.stringContaining('"BacklogItem"'), "child-row"], [expect.stringContaining('"WorkCapsule"'), "WC-CHILD"]]);
    expect(f.db.backlogItemActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { backlogItemId: "child-row", kind: "initiative_gate_receipt", gateKey: "research" },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1,
    }));
  });
  it("retains no-own-research inheritance without a provider read", async () => {
    const f = fixture(); f.rows.splice(0);
    const result = await f.prepare();
    expect(result.evidence).toBeUndefined();
    expect(await result.admissionGuard(f.db as never)).toBeUndefined();
    expect(f.readBlob).not.toHaveBeenCalled();
  });
  it.each(["item-body", "document"])("does not fetch unused own research for an own %s baseline", async kind => {
    const f = fixture();
    f.db.backlogItemActivity.findMany.mockImplementation(async query => query.where.gateKey === "research" ? [f.research] : [{
      id: "own-baseline-row", kind: "initiative_scope_baseline", gateKey: null, recordedAt: new Date(), payload: {
        ...baseline, subject: { kind: "backlog-item", id: "BI-CHILD" },
        ...(kind === "item-body" ? { origin: "item-body" } : { artifactRef: { kind: "document-version",
          repositoryFullName: source.repositoryFullName, versionId: "document-1", valueDigest: "sha256:document" } }),
      },
    }]);
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-CHILD", db: f.db as never,
      ports: { research: { readBlob: f.readBlob } } });
    expect(prepared.evidence).toEqual({ state: "not-applicable" });
    expect(await prepared.admissionGuard(f.db as never)).toEqual(prepared.evidence);
    expect(f.readBlob).not.toHaveBeenCalled();
    expect(f.db.workroom.findMany).not.toHaveBeenCalled();
    expect(f.db.backlogItemActivity.findMany.mock.calls.every(([query]) => query.where.gateKey !== "research")).toBe(true);
  });
  it("does not approve a failed inherited design when own source research is current", async () => {
    const f = fixture();
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-CHILD", db: f.db as never,
      ports: { research: { readBlob: f.readBlob } } });
    const parent = readyActivities().map(row => row.gateKey === "spec-approval"
      ? { ...row, payload: { ...row.payload, decision: "fail" } } : row);
    const projection = projectBacklogItemReadiness({
      item: { ...item, itemId: "BI-CHILD" }, activities: [f.research],
      inheritedScope: { parentItemId: item.itemId, coverageActivityId: "existing-coverage", activities: parent },
      currentDesign: await prepared.admissionGuard(f.db as never), target: "implementation", transitionObject,
      authorization: "pass", capsuleIdentity: "pass", evaluatedAt: "2026-10-24T00:00:00.000Z",
    });
    expect(projection.decision.satisfied).toContainEqual(expect.objectContaining({ code: "RESEARCH_REQUIRED", state: "pass" }));
    expect(projection.decision.blockers).toContainEqual(expect.objectContaining({ code: "REVIEW_FAILED", state: "fail" }));
    expect(projection.decision.verdict).toBe("denied");
    expect(projection.baselineId).toBe(baseline.baselineId);
  });
  it.each(["missing", "ambiguous", "archived", "abandoned", "foreign-subject", "foreign-repository", "invalid-head"])(
    "refuses %s current child scope without consulting the provider", async scenario => {
      const f = fixture();
      if (scenario === "missing") f.rooms.splice(0);
      if (scenario === "ambiguous") f.rooms.push({ ...f.room, capsuleId: "WC-OTHER" });
      if (scenario === "archived") f.room.archivedAt = new Date();
      if (scenario === "abandoned") f.room.status = "abandoned";
      if (scenario === "foreign-subject") f.room.backlogItemId = "other-row";
      if (scenario === "foreign-repository") f.research.payload.artifactRef.repositoryFullName = "other/repo";
      if (scenario === "invalid-head") f.room.headSha = "missing";
      const result = await f.prepare();
      expect(result.evidence).toEqual({ state: "unavailable" });
      expect(await result.admissionGuard(f.db as never)).toEqual(result.evidence);
      expect(f.readBlob).not.toHaveBeenCalled();
    });
  it("narrows the lookup to the actual claim tuple among other live rooms", async () => {
    const f = fixture(); f.rooms.push({ ...f.room, capsuleId: "WC-OTHER", headBranch: "fix/other" });
    expect((await f.prepare()).evidence).toEqual(verified);
    expect((await prepareCurrentResearchObservation({ itemId: "BI-CHILD", db: f.db as never,
      ports: { readBlob: f.readBlob } })).evidence).toEqual({ state: "unavailable" });
    expect(f.readBlob).toHaveBeenCalledTimes(1);
  });
  it.each(["malformed", "wrong-subject", "wrong-receipt", "invalid-commit", "invalid-blob", "document", "authority-denied"])(
    "does not fall back past a %s latest receipt", async scenario => {
      const f = fixture();
      f.rows.push({ ...structuredClone(f.research), id: "older", recordedAt: new Date(0) });
      if (scenario === "malformed") f.research.payload.schemaVersion = 0;
      if (scenario === "wrong-subject") f.research.payload.subject.id = "BI-OTHER";
      if (scenario === "wrong-receipt") f.research.payload.receiptId = "other-receipt";
      if (scenario === "invalid-commit") f.research.payload.artifactRef.commitSha = "short";
      if (scenario === "invalid-blob") f.research.payload.artifactRef.providerBlobId = "short";
      if (scenario === "document") f.research.payload.artifactRef.kind = "document-version";
      if (scenario === "authority-denied") f.research.payload.authoritySnapshot.decision = "deny";
      expect((await f.prepare()).evidence).toEqual({ state: "unavailable" });
      expect(f.readBlob).not.toHaveBeenCalled();
    });
  it("rejects a newer own receipt inserted during the provider await", async () => {
    const f = fixture(); f.readBlob.mockImplementation(async () => {
      const newer = structuredClone(f.research);
      newer.id = newer.payload.receiptId = "newer";
      newer.recordedAt = new Date("2026-10-24"); f.rows.push(newer);
      return { ok: true, data: bytes, blobId };
    });
    expect((await f.prepare()).evidence).toEqual({ state: "unavailable" });
  });
  it.each(["IMMUTABLE_BLOB_MISMATCH", "IMMUTABLE_SOURCE_UNAVAILABLE", "IMMUTABLE_SOURCE_TOO_LARGE"])(
    "retains %s as unavailable rather than an old pass", async code => {
      const f = fixture(); f.readBlob.mockResolvedValue({ ok: false, code, error: "provider refused" });
      const result = await f.prepare();
      expect(result.evidence).toEqual({ state: "unavailable" });
      expect(await result.admissionGuard(f.db as never)).toEqual(result.evidence);
      expect(f.readBlob).toHaveBeenCalledTimes(1);
    });
  it.each(["headSha", "baseSha", "headBranch", "repositoryFullName", "leaseHolderPrincipalId", "executorRef", "leaseExpiresAt", "status"] as const)(
    "refuses a %s change during immutable source read", async field => {
      const f = fixture(); f.readBlob.mockImplementation(async () => {
        if (field === "leaseExpiresAt") f.room[field] = new Date("2026-10-26");
        else f.room[field] = field.endsWith("Sha") ? "e".repeat(40) : "changed";
        return { ok: true, data: bytes, blobId };
      });
      expect((await f.prepare()).evidence).toEqual({ state: "unavailable" });
    });
  it.each(["headSha", "leaseExpiresAt", "receipt", "receipt-path", "selection", "archive"])(
    "refuses a %s change under admission locks without repeating provider I/O", async scenario => {
      const f = fixture(); const result = await f.prepare();
      f.db.$queryRaw.mockImplementation(async () => {
        if (scenario === "headSha") f.room.headSha = "e".repeat(40);
        if (scenario === "leaseExpiresAt") f.room.leaseExpiresAt = new Date("2026-10-26");
        if (scenario === "receipt") f.rows.push({ ...structuredClone(f.research), id: "newer", recordedAt: new Date("2026-10-24") });
        if (scenario === "receipt-path") f.research.payload.artifactRef.path = "docs/superpowers/specs/changed.md";
        if (scenario === "selection") f.db.backlogItem.findFirst.mockResolvedValue({ id: "child-row", itemId: "BI-CHILD", body: "changed" });
        if (scenario === "archive") f.room.archivedAt = new Date();
        return [];
      });
      expect(await result.admissionGuard(f.db as never)).toEqual({ state: "unavailable" });
      expect(f.readBlob).toHaveBeenCalledTimes(1);
    });
  it("refuses a new own receipt after a no-own-research observation", async () => {
    const f = fixture(); f.rows.splice(0); const result = await f.prepare(); f.rows.push(f.research);
    expect(await result.admissionGuard(f.db as never)).toEqual({ state: "unavailable" });
    expect(f.readBlob).not.toHaveBeenCalled();
  });
  it("cannot admit if transaction source locks are unavailable", async () => {
    const f = fixture(); const result = await f.prepare();
    expect(await result.admissionGuard({ ...f.db, $queryRaw: undefined } as never)).toEqual({ state: "unavailable" });
  });
});
