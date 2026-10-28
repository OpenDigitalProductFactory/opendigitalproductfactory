import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectRemoteTaskReplay } from "./mcp-task-replay-projection";
const db = vi.hoisted(() => ({ item: vi.fn(), execution: vi.fn(), task: vi.fn(), receipts: vi.fn(), authority: vi.fn(), envelopes: vi.fn(), update: vi.fn(), updateMany: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { backlogItem: { findUnique: db.item }, toolExecution: { findFirst: db.execution },
  taskRun: { findUnique: db.task, update: db.update, updateMany: db.updateMany }, backlogItemActivity: { findMany: db.receipts },
  authorizationDecisionLog: { findUnique: db.authority }, coworkerActionEnvelope: { findMany: db.envelopes } } }));
vi.mock("./backlog/initiative-readiness/parent-scope-inheritance", () => ({ loadInheritedInitiativeScope: vi.fn(async () => null) }));
import { loadInitiativeReviewOutcome, loadTaskInitiativeReviewOutcome, reconcilePersistedReviewStatus } from "./mcp-task-review-outcome";

const artifactRef = { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo", commitSha: "sha", providerBlobId: "blob", path: "design.md" };
const binding = { itemId: "BI-TEST", gate: "design-spec", artifactRef, writerToolName: "record_initiative_design_review" };
const receipt = { schemaVersion: 1, receiptId: "receipt", gate: "design-spec", decision: "pass",
  subject: { kind: "backlog-item", id: "BI-TEST" }, artifactRef, artifactDigest: "digest",
  reviewerPrincipalId: "reviewer", reviewerAgentId: "AGT-WS-REVIEW", artifactAuthorRef: "author",
  authorityDecisionId: "AUTH-1", authoritySnapshot: {}, findingRefs: [], resolvedFindingRefs: [], reason: "Reviewed." };
function item(payload: unknown = receipt) {
  return { id: "item", itemId: "BI-TEST", organizationId: null, type: "product", workType: "bug", scopeKind: "platform", source: "user-request", activeBuild: null,
    activities: [{ id: "receipt", kind: "initiative_gate_receipt", gateKey: "design_spec", recordedAt: new Date(), payload }] };
}
const snapshot = { taskRunId: "TR-1", status: "input-required", updatedAt: new Date("2026-10-11T12:00:00Z"), progressPayload: { auditMarker: "retain", terminalWriterWait: {}, approvalEnvelopeId: "stale" } };
beforeEach(() => { vi.resetAllMocks(); db.item.mockResolvedValue(item()); db.updateMany.mockResolvedValue({ count: 1 }); });
describe("persisted initiative review outcome", () => {
  it.each(["current", "stale-ack", "failed-verdict", "unbound", "malformed", "other-task", "other-gate", "other-artifact", "other-row", "changed-binding", "future-binding", "unknown-digest", "missing-allow", "wrong-allow-scope", "wrong-snapshot", "conflicting-link", "ambiguous", "overflow"])(
    "recovers only a proven %s canonical task receipt when its writer acknowledgement is missing", async condition => {
      const persisted = { ...receipt, policyVersion: "initiative-v1", artifactDigest: "sha256:" + "a".repeat(64),
        authoritySnapshot: { decision: "allow", actionKey: binding.writerToolName, policyVersion: "authority-v1", organizationId: "platform",
          effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "initiative_design_review", tokenScope: "write" } };
      const row = { id: persisted.receiptId, backlogItemId: "item", kind: "initiative_gate_receipt", gateKey: "design_spec", payload: persisted };
      db.execution.mockResolvedValue(null);
      db.task.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", requestDigest: "9".repeat(64), initiativeReviewBinding: binding } });
      db.item.mockResolvedValue(item(persisted)); db.receipts.mockResolvedValue([row]);
      db.authority.mockResolvedValue({ decision: "allow", actionKey: binding.writerToolName, organizationId: null, policyVersion: "authority-v1", rationale: { taskRunId: "TR-1" } });
      db.envelopes.mockResolvedValue([]);
      if (condition === "stale-ack") db.execution.mockResolvedValue({ result: { success: true, data: { receiptId: "absent" } } });
      if (condition === "unbound") db.task.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", requestDigest: "9".repeat(64), initiativeReviewBinding: null } });
      if (condition === "malformed") Object.assign(persisted, { authoritySnapshot: {} });
      if (condition === "failed-verdict") Object.assign(persisted, { decision: "fail", findingRefs: ["finding"] });
      if (condition === "other-task") db.authority.mockResolvedValue({ ...await db.authority(), rationale: { taskRunId: "TR-OTHER" } });
      if (condition === "other-gate") persisted.gate = "research";
      if (condition === "other-artifact") persisted.artifactRef = { ...artifactRef, providerBlobId: "different" };
      if (condition === "other-row") row.backlogItemId = "foreign-item";
      if (condition === "changed-binding") db.task.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", requestDigest: "9".repeat(64), initiativeReviewBinding: { ...binding, gate: "research" } } });
      if (condition === "future-binding") db.task.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", requestDigest: "9".repeat(64), initiativeReviewBinding: { ...binding, futureGrant: true } } });
      if (condition === "unknown-digest") db.task.mockResolvedValue({ a2aMetadata: { trigger: "external-mcp", requestDigest: "unproven", initiativeReviewBinding: binding } });
      if (condition === "missing-allow") db.authority.mockResolvedValue(null);
      if (condition === "wrong-allow-scope") db.authority.mockResolvedValue({ ...await db.authority(), actionKey: "record_initiative_evidence" });
      if (condition === "wrong-snapshot") persisted.authoritySnapshot.policyVersion = "different-policy";
      if (condition === "conflicting-link") db.envelopes.mockResolvedValue([{ taskRunId: "TR-OTHER" }]);
      if (condition === "ambiguous") db.receipts.mockResolvedValue([row, { ...row, id: "receipt-2", payload: { ...persisted, receiptId: "receipt-2" } }]);
      if (condition === "overflow") db.receipts.mockResolvedValue(Array.from({ length: 251 }, () => row));
      const outcome = await loadTaskInitiativeReviewOutcome("TR-1", binding);
      if (["current", "stale-ack", "failed-verdict"].includes(condition)) {
        expect(outcome).toMatchObject({ receiptId: "receipt", gate: binding.gate, decision: condition === "failed-verdict" ? "fail" : "pass" });
        expect(outcome?.readiness.verdict).not.toBe("allowed");
        expect(db.receipts).toHaveBeenCalledWith({ where: { backlogItemId: "item", kind: "initiative_gate_receipt", gateKey: "design_spec",
          AND: ["kind", "commitSha", "path", "providerBlobId"].map(key => ({ payload: { path: ["artifactRef", key], equals: artifactRef[key as keyof typeof artifactRef] } })) },
          take: 251, orderBy: [{ recordedAt: "asc" }, { id: "asc" }], select: { id: true, backlogItemId: true, kind: true, gateKey: true, payload: true } });
        expect(db.authority).toHaveBeenCalledWith(expect.objectContaining({ where: { decisionId: receipt.authorityDecisionId } }));
      } else expect(outcome).toBeNull();
      expect(db.update).not.toHaveBeenCalled(); expect(db.updateMany).not.toHaveBeenCalled();
    });
  it("keeps the existing acknowledgement path first without a fallback scan", async () => {
    db.execution.mockResolvedValue({ result: { success: true, data: { receiptId: "receipt" } } });
    expect(await loadTaskInitiativeReviewOutcome("TR-1", binding)).toMatchObject({ receiptId: "receipt" });
    expect(db.task).not.toHaveBeenCalled(); expect(db.receipts).not.toHaveBeenCalled(); expect(db.authority).not.toHaveBeenCalled();
  });
  it("archives uncertainty when the exact receipt settles, so a concurrent loser reads completion", async () => {
    const uncertainty = { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" };
    const progress = { ...snapshot.progressPayload, executionUncertainty: uncertainty };
    const outcome = await loadInitiativeReviewOutcome(binding, "receipt");
    await reconcilePersistedReviewStatus(snapshot.taskRunId, progress, outcome!, snapshot);
    const data = db.updateMany.mock.calls[0][0].data;
    expect(data.progressPayload).not.toHaveProperty("executionUncertainty");
    expect(data.progressPayload.executionUncertaintyResolution).toMatchObject({ reviewReceiptId: "receipt",
      prior: { executionUncertainty: uncertainty } });
    const replay = projectRemoteTaskReplay({ existing: { taskRunId: snapshot.taskRunId, status: data.status,
      progressPayload: data.progressPayload, a2aMetadata: {} }, requestMatches: true });
    expect(replay.result.waitReason).toBeUndefined();
    expect(progress.executionUncertainty.settlement).toBe("unknown");
  });
  it("reconciles stale status from a verified receipt while preserving unrelated progress", async () => {
    const outcome = await loadInitiativeReviewOutcome(binding, "receipt");
    expect(await reconcilePersistedReviewStatus(snapshot.taskRunId, snapshot.progressPayload, outcome!, snapshot)).toBe(true);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.updateMany.mock.calls[0][0].where).toEqual({ taskRunId: snapshot.taskRunId, status: snapshot.status, updatedAt: snapshot.updatedAt, archivedAt: null });
    const data = db.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe("completed");
    expect(data.progressPayload).toMatchObject({ auditMarker: "retain", reviewOutcome: { receiptId: "receipt" }, requiresApproval: false });
    expect(data.progressPayload).not.toHaveProperty("terminalWriterWait");
    expect(data.progressPayload).not.toHaveProperty("approvalEnvelopeId");
  });
  it.each(["canceled", "rejected", "archived", "quiescing", "unknown"])("does not revive a %s task from a receipt", async status => {
    const outcome = await loadInitiativeReviewOutcome(binding, "receipt");
    expect(await reconcilePersistedReviewStatus(snapshot.taskRunId, snapshot.progressPayload, outcome!, { ...snapshot, status })).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });
  it("settles a failed review only from its verified exact-task receipt", async () => {
    const outcome = await loadInitiativeReviewOutcome(binding, "receipt");
    expect(await reconcilePersistedReviewStatus(snapshot.taskRunId, snapshot.progressPayload, outcome!, { ...snapshot, status: "failed" })).toBe(true);
    expect(db.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { taskRunId: snapshot.taskRunId, status: "failed", updatedAt: snapshot.updatedAt, archivedAt: null },
      data: expect.objectContaining({ status: "completed" }),
    }));
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
