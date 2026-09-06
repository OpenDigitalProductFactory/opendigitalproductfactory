import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ item: vi.fn(), execution: vi.fn(), update: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { backlogItem: { findUnique: db.item }, toolExecution: { findFirst: db.execution }, taskRun: { update: db.update } } }));
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
beforeEach(() => { vi.resetAllMocks(); db.item.mockResolvedValue(item()); });
describe("persisted initiative review outcome", () => {
  it("reconciles stale status from a verified receipt while preserving unrelated progress", async () => {
    const outcome = await loadInitiativeReviewOutcome(binding, "receipt");
    await reconcilePersistedReviewStatus("TR-1", { auditMarker: "retain", terminalWriterWait: {}, approvalEnvelopeId: "stale" }, outcome!);
    const data = db.update.mock.calls[0][0].data;
    expect(data.status).toBe("completed");
    expect(data.progressPayload).toMatchObject({ auditMarker: "retain", reviewOutcome: { receiptId: "receipt" }, requiresApproval: false });
    expect(data.progressPayload).not.toHaveProperty("terminalWriterWait");
    expect(data.progressPayload).not.toHaveProperty("approvalEnvelopeId");
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
