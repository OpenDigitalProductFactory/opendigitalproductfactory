import { describe, expect, it, vi } from "vitest";
import { loadInitiativeReviewRoomReceipts, type InitiativeReceiptClient } from "./initiative-review-room-receipts";
import type { ReviewerRoomCandidate } from "./review-room-candidates";

const now = new Date("2026-11-03T10:00:00Z");
function fixture() {
  const binding = { writerToolName: "record_initiative_design_review", itemId: "BI-1", gate: "spec-approval",
    workroomRef: { kind: "workroom-head", workroomId: "WC-1", repositoryFullName: "owner/repo",
      branchName: "fix/receipt", headSha: "a".repeat(40) },
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "b".repeat(40),
      path: "docs/design.md", providerBlobId: "c".repeat(40) } };
  const candidate: ReviewerRoomCandidate = { id: "row", taskRunId: "TR-1", userId: "user", status: "completed",
    createdAt: new Date("2026-11-03T09:00:00Z"), updatedAt: now, lastHeartbeatAt: now,
    capsuleId: "WC-1", reviewKind: "initiative-review", ambiguousReviewKind: false, progressPayload: {},
    progressTruncated: false, nodes: [], nodesTruncated: false, initiativeBinding: binding, bindingTruncated: false,
    requestDigest: "d".repeat(64), requesterAgentId: "AGT-AUTHOR", metadataTrigger: "external-mcp",
    roomRepositoryFullName: "owner/repo", roomHeadBranch: "fix/receipt", roomHeadSha: "a".repeat(40), roomBacklogItemId: "BI-1", user: null };
  const payload = { schemaVersion: 1, receiptId: "receipt", gate: "spec-approval", decision: "fail",
    policyVersion: "initiative-v1", artifactDigest: "sha256:" + "e".repeat(64),
    subject: { kind: "backlog-item", id: "BI-1" }, artifactRef: { ...binding.artifactRef },
    artifactAuthorRef: "principal:author|agent:author", reviewerPrincipalId: "reviewer", reviewerAgentId: "AGT-REVIEWER",
    authorityDecisionId: "AUTH-1", authoritySnapshot: { decision: "allow", actionKey: binding.writerToolName,
      policyVersion: "authority-v1", organizationId: "platform", effectiveHumanCapability: "manage_backlog",
      effectiveAgentGrant: "initiative_design_review", tokenScope: "write" },
    findingRefs: ["finding"], resolvedFindingRefs: [], reason: "Required evidence is missing." };
  const authority = { decision: "allow", actionKey: binding.writerToolName, organizationId: null,
    policyVersion: "authority-v1", rationale: { taskRunId: "TR-1" } };
  const receipt = { rowId: "row", receiptId: "receipt", itemRowId: "item-row", backlogItemId: "item-row",
    organizationId: null, gateKey: "spec_approval", payload, recordedAt: now, payloadTruncated: false, authority, envelopeTaskIds: [] as string[] };
  const db = { $queryRaw: vi.fn().mockResolvedValue([receipt]),
    authorizationDecisionLog: { findUnique: vi.fn().mockResolvedValue(authority) },
    coworkerActionEnvelope: { findMany: vi.fn().mockResolvedValue([]) } };
  return { candidate, binding, receipt, payload, authority, db };
}

