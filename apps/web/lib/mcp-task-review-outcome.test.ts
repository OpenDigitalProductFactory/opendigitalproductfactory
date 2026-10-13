import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ item: vi.fn(), execution: vi.fn(), update: vi.fn(), updateMany: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { backlogItem: { findUnique: db.item }, toolExecution: { findFirst: db.execution }, taskRun: { update: db.update, updateMany: db.updateMany } } }));
vi.mock("./backlog/initiative-readiness/parent-scope-inheritance", () => ({ loadInheritedInitiativeScope: vi.fn(async () => null) }));
import { loadInitiativeReviewOutcome, loadTaskInitiativeReviewOutcome, reconcilePersistedReviewStatus } from "./mcp-task-review-outcome";

const artifactRef = { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo", commitSha: "sha", providerBlobId: "blob", path: "design.md" };
const binding = { itemId: "BI-TEST", gate: "design-spec", artifactRef, writerToolName: "record_initiative_design_review" };
const receipt = { schemaVersion: 1, receiptId: "receipt", gate: "design-spec", decision: "pass",
  subject: { kind: "backlog-item", id: "BI-TEST" }, artifactRef, artifactDigest: "digest",
  reviewerPrincipalId: "reviewer", reviewerAgentId: "AGT-WS-REVIEW", artifactAuthorRef: "author",
  authorityDecisionId: "AUTH-1", authoritySnapshot: {}, findingRefs: [], resolvedFindingRefs: [], reason: "Reviewed." };
function item(payload: unknown = receipt) {
  return { id: "item", itemId: "BI-TEST", type: "product", workType: "bug", scopeKind: "platform", source: "user-request", activeBuild: null,
    activities: [{ id: "receipt", kind: "initiative_gate_receipt", gateKey: "design_spec", recordedAt: new Date(), payload }] };
}
const snapshot = { taskRunId: "TR-1", status: "input-required", updatedAt: new Date("2026-10-11T12:00:00Z"), progressPayload: { auditMarker: "retain", terminalWriterWait: {}, approvalEnvelopeId: "stale" } };
beforeEach(() => { vi.resetAllMocks(); db.item.mockResolvedValue(item()); db.updateMany.mockResolvedValue({ count: 1 }); });
describe("persisted initiative review outcome", () => {
  it("reconciles stale status from a verified receipt while preserving unrelated progress", async () => {
    const outcome = await loadInitiativeReviewOutcome(binding, "receipt");
    expect(await reconcilePersistedReviewStatus(snapshot.taskRunId, snapshot.progressPayload, outcome!, snapshot)).toBe(true);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.updateMany.mock.calls[0][0].where).toEqual({ taskRunId: snapshot.taskRunId, status: snapshot.status, updatedAt: snapshot.updatedAt });
    const data = db.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("completed");
    expect(data.progressPayload).toMatchObject({ auditMarker: "retain", reviewOutcome: { receiptId: "receipt" }, requiresApproval: false });
    expect(data.progressPayload).not.toHaveProperty("terminalWriterWait");
    expect(data.progressPayload).not.toHaveProperty("approvalEnvelopeId");
  });
  it.each(["canceled", "failed", "rejected", "archived", "quiescing", "unknown"])("does not revive a %s task from a receipt", async status => {
    const outcome = await loadInitiativeReviewOutcome(binding, "receipt");
    expect(await reconcilePersistedReviewStatus(snapshot.taskRunId, snapshot.progressPayload, outcome!, { ...snapshot, status })).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it("yields when cancellation or a newer attempt wins during receipt lookup", async () => {
    db.updateMany.mockResolvedValue({ count: 0 });
    const outcome = await loadInitiativeReviewOutcome(binding, "receipt");
    expect(await reconcilePersistedReviewStatus(snapshot.taskRunId, snapshot.progressPayload, outcome!, snapshot)).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("reports the matching receipt while preserving unmet implementation gates", async () => {
    const result = await loadInitiativeReviewOutcome(binding, "receipt");
    expect(result?.receiptId).toBe("receipt");
    expect(result?.readiness.verdict).not.toBe("allowed");
    expect(result?.summary).toContain("receipt receipt persisted");
    expect(result?.readiness.unmet.some((entry) => entry.code === "PLAN_REQUIRED")).toBe(true);
  });
  it.each([
    { ...receipt, gate: "research" },
    { ...receipt, artifactRef: { ...artifactRef, providerBlobId: "other" } },
    { ...receipt, subject: { kind: "backlog-item", id: "BI-OTHER" } },
    { ...receipt, decision: "invented" },
  ])("does not infer a matching receipt from incompatible persistence", async (payload) => {
    db.item.mockResolvedValue(item(payload));
    expect(await loadInitiativeReviewOutcome(binding, "receipt")).toBeNull();
  });
  it("does not manufacture a receipt from successful tool execution without its persisted row", async () => {
    db.execution.mockResolvedValue({ result: { success: true, data: { receiptId: "absent" } } });
    expect(await loadTaskInitiativeReviewOutcome("TR-1", binding)).toBeNull();
  });
});

describe("receipt artifact identity (BI-2E479619 follow-up)", () => {
  // A feature-build revision binding carries repositoryFullName and valueDigest;
  // the persisted receipt keeps only the identity (kind + revisionId). Live, 245
  // parked reviewer runs held exactly this pair and never healed.
  const revisionRef = { kind: "feature-build-revision" as const, repositoryFullName: "owner/repo", revisionId: "rev-1", valueDigest: "sha256:abc" };
  const revisionBinding = { ...binding, artifactRef: revisionRef };
  const storedRevision = { kind: "feature-build-revision", revisionId: "rev-1" };

  it("matches a revision receipt that stores only the revision identity", async () => {
    db.item.mockResolvedValue(item({ ...receipt, artifactRef: storedRevision }));
    expect((await loadInitiativeReviewOutcome(revisionBinding, "receipt"))?.receiptId).toBe("receipt");
  });
  it("does not match a different revision", async () => {
    db.item.mockResolvedValue(item({ ...receipt, artifactRef: { ...storedRevision, revisionId: "rev-2" } }));
    expect(await loadInitiativeReviewOutcome(revisionBinding, "receipt")).toBeNull();
  });
  it("does not match when a stored non-identity field contradicts the binding", async () => {
    db.item.mockResolvedValue(item({ ...receipt, artifactRef: { ...storedRevision, valueDigest: "sha256:other" } }));
    expect(await loadInitiativeReviewOutcome(revisionBinding, "receipt")).toBeNull();
  });
  it("matches a document-version receipt that stores only the version identity", async () => {
    const documentBinding = { ...binding, artifactRef: { kind: "document-version" as const, repositoryFullName: "owner/repo", versionId: "ver-1", valueDigest: "sha256:abc" } };
    db.item.mockResolvedValue(item({ ...receipt, artifactRef: { kind: "document-version", versionId: "ver-1" } }));
    expect((await loadInitiativeReviewOutcome(documentBinding, "receipt"))?.receiptId).toBe("receipt");
  });
  it("still requires every identity key of a repo blob", async () => {
    const { path: _omitted, ...withoutPath } = artifactRef;
    db.item.mockResolvedValue(item({ ...receipt, artifactRef: withoutPath }));
    expect(await loadInitiativeReviewOutcome(binding, "receipt")).toBeNull();
  });
});