describe("ordinary Workroom receipt provenance", () => {
  it("reads only bounded receipt metadata and authenticates the original authority task", async () => {
    const { db, candidate, payload } = fixture();
    const result = await loadInitiativeReviewRoomReceipts(db as unknown as InitiativeReceiptClient, [candidate], now);
    expect(result.receipts.get(candidate.id)).toEqual({ id: "receipt", decision: "fail", summary: payload.reason, recordedAt: now });
    expect(result.partialRooms.size).toBe(0);
    const [sql, input] = db.$queryRaw.mock.calls[0];
    expect(sql.join("")).toContain("LIMIT 21");
    expect(sql.join("")).toContain('task."a2aMetadata"->\'initiativeReviewBinding\' = request.binding');
    expect(JSON.parse(input)[0]).toMatchObject({ rowId: "row", taskRunId: "TR-1", userId: "user", requestDigest: "d".repeat(64) });
    expect(sql.join("")).toContain('LEFT JOIN "AuthorizationDecisionLog"');
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.authorizationDecisionLog.findUnique).not.toHaveBeenCalled();
  });

  it.each(["other-task", "conflicting-link", "denied", "wrong-action", "wrong-organization", "wrong-policy", "gate", "item", "artifact", "row", "invalid-receipt", "false-pass"])(
    "does not display a verdict for %s evidence", async kind => {
      const { db, candidate, payload, authority, receipt } = fixture();
      if (kind === "other-task") authority.rationale.taskRunId = "TR-OTHER";
      if (kind === "conflicting-link") receipt.envelopeTaskIds = ["TR-OTHER"];
      if (kind === "denied") authority.decision = "deny";
      if (kind === "wrong-action") authority.actionKey = "record_initiative_architecture_review";
      if (kind === "wrong-organization") payload.authoritySnapshot.organizationId = "foreign";
      if (kind === "wrong-policy") payload.authoritySnapshot.policyVersion = "wrong-policy";
      if (kind === "gate") payload.gate = "research";
      if (kind === "item") payload.subject.id = "BI-OTHER";
      if (kind === "artifact") payload.artifactRef.providerBlobId = "f".repeat(40);
      if (kind === "row") receipt.backlogItemId = "foreign-row";
      if (kind === "invalid-receipt") payload.artifactDigest = "";
      if (kind === "false-pass") payload.decision = "pass"; // Open findings cannot become PASS.
      const result = await loadInitiativeReviewRoomReceipts(db as unknown as InitiativeReceiptClient, [candidate], now);
      expect(result.receipts.size).toBe(0);
    });

  it.each(["query-error", "oversized", "overflow", "ambiguous", "future", "unknown-binding"])(
    "marks %s evidence incomplete without publishing a partial verdict", async kind => {
      const { db, candidate, receipt } = fixture();
      if (kind === "query-error") db.$queryRaw.mockRejectedValue(new Error("unavailable"));
      if (kind === "oversized") receipt.payloadTruncated = true;
      if (kind === "overflow") db.$queryRaw.mockResolvedValue(Array.from({ length: 21 }, () => receipt));
      if (kind === "ambiguous") db.$queryRaw.mockResolvedValue([receipt, { ...receipt, receiptId: "another", payload: { ...receipt.payload, receiptId: "another" } }]);
      if (kind === "future") receipt.recordedAt = new Date(now.getTime() + 1000);
      if (kind === "unknown-binding") candidate.initiativeBinding = { ...(candidate.initiativeBinding as object), futureGrant: true };
      const result = await loadInitiativeReviewRoomReceipts(db as unknown as InitiativeReceiptClient, [candidate], now);
      expect(result.receipts.size).toBe(0);
      expect(result.partialRooms.has("WC-1")).toBe(true);
    });

  it("does not need a successful ToolExecution response to read the committed native effect", async () => {
    const { db, candidate } = fixture();
    const result = await loadInitiativeReviewRoomReceipts(db as unknown as InitiativeReceiptClient, [candidate], now);
    expect(result.receipts.size).toBe(1);
    expect(db).not.toHaveProperty("toolExecution");
    expect(db).not.toHaveProperty("taskRun"); // No task reconciliation or provider execution.
  });

  it("keeps a prior source's receipt inspectable without making it current", async () => {
    const { db, candidate } = fixture(); candidate.roomHeadSha = "f".repeat(40);
    const result = await loadInitiativeReviewRoomReceipts(db as unknown as InitiativeReceiptClient, [candidate], now);
    expect(result.receipts.size).toBe(1);
    expect(candidate.roomHeadSha).toBe("f".repeat(40));
  });

  it("refuses incomplete provenance readers", async () => {
    const { candidate } = fixture();
    const result = await loadInitiativeReviewRoomReceipts({}, [candidate], now);
    expect(result.receipts.size).toBe(0); expect(result.partialRooms.has("WC-1")).toBe(true);
  });
});
